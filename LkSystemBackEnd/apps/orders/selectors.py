"""
LkSystem Orders — Selectors (read queries).

The single place that *builds* order querysets: base ``select_related`` /
``prefetch_related``, the queue-ranking annotations, the operational search box,
return-lookup matching, and RBAC row scoping. Keeping these here (instead of
inline in the viewset) means:

  * the viewset stays thin and is only about request/response wiring;
  * the same scoped/annotated queryset can be reused by other readers
    (KPIs, exports, BI) without copy-pasting the join + scope rules;
  * the query logic is unit-testable in isolation.

These functions never mutate data and never raise permission errors — they only
*shape and filter* querysets. Permission *gates* live in ``permissions.py``.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from django.db.models import Case, Count, F, IntegerField, Q, Value, When
from django.db.models.functions import Replace
from django.utils import timezone

from apps.rbac.models import UserRole

from .models import Order

# FKs the list serializer reads — every one must be joined or the list page
# pays one extra query PER ROW (e.g. brand_name → N+1).
_LIST_SELECT_RELATED = (
    'company', 'brand', 'sales_channel', 'pos_sales_channel', 'client',
    'created_by', 'deleted_by', 'packaged_by', 'edit_locked_by',
    'assigned_agent', 'assigned_by',
)


def base_list_queryset(*, include_deleted: bool = False):
    """Base order queryset for list/detail pages with all list-serializer joins.

    ``include_deleted`` switches to ``all_objects`` so soft-deleted rows are
    visible (the caller is responsible for gating that behind the
    ``view_soft_deleted_orders`` permission).
    """
    manager = Order.all_objects if include_deleted else Order.objects
    return manager.select_related(*_LIST_SELECT_RELATED)


def with_queue_annotations(qs):
    """Attach the computed order-queue fields used by serializers and default
    ordering. DRF applies ``OrderingFilter`` to retrieve/action queries too, so
    these annotations must be available on every Order queryset.
    """
    today = timezone.localdate()
    S = Order.Status
    return qs.annotate(
        line_count=Count('lines', filter=Q(lines__is_deleted=False)),
        business_priority_rank=Case(
            When(priority_level=Order.PriorityLevel.HIGH, then=Value(0)),
            When(priority_level=Order.PriorityLevel.MEDIUM, then=Value(1)),
            default=Value(2),
            output_field=IntegerField(),
        ),
        # Action urgency, ranked from the canonical six-state lifecycle:
        # due delayed orders first, then the confirmation queue (new /
        # not_answered), then fulfilment (POS routing waits, confirmed
        # ready to ship, packaging in flight). Deleted rows always sink.
        lifecycle_priority=Case(
            When(is_deleted=True, then=Value(99)),
            When(Q(status=S.DELAYED) & Q(delay_date__lte=today), then=Value(0)),
            When(Q(status=S.NEW) & ~Q(source=Order.Source.POS), then=Value(1)),
            When(status=S.NOT_ANSWERED, then=Value(2)),
            When(status=S.DELAYED, then=Value(3)),
            When(
                in_store_pickup=True,
                sent_to_pos_at__isnull=False,
                pos_validated_at__isnull=True,
                then=Value(4),
            ),
            When(Q(status=S.CONFIRMED) & ~Q(source=Order.Source.POS), then=Value(5)),
            When(status=S.PACKAGING, then=Value(6)),
            default=Value(10),
            output_field=IntegerField(),
        ),
    )


def phone_digits(field: str):
    """Expression that strips common separators from a phone column so it can be
    compared digit-to-digit ("+216 24-512 995" → "21624512995")."""
    expr = F(field)
    for ch in (' ', '-', '+', '(', ')', '.'):
        expr = Replace(expr, Value(ch), Value(''))
    return expr


def apply_search(qs, term: str | None):
    """Single operational search box for staff.

    Searches order references (id / number / ticket / WooCommerce keys) and the
    DELIVERY contact stored on the order itself: the shipping (recipient) block
    first-class, plus the order's billing snapshot — the recipient fallback for
    orders that never had a separate shipping block (POS / manual orders). The
    linked Client record is deliberately NOT searched: customers change the
    recipient name/phone/address per order, so client-record matches surface the
    wrong orders.

    Phone-looking terms are also compared digit-to-digit (separators and the
    +216 country code stripped) so "+216 24 512 995", "24-512-995" and
    "24512995" all find the same order. Numeric terms also match the PK.
    """
    search = (term or '').strip()
    if not search:
        return qs

    query = (
        Q(order_number__icontains=search) |
        Q(ticket_id__icontains=search) |
        Q(client_ticket_uuid__icontains=search) |
        Q(external_order_id__icontains=search) |
        Q(wc_order_key__icontains=search) |
        # Delivery recipient (shipping block)
        Q(shipping_first_name__icontains=search) |
        Q(shipping_last_name__icontains=search) |
        Q(shipping_phone__icontains=search) |
        Q(shipping_address_1__icontains=search) |
        Q(shipping_city__icontains=search) |
        # Billing snapshot — the recipient fallback (POS / manual orders)
        Q(billing_first_name__icontains=search) |
        Q(billing_last_name__icontains=search) |
        Q(billing_email__icontains=search) |
        Q(billing_phone__icontains=search) |
        Q(billing_address_1__icontains=search) |
        Q(billing_city__icontains=search)
    )

    # "first last" matches the recipient name across both blocks.
    parts = search.split()
    if len(parts) >= 2:
        first, last = parts[0], parts[-1]
        query |= (
            Q(shipping_first_name__icontains=first, shipping_last_name__icontains=last) |
            Q(billing_first_name__icontains=first, billing_last_name__icontains=last)
        )

    # Digit-to-digit phone matching, tolerant of separators and the Tunisian
    # country code on either side.
    digits = re.sub(r'\D', '', search)
    if len(digits) >= 6:
        candidates = {digits}
        if digits.startswith('216') and len(digits) > 8:
            candidates.add(digits[3:])
        qs = qs.annotate(
            _shipping_phone_digits=phone_digits('shipping_phone'),
            _billing_phone_digits=phone_digits('billing_phone'),
        )
        for cand in candidates:
            query |= (
                Q(_shipping_phone_digits__contains=cand) |
                Q(_billing_phone_digits__contains=cand)
            )

    if search.isdigit():
        query |= Q(pk=int(search))

    return qs.filter(query)


def return_lookup_candidates(raw_query: str) -> set[str]:
    """Extract likely order identifiers from typed text, barcode, or QR URL."""
    query = (raw_query or '').strip()
    candidates = {query} if query else set()
    if not query:
        return candidates

    parsed = urlparse(query)
    if parsed.scheme and parsed.netloc:
        for part in parsed.path.split('/'):
            cleaned = part.strip()
            if cleaned:
                candidates.add(cleaned)
        for values in parse_qs(parsed.query).values():
            for value in values:
                if value:
                    candidates.add(value.strip())

    for separator in ['|', ';', ',', '\n', '\t']:
        if separator in query:
            candidates.update(part.strip() for part in query.split(separator) if part.strip())
    return {candidate for candidate in candidates if candidate}


def return_lookup_q(candidates: set[str]) -> Q:
    """Build the OR-query matching an order by any of its external references."""
    lookup_q = Q(pk__in=[])
    numeric_ids = []
    for candidate in candidates:
        lookup_q |= (
            Q(order_number__iexact=candidate) |
            Q(ticket_id__iexact=candidate) |
            Q(client_ticket_uuid__iexact=candidate) |
            Q(external_order_id__iexact=candidate) |
            Q(wc_order_key__iexact=candidate) |
            Q(delivery_reference__iexact=candidate) |
            Q(delivery_code__iexact=candidate) |
            Q(delivery_external_reference__iexact=candidate)
        )
        if candidate.isdigit():
            numeric = int(candidate)
            numeric_ids.append(numeric)
            lookup_q |= Q(delivery_order_id=numeric)
    if numeric_ids:
        lookup_q |= Q(pk__in=numeric_ids)
    return lookup_q


def permission_scope_q(user, codename: str) -> Q | None:
    """Return a Q limiting rows to scopes where ``user`` holds ``codename``.

    ``None`` means platform-wide access (no filter); an empty ``Q(pk__in=[])``
    matches nothing and is handled by the caller.
    """
    if user.is_superuser:
        return None

    assignments = (
        UserRole.objects
        .filter(user=user, role__permissions__codename=codename)
        .select_related('company', 'brand', 'sales_channel')
        .distinct()
    )

    scope_q = Q(pk__in=[])
    for assignment in assignments:
        if not assignment.company_id and not assignment.brand_id and not assignment.sales_channel_id:
            return None
        if assignment.sales_channel_id:
            scope_q |= Q(sales_channel_id=assignment.sales_channel_id)
        elif assignment.brand_id:
            scope_q |= Q(brand_id=assignment.brand_id) | Q(sales_channel__brand_id=assignment.brand_id)
        elif assignment.company_id:
            scope_q |= Q(company_id=assignment.company_id)
    return scope_q


def scope_orders_to_user(qs, user, codename: str):
    """Narrow an order queryset to the rows ``user`` may see for ``codename``.

    Layered narrowing (strongest first):
      * an operational account pinned to a sales point (Employee / Cashier) sees
        ONLY that channel's orders;
      * an active-brand workspace focus narrows EVERYONE (incl. superusers);
      * a superuser otherwise sees the active company (or everything);
      * any other user is scoped to their RBAC assignments for ``codename``.
    """
    # Operational accounts pinned to a sales point see ONLY that channel's
    # orders — web orders on the channel or POS orders rung on it.
    asc_id = getattr(user, 'assigned_sales_channel_id', None)
    if asc_id:
        return qs.filter(Q(sales_channel_id=asc_id) | Q(pos_sales_channel_id=asc_id))

    # Active-brand workspace focus narrows orders for EVERYONE. An order belongs
    # to a brand directly or through its sales channel. NULL = whole company.
    brand_id = getattr(user, 'current_brand_id', None)
    if brand_id:
        qs = qs.filter(Q(brand_id=brand_id) | Q(sales_channel__brand_id=brand_id))

    if user.is_superuser:
        company_id = getattr(user, 'current_company_id', None)
        if company_id and not brand_id:
            qs = qs.filter(company_id=company_id)
        return qs

    scope_q = permission_scope_q(user, codename)
    if scope_q is None:
        return qs
    return qs.filter(scope_q).distinct()
