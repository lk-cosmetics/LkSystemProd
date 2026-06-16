"""
LkSystem Orders — Invoice service.

Invoices in LkSystem are not a separate table: an order *becomes* an invoice the
moment it is given an ``invoice_number`` (plus a snapshot of the billed party,
frozen so a later client edit can't rewrite history). This module owns every
rule around that snapshot:

  * building the invoice *registry* queryset (orders that carry a number);
  * previewing the next automatic number for a company workspace;
  * issuing / editing the snapshot — per-company-per-year sequence allocation,
    duplicate-number guarding, billed-party derivation, and the audit log entry;
  * deleting it — clearing the invoice fields while leaving the order (status,
    lines, stock) completely untouched.

Keeping it here means the viewset action is thin request-wiring and the same
rules can be reused (exports, batch issuance) and unit-tested without HTTP.

The viewset translates :class:`InvoiceError` into the matching DRF ``Response``;
the service itself stays framework-light (it only raises plain exceptions).
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from . import selectors
from .logging_service import OrderLoggingService
from .models import Order, OrderLog

# Snapshot fields a user may edit on an issued invoice (the billed-party block).
EDITABLE_INVOICE_FIELDS = (
    'invoice_client_name', 'invoice_client_type',
    'invoice_client_matricule_fiscale', 'invoice_client_phone',
    'invoice_client_email', 'invoice_client_address', 'invoice_client_city',
)

# Every invoice field, with the value that "no invoice" looks like — used to
# clear the snapshot on delete.
_BLANK_INVOICE_FIELDS = {
    'invoice_number': '',
    'invoice_date': None,
    'invoice_client_name': '',
    'invoice_client_type': 'PERSON',
    'invoice_client_matricule_fiscale': '',
    'invoice_client_phone': '',
    'invoice_client_email': '',
    'invoice_client_address': '',
    'invoice_client_city': '',
    'invoice_issued_at': None,
    'invoice_issued_by': None,
}

# Sort keys accepted by the registry endpoint → real ORM ordering.
_REGISTRY_ORDERING = {
    'invoice_number': 'invoice_number',
    '-invoice_number': '-invoice_number',
    'date': 'invoice_date',
    '-date': '-invoice_date',
    'total': 'total',
    '-total': '-total',
    'client': 'invoice_client_name',
    '-client': '-invoice_client_name',
}


class InvoiceError(Exception):
    """Domain error carrying the exact DRF payload + status the view should
    return (e.g. a duplicate-number 400)."""

    def __init__(self, payload: dict, status_code: int = 400):
        self.payload = payload
        self.status_code = status_code
        super().__init__(str(payload))


class InvoiceService:
    """All invoice read/write rules, decoupled from the HTTP layer."""

    # ── reads ────────────────────────────────────────────────────────────
    @staticmethod
    def registry_queryset(user, *, search='', date_from=None, date_to=None, ordering='-date'):
        """Orders that carry an invoice number, scoped to what ``user`` may see.

        Includes soft-deleted orders (``all_objects``) because their invoice
        still exists in the legal registry. The viewset paginates + serializes.
        """
        from django.db.models import Q

        qs = Order.all_objects.exclude(invoice_number='').select_related(
            'company', 'brand', 'client',
        )
        qs = selectors.scope_orders_to_user(qs, user, 'view_invoices')

        term = (search or '').strip()
        if term:
            qs = qs.filter(
                Q(invoice_number__icontains=term)
                | Q(order_number__icontains=term)
                | Q(invoice_client_name__icontains=term)
                | Q(invoice_client_phone__icontains=term)
                | Q(invoice_client_email__icontains=term)
                | Q(invoice_client_matricule_fiscale__icontains=term)
            )

        if date_from:
            qs = qs.filter(invoice_date__gte=date_from)
        if date_to:
            qs = qs.filter(invoice_date__lte=date_to)

        order_by = _REGISTRY_ORDERING.get(ordering or '-date', '-invoice_date')
        return qs.order_by(order_by, '-id')

    @staticmethod
    def next_number_preview(user) -> dict:
        """Preview the next automatic invoice number for the active workspace.

        Falls back to the user's single visible company when no workspace
        company is selected; returns a guidance message when it can't resolve
        exactly one company.
        """
        company_id = getattr(user, 'current_company_id', None)
        if not company_id:
            visible = selectors.scope_orders_to_user(
                Order.all_objects.all(), user, 'view_invoices',
            )
            company_ids = list(
                visible.order_by().values_list('company_id', flat=True).distinct()[:2]
            )
            if len(company_ids) == 1:
                company_id = company_ids[0]

        if not company_id:
            return {
                'company': None,
                'year': timezone.localdate().year,
                'next_invoice_number': None,
                'detail': 'Select a company workspace to preview its next invoice number.',
            }

        return {
            'company': company_id,
            'year': timezone.localdate().year,
            'next_invoice_number': Order.next_invoice_number(company_id),
        }

    # ── writes ───────────────────────────────────────────────────────────
    @staticmethod
    @transaction.atomic
    def issue_or_update(order: Order, *, values: dict, actor, creating: bool) -> Order:
        """Issue a new invoice (``creating=True``) or edit the existing snapshot.

        Allocates the per-company-per-year number when one isn't supplied,
        guards against duplicates within the company, derives the billed-party
        block from the order on first issue, persists, and writes the audit log.
        Raises :class:`InvoiceError` on a duplicate number.
        """
        from apps.company.models import Company

        # Serialise issuance within the company so two concurrent POSTs can't
        # grab the same sequence number.
        Company.objects.select_for_update().get(pk=order.company_id)

        invoice_date = values.get('invoice_date') or order.invoice_date or timezone.localdate()
        invoice_number = (
            values.get('invoice_number')
            or order.invoice_number
            or Order.next_invoice_number(order.company_id, invoice_date.year)
        )

        duplicate = Order.all_objects.filter(
            company_id=order.company_id,
            invoice_number=invoice_number,
        ).exclude(pk=order.pk).exists()
        if duplicate:
            raise InvoiceError(
                {'invoice_number': ['This invoice number is already used by another order.']}
            )

        defaults = InvoiceService._billed_party_defaults(order) if creating else {}

        order.invoice_number = invoice_number
        order.invoice_date = invoice_date
        for field in EDITABLE_INVOICE_FIELDS:
            if field in values:
                setattr(order, field, values[field])
            elif creating:
                setattr(order, field, defaults[field])

        update_fields = ['invoice_number', 'invoice_date', *EDITABLE_INVOICE_FIELDS, 'updated_at']
        if creating:
            order.invoice_issued_at = timezone.now()
            order.invoice_issued_by = actor
            update_fields.extend(['invoice_issued_at', 'invoice_issued_by'])

        order._actor = actor
        order.save(update_fields=update_fields)

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.UPDATED,
            user=actor,
            details={
                'event': 'invoice_issued' if creating else 'invoice_updated',
                'invoice_number': order.invoice_number,
                'invoice_date': order.invoice_date,
            },
        )
        return order

    @staticmethod
    @transaction.atomic
    def delete(order: Order, *, actor) -> str:
        """Remove the invoice from the registry by clearing the order's invoice
        fields. The order (status, lines, stock) is left untouched. Returns the
        removed number; raises :class:`InvoiceError` when there's nothing to
        delete."""
        if not order.invoice_number:
            raise InvoiceError({'detail': 'This order has no invoice to delete.'})

        removed_number = order.invoice_number
        for field, value in _BLANK_INVOICE_FIELDS.items():
            setattr(order, field, value)
        order._actor = actor
        order.save(update_fields=[*_BLANK_INVOICE_FIELDS.keys(), 'updated_at'])

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.UPDATED,
            user=actor,
            details={'event': 'invoice_deleted', 'invoice_number': removed_number},
        )
        return removed_number

    # ── helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _billed_party_defaults(order: Order) -> dict:
        """Freeze the billed-party snapshot from the order at first issuance.

        Companies are billed under their registered name + matricule fiscale;
        individuals under the billing contact name. Phone/email/address fall
        back through billing → shipping → linked client.
        """
        client_type = (
            getattr(order.client, 'client_type', '') if order.client else ''
        ) or ('COMPANY' if order.billing_company else 'PERSON')

        contact_name = f'{order.billing_first_name} {order.billing_last_name}'.strip()
        client_name = (
            (order.billing_company or contact_name)
            if client_type == 'COMPANY'
            else contact_name
        ) or (order.client.full_name if order.client else '')

        return {
            'invoice_client_name': client_name,
            'invoice_client_type': client_type,
            'invoice_client_matricule_fiscale': (
                getattr(order.client, 'matricule_fiscale', '') if client_type == 'COMPANY' else ''
            ),
            'invoice_client_phone': (
                order.billing_phone
                or order.shipping_phone
                or (order.client.phone if order.client else '')
            ),
            'invoice_client_email': (
                order.billing_email or (order.client.email if order.client else '')
            ),
            'invoice_client_address': order.billing_address_1,
            'invoice_client_city': order.billing_city,
        }
