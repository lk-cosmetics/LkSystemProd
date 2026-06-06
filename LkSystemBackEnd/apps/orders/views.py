"""
LkSystem Orders App - Views
═══════════════════════════════════════════════════════════════════════════════
Business rule: sync + preview fetch ONLY status=processing from WooCommerce.
These are new paid website orders that need internal confirmation/fulfilment.

  • get_queryset  → returns ALL orders (list page shows every status)
  • summary       → aggregates ALL orders for accurate KPI dashboard
  • preview       → fetches one WC processing page and shows new local orders
  • sync          → fetches WC processing orders → bulk_sync into DB
  • sync-selected → fetches specific WC order IDs → bulk_sync
  • submit-delivery / delivery-status → delivery lifecycle endpoints
  • OrderSyncEventViewSet → read-only audit trail
"""

import logging
import uuid
from datetime import timedelta
from typing import Optional
from urllib.parse import parse_qs, urlparse

from django.db import transaction
from django.db.models import Case, Count, IntegerField, Q, Value, When
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter
from woocommerce import API as WooCommerceAPI
from requests import exceptions as requests_exceptions

from apps.rbac.services import PermissionService
from apps.rbac.models import UserRole
from apps.sales_channels.models import SalesChannel
from apps.clients.models import Client
from .models import Order, OrderLog, OrderSyncEvent
from .serializers import (
    OrderListSerializer,
    OrderDetailSerializer,
    POSOrderCreateSerializer,
    ManualOrderCreateSerializer,
    OrderStatusUpdateSerializer,
    OrderEditLockSerializer,
    OrderEditSerializer,
    OrderLogSerializer,
    OrderConfirmSerializer,
    OrderDelaySerializer,
    OrderCancelOutcomeSerializer,
    ManualTransitionSerializer,
    DeliveryStatusUpdateSerializer,
    OrderPackagingSerializer,
    OrderPickupSerializer,
    OrderSendToPOSSerializer,
    OrderPOSCheckoutSerializer,
    OrderReturnSerializer,
    OrderReturnLookupSerializer,
    OrderSyncEventSerializer,
)
from .filters import OrderFilterSet
from .order_management_service import OrderManagementService
from .service import OrderIngestionService, OrderIngestionError
from .lifecycle_service import OrderLifecycleService, LifecycleError
from .woocommerce_sync_service import WooCommerceSyncService
from .kpi_service import OrderKPIService
from .delivery_service import DeliveryError
from .logging_service import OrderLoggingService

logger = logging.getLogger(__name__)


# ─── WooCommerce fetch constants ──────────────────────────────────────────────

WC_HTTP_TIMEOUT_SECONDS = 12
WC_FETCH_PER_PAGE       = 100
WC_PREVIEW_PER_PAGE     = 25
WC_PREVIEW_MAX_PER_PAGE = 100
WC_IMPORT_STATUS       = 'processing'  # The only WC status we sync/preview
WC_PREVIEW_FIELDS      = (
    'id,number,status,total,currency,billing,line_items,'
    'date_created,payment_method_title'
)
SYNC_OVERLAP_MINUTES   = 5


# ═════════════════════════════════════════════════════════════════════════════
# ORDER VIEWSET
# ═════════════════════════════════════════════════════════════════════════════

class OrderViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only ViewSet for listing / retrieving orders.
    Orders are **created** through the POS endpoint or via webhooks.
    """

    # ── helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _safe_int(value, default):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _safe_positive_int(value, default: int, *, maximum: int | None = None) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = default
        parsed = max(1, parsed)
        return min(parsed, maximum) if maximum else parsed

    @staticmethod
    def _safe_bool(value, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {'1', 'true', 'yes', 'y', 'on'}

    @staticmethod
    def _with_queue_annotations(qs):
        """
        Attach computed order-queue fields used by serializers and default
        ordering. DRF applies OrderingFilter to retrieve/action queries too,
        so these annotations must be available for every Order queryset.
        """
        today = timezone.localdate()
        return qs.annotate(
            line_count=Count('lines', filter=Q(lines__is_deleted=False)),
            lifecycle_priority=Case(
                When(is_deleted=True, then=Value(99)),
                When(
                    Q(outcome=Order.Outcome.DELAYED) &
                    Q(delay_date__lte=today),
                    then=Value(0),
                ),
                When(
                    Q(outcome=Order.Outcome.NONE) &
                    ~Q(source=Order.Source.POS) &
                    Q(status__in=[
                        Order.Status.PENDING,
                        Order.Status.PROCESSING,
                        Order.Status.ON_HOLD,
                        Order.Status.COMPLETED,
                    ]),
                    then=Value(1),
                ),
                When(outcome=Order.Outcome.DELAYED, then=Value(2)),
                When(in_store_pickup=True, sent_to_pos_at__isnull=True, then=Value(3)),
                When(
                    in_store_pickup=True,
                    sent_to_pos_at__isnull=False,
                    pos_validated_at__isnull=True,
                    then=Value(4),
                ),
                When(
                    Q(outcome=Order.Outcome.CONFIRMED) &
                    ~Q(source=Order.Source.POS) &
                    Q(delivery_status__in=[
                        Order.DeliveryStatus.NONE,
                        Order.DeliveryStatus.PENDING,
                        Order.DeliveryStatus.FAILED,
                    ]),
                    then=Value(5),
                ),
                default=Value(10),
                output_field=IntegerField(),
            ),
        )

    @staticmethod
    def _apply_search(qs, term: str | None):
        """
        Single operational search box for staff.

        Searches internal order id/order number, WooCommerce references, client
        identity, and phone fields. Numeric terms also match the internal PK.
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
            Q(billing_first_name__icontains=search) |
            Q(billing_last_name__icontains=search) |
            Q(billing_email__icontains=search) |
            Q(billing_phone__icontains=search) |
            Q(client__email__icontains=search) |
            Q(client__first_name__icontains=search) |
            Q(client__last_name__icontains=search) |
            Q(client__phone__icontains=search)
        )

        parts = search.split()
        if len(parts) >= 2:
            first, last = parts[0], parts[-1]
            query |= (
                Q(client__first_name__icontains=first, client__last_name__icontains=last) |
                Q(billing_first_name__icontains=first, billing_last_name__icontains=last)
            )

        if search.isdigit():
            query |= Q(pk=int(search))

        return qs.filter(query)

    @staticmethod
    def _return_lookup_candidates(raw_query: str) -> set[str]:
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

    @staticmethod
    def _return_lookup_q(candidates: set[str]) -> Q:
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

    queryset = Order.objects.select_related(
        'company', 'sales_channel', 'pos_sales_channel', 'client', 'created_by',
    ).all()
    permission_classes  = [IsAuthenticated]
    filter_backends     = [DjangoFilterBackend, OrderingFilter]
    filterset_class     = OrderFilterSet
    ordering_fields     = [
        'id', 'order_number', 'created_at', 'updated_at',
        'total', 'status', 'wc_status', 'source', 'payment_status', 'delivery_status',
        'contact_status', 'return_exchange_status',
        'outcome', 'lifecycle_priority', 'client__points',
        'client__first_name', 'client__last_name', 'sales_channel__name',
        # Phase D — the clean derived lifecycle fields are real columns now.
        'order_status', 'sync_status', 'priority_level',
    ]
    ordering            = ['lifecycle_priority', '-client__points', '-created_at']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return OrderDetailSerializer
        return OrderListSerializer

    # Per-order write actions that must respect the edit lock. The lock is the
    # source of truth for "who is handling this order", so once another user
    # takes it over the previous holder's in-flight requests fail here instead
    # of racing the new holder's changes. Read actions and the lock-management
    # actions (acquire / heartbeat / release) are intentionally excluded.
    _LOCK_ENFORCED_ACTIONS = frozenset({
        'update_status', 'edit_order', 'soft_delete', 'restore',
        'submit_delivery', 'update_delivery_status', 'confirm_order',
        'not_answered', 'restore_delayed', 'delay_order', 'cancel_outcome',
        'package_order', 'unpackage_order', 'mark_pickup', 'send_to_pos',
        'validate_pos', 'process_return', 'restore_return_stock',
        'manual_transition', 'retry_sync',
    })

    def get_object(self):
        obj = super().get_object()
        if getattr(self, 'action', None) in self._LOCK_ENFORCED_ACTIONS:
            self._assert_lock_available(obj)
        return obj

    def _assert_lock_available(self, order):
        """Reject a write (409) when another user holds an active edit lock."""
        now = timezone.now()
        held_by_other = (
            order.edit_locked_by_id
            and order.edit_locked_by_id != self.request.user.id
            and order.edit_lock_expires_at
            and order.edit_lock_expires_at > now
        )
        if held_by_other:
            from rest_framework.exceptions import APIException
            holder = order.edit_locked_by
            name = holder.get_full_name() or holder.get_username()
            exc = APIException({
                'detail': f'This order is being handled by {name}. Your action was not applied.',
                'lock': self._lock_payload(order),
            })
            exc.status_code = status.HTTP_409_CONFLICT
            raise exc

    def get_queryset(self):
        include_deleted = (
            self.request.query_params.get('include_deleted', '').lower() == 'true'
        )
        base_qs = Order.all_objects if include_deleted else Order.objects
        qs = base_qs.select_related(
            'company', 'sales_channel', 'pos_sales_channel', 'client',
            'created_by', 'deleted_by', 'packaged_by',
        )
        qs = self._with_queue_annotations(qs)

        if self.action == 'retrieve':
            qs = qs.prefetch_related('lines', 'lines__product')

        qs = self._scope_queryset(qs, self.request.user, 'view_orders')
        if include_deleted:
            self._require_permission(self.request.user, 'view_soft_deleted_orders')
        return self._apply_search(qs, self.request.query_params.get('search'))

    @staticmethod
    def _permission_scope_q(user, codename: str) -> Q | None:
        """
        Return a Q object limiting rows to scopes where the user has codename.
        None means platform-wide access; empty Q matching nothing is handled by caller.
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

    @classmethod
    def _scope_queryset(cls, qs, user, codename: str):
        # Operational accounts pinned to a sales point (Employee / Cashier) see
        # ONLY that channel's orders — web orders on the channel or POS orders
        # rung on it — regardless of any wider role scope.
        asc_id = getattr(user, 'assigned_sales_channel_id', None)
        if asc_id:
            return qs.filter(
                Q(sales_channel_id=asc_id) | Q(pos_sales_channel_id=asc_id)
            )

        # Active-brand workspace focus narrows orders for EVERYONE (including
        # superusers). An order belongs to a brand directly or through its
        # sales channel. NULL current_brand = whole-company (no narrowing).
        brand_id = getattr(user, 'current_brand_id', None)
        if brand_id:
            qs = qs.filter(
                Q(brand_id=brand_id) | Q(sales_channel__brand_id=brand_id)
            )

        if user.is_superuser:
            # Super Admin scoped to the selected company (workspace context);
            # with no company selected they see every order (global mode).
            company_id = getattr(user, 'current_company_id', None)
            if company_id and not brand_id:
                qs = qs.filter(company_id=company_id)
            return qs
        scope_q = cls._permission_scope_q(user, codename)
        if scope_q is None:
            return qs
        return qs.filter(scope_q).distinct()

    @staticmethod
    def _require_permission(user, codename: str, order: Order | None = None):
        if user.is_superuser:
            return
        if order is not None:
            has_perm = PermissionService.has_permission(
                user,
                codename,
                company=order.company,
                brand=order.sales_channel.brand,
                sales_channel=order.sales_channel,
            )
        else:
            has_perm = PermissionService.has_permission(user, codename)
        if not has_perm:
            raise PermissionDenied('You do not have permission to perform this action.')

    @staticmethod
    def _permission_for_edit(order: Order) -> str:
        return (
            'update_confirmed_orders'
            if order.outcome == Order.Outcome.CONFIRMED
            else 'update_unconfirmed_orders'
        )

    def _transition_response(self, order: Order, request) -> Response:
        """Serialize a mutated order and schedule any pending WooCommerce push.

        The lifecycle service flips ``sync_status`` to ``pending_sync`` (DB-only)
        whenever a WooCommerce order's clean ``order_status`` changes. We honour
        that flag and push AFTER the surrounding DB transaction commits, so a
        WooCommerce/network failure can never roll back the local change — local
        is always the source of truth. ``update_order_status`` itself is gated by
        ``WC_ORDER_PUSH_ENABLED`` and never raises, so this is safe everywhere.
        """
        if (
            order.source == Order.Source.WOOCOMMERCE
            and order.external_order_id
            and order.sync_status == Order.SyncStatus.PENDING_SYNC
        ):
            actor = getattr(request, 'user', None)
            transaction.on_commit(
                lambda: WooCommerceSyncService.update_order_status(order, actor=actor)
            )
        payload = OrderDetailSerializer(order).data
        return Response(payload)

    # ── POS / Manual order creation ──────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='pos')
    def create_pos_order(self, request):
        """
        Method B endpoint.
        Accepts a WooCommerce-shaped JSON assembled by the cashier UI
        and feeds it through OrderIngestionService.
        """
        self._require_permission(request.user, 'create_orders')

        serializer = POSOrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        sales_channel = data.pop('sales_channel')
        payload = {
            'ticket_id':              data.get('ticket_id', ''),
            'client_ticket_uuid':     data.get('client_ticket_uuid', ''),
            'billing':               data.get('billing', {}),
            'line_items':            data.get('line_items', []),
            'payment_method':        data.get('payment_method', 'cash'),
            'payment_method_title':  data.get('payment_method_title', 'Cash'),
            'customer_note':         data.get('customer_note', ''),
            'status':                data.get('status', 'completed'),
            'discount_type':         data.get('discount_type', Order.DiscountType.NONE),
            'discount_value':        str(data.get('discount_value', '0.00')),
        }
        for key in ('subtotal', 'total_tax', 'shipping_total', 'discount_total', 'total'):
            if key in data:
                payload[key] = str(data[key])

        ingestion = OrderIngestionService()
        try:
            order, _created = ingestion.ingest(
                payload=payload,
                sales_channel=sales_channel,
                source=Order.Source.POS,
                created_by=request.user,
            )
        except OrderIngestionError as exc:
            return Response(
                {'detail': exc.message, **exc.details},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        update_fields = []
        if order.outcome != Order.Outcome.CONFIRMED:
            order.outcome = Order.Outcome.CONFIRMED
            order.confirmed_at = now
            order.outcome_changed_at = now
            order.outcome_changed_by = request.user
            order.outcome_note = order.outcome_note or 'Direct POS checkout'
            update_fields.extend([
                'outcome', 'confirmed_at', 'outcome_changed_at',
                'outcome_changed_by', 'outcome_note',
            ])

        if order.status == Order.Status.COMPLETED:
            if order.payment_status != Order.PaymentStatus.PAID:
                order.payment_status = Order.PaymentStatus.PAID
                update_fields.append('payment_status')
            if (
                sales_channel.channel_type == SalesChannel.ChannelType.POS
                and order.pos_sales_channel_id != sales_channel.id
            ):
                order.pos_sales_channel = sales_channel
                update_fields.append('pos_sales_channel')
            if not order.pos_validated_at:
                order.pos_validated_at = now
                order.pos_validated_by = request.user
                update_fields.extend(['pos_validated_at', 'pos_validated_by'])

        if update_fields:
            order._actor = request.user
            order.save(update_fields=[*update_fields, 'updated_at'])

        return Response(OrderDetailSerializer(order).data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _billing_from_client(client: Client, base_billing: dict) -> dict:
        """Build a WooCommerce-shaped billing block from a stored ``Client``.

        ``OrderIngestionService`` resolves/links the client by company+email
        then company+phone, so we surface the client's email/phone here and the
        pipeline reconnects the order to the very same client record. Any
        non-empty field the caller supplied (e.g. a one-off shipping address)
        takes precedence over the client's stored values.
        """
        derived = {
            'first_name': client.first_name or '',
            'last_name':  client.last_name or '',
            'email':      client.email or '',
            'phone':      client.phone or '',
            'address_1':  client.address or '',
            'city':       client.city or '',
            'state':      client.state or '',
            'postcode':   client.postcode or '',
            'country':    client.country or 'TN',
        }
        for key, value in (base_billing or {}).items():
            if value:
                derived[key] = value
        return derived

    @action(detail=False, methods=['post'], url_path='manual')
    def create_manual_order(self, request):
        """Back-office (Order Manager) manual order creation — ``source=MANUAL``.

        A normal order-creation flow (not a till sale): the admin picks a sales
        channel, adds line items, optionally applies a fixed/percentage
        discount, and either links an existing client or sends a free-text
        billing block. Unlike the POS endpoint it does NOT force
        ``outcome=CONFIRMED`` / ``payment_status=PAID`` / POS validation — it
        defaults to the ``processing`` workflow status so the order enters the
        normal fulfilment lifecycle. The POS checkout path is left untouched.
        """
        serializer = ManualOrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        sales_channel = data.pop('sales_channel')
        # Channel-scoped gate: the user must be allowed to create orders on THIS
        # channel's company/brand — prevents creating orders against a tenant the
        # caller cannot access by passing an arbitrary sales_channel PK.
        self._require_permission_for_channel(request.user, 'create_orders', sales_channel)
        company = sales_channel.brand.company

        # Resolve billing: prefer an explicit, tenant-verified client; otherwise
        # use the free-text billing block the caller sent verbatim.
        billing = dict(data.get('billing') or {})
        client = data.get('client')
        if client is not None:
            if client.company_id != company.id:
                return Response(
                    {'client': [
                        "Selected client does not belong to this sales "
                        "channel's company."
                    ]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            billing = self._billing_from_client(client, billing)

        payload = {
            'ticket_id':             data.get('ticket_id', ''),
            'client_ticket_uuid':    data.get('client_ticket_uuid', ''),
            'billing':               billing,
            'line_items':            data.get('line_items', []),
            'payment_method':        data.get('payment_method', 'cash'),
            'payment_method_title':  data.get('payment_method_title', 'Cash'),
            'customer_note':         data.get('customer_note', ''),
            'status':                data.get('status', 'processing'),
            'discount_type':         data.get('discount_type', Order.DiscountType.NONE),
            'discount_value':        str(data.get('discount_value', '0.00')),
        }
        for key in ('subtotal', 'total_tax', 'shipping_total', 'discount_total', 'total'):
            if key in data:
                payload[key] = str(data[key])

        ingestion = OrderIngestionService()
        try:
            order, _created = ingestion.ingest(
                payload=payload,
                sales_channel=sales_channel,
                source=Order.Source.MANUAL,
                created_by=request.user,
            )
        except OrderIngestionError as exc:
            return Response(
                {'detail': exc.message, **exc.details},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Record the social channel the order came in on (Instagram, WhatsApp…).
        order_source = data.get('order_source') or ''
        if order_source and order.order_source != order_source:
            order.order_source = order_source
            order.save(update_fields=['order_source', 'updated_at'])

        return Response(OrderDetailSerializer(order).data, status=status.HTTP_201_CREATED)

    # ── Status update ────────────────────────────────────────────────────

    @action(detail=True, methods=['patch'], url_path='status')
    def update_status(self, request, pk=None):
        """Patch explicit status fields without mixing Woo/local/delivery/contact meanings."""
        order = self.get_object()
        self._require_permission(request.user, self._permission_for_edit(order), order)
        serializer = OrderStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            locked = Order.all_objects.select_for_update().get(pk=order.pk)
            if locked.is_deleted:
                return Response(
                    {'detail': 'Order is soft-deleted and cannot be edited.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            old_order_status = locked.order_status  # workflow state before the patch
            update_fields = []
            for field in (
                'status',
                'wc_status',
                'delivery_status',
                'contact_status',
                'outcome',
                'return_exchange_status',
                'delay_date',
                'delay_reason',
            ):
                if field in data:
                    setattr(locked, field, data[field] or ('' if field == 'delay_reason' else data[field]))
                    update_fields.append(field)

            if (
                locked.outcome == Order.Outcome.DELAYED
                or locked.contact_status == Order.ContactStatus.DELAYED
            ) and not locked.delay_date:
                return Response(
                    {'delay_date': ['Delay date is required for delayed orders.']},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            now = timezone.now()
            if 'outcome' in data:
                locked.outcome_changed_at = now
                locked.outcome_changed_by = request.user
                update_fields.extend(['outcome_changed_at', 'outcome_changed_by'])
                if data['outcome'] == Order.Outcome.CONFIRMED and not locked.confirmed_at:
                    locked.confirmed_at = now
                    update_fields.append('confirmed_at')
                if data['outcome'] != Order.Outcome.DELAYED and 'delay_date' not in data:
                    locked.delay_date = None
                    locked.delay_reason = ''
                    update_fields.extend(['delay_date', 'delay_reason'])

            note = data.get('internal_note', '')
            if note:
                locked.internal_note = f"{locked.internal_note}\n[{request.user}] {note}".strip()
                update_fields.append('internal_note')

            if update_fields:
                locked._actor = request.user
                locked.save(update_fields=[*dict.fromkeys(update_fields), 'updated_at'])
                if any(field in data for field in ('delivery_status', 'status', 'return_exchange_status', 'outcome')):
                    OrderLifecycleService._recompute_outcome(locked, actor=request.user)
                    # Reject an illegal workflow transition produced by this raw
                    # status patch — reuse the lifecycle FSM map so the endpoint
                    # can no longer jump an order into an unreachable state.
                    # (Raising inside the atomic block rolls the whole patch back
                    # and DRF returns 400.)
                    from rest_framework.exceptions import ValidationError as _VErr
                    from apps.orders.lifecycle_service import LifecycleError
                    try:
                        OrderLifecycleService._assert_transition(
                            old_order_status, locked.order_status,
                        )
                    except LifecycleError as exc:
                        raise _VErr({'status': str(exc)})
                    # Reconcile stock so a direct status change can never bypass
                    # the decrement/restock side-effects (e.g. a jump to COMPLETED
                    # must decrement; moving away from it must restock). The engine
                    # is idempotent (delta = desired - already_moved).
                    inventory_channel = locked.pos_sales_channel or locked.sales_channel
                    if inventory_channel:
                        from apps.orders.service import (
                            OrderIngestionError, OrderIngestionService,
                        )
                        try:
                            OrderIngestionService._sync_inventory_movements(
                                locked,
                                list(locked.lines.filter(is_deleted=False).select_related('product')),
                                inventory_channel,
                                request.user,
                            )
                        except OrderIngestionError as exc:
                            raise _VErr({'detail': exc.message, **getattr(exc, 'details', {})})

        return self._transition_response(locked, request)

    @action(detail=True, methods=['patch'], url_path='edit')
    def edit_order(self, request, pk=None):
        """Edit order lines, quantities, per-line prices, and discount."""
        order = self.get_object()
        self._require_permission(request.user, self._permission_for_edit(order), order)

        serializer = OrderEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        OrderManagementService.edit_order(order=order, data=data, actor=request.user)

        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='soft-delete')
    def soft_delete(self, request, pk=None):
        """Soft delete order and logically hide its lines."""
        order = self.get_object()
        self._require_permission(request.user, 'soft_delete_orders', order)
        OrderManagementService.soft_delete_order(
            order=order,
            actor=request.user,
            reason=request.data.get('reason', ''),
        )
        return Response({'detail': 'Order soft-deleted successfully.'})

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request, pk=None):
        """Restore a soft-deleted order."""
        try:
            order = Order.all_objects.get(pk=pk)
        except Order.DoesNotExist:
            return Response({'detail': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)

        self._require_permission(request.user, 'restore_soft_deleted_orders', order)
        OrderManagementService.restore_order(order=order, actor=request.user)
        return self._transition_response(order, request)

    @action(detail=True, methods=['get'], url_path='logs')
    def logs(self, request, pk=None):
        """Get audit logs for one order."""
        order = self.get_object()
        self._require_permission(request.user, 'view_orders', order)
        logs_qs = order.logs.select_related('user').all()
        return Response(OrderLogSerializer(logs_qs, many=True).data)

    @action(detail=False, methods=['get'], url_path='stock-demand')
    def stock_demand(self, request):
        """Consolidated stock demand across all OPEN orders (confirmed/preparing).

        Pack-aware; sorted worst-shortfall-first. ``?sales_channel=<id>`` narrows
        to one channel. The completed-order side ("history") lives in the
        inventory movement ledger / Daily Stock Out tab.
        """
        from apps.orders.stock_service import OrderStockAvailabilityService

        self._require_permission(request.user, 'view_orders')
        channel_id = request.query_params.get('sales_channel') or None
        if channel_id:
            try:
                channel_id = int(channel_id)
            except (TypeError, ValueError):
                channel_id = None

        scoped = self._scope_queryset(Order.objects.all(), request.user, 'view_orders')
        rows = OrderStockAvailabilityService.open_order_demand(
            orders=scoped, channel_id=channel_id,
        )
        open_orders = scoped.filter(
            order_status__in=OrderStockAvailabilityService.OPEN_DEMAND_STATUSES,
        )
        if channel_id:
            open_orders = open_orders.filter(sales_channel_id=channel_id)
        return Response({
            'rows': rows,
            'totals': {
                'products': len(rows),
                'short_products': sum(1 for r in rows if r['shortfall'] > 0),
                'total_required': sum(r['required'] for r in rows),
                'total_shortfall': sum(r['shortfall'] for r in rows),
                'open_orders': open_orders.count(),
            },
        })

    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk(self, request):
        """Run one lifecycle action over many orders at once.

        Body: ``{"ids": [...], "action": "send_to_pos" | "submit_delivery" |
        "cancel" | "delete", "pos_sales_channel"?, "reason"?}``. Each order is
        tenant-scoped, permission-checked and processed independently, so the
        response reports per-order success/failure — a partial batch is never
        ambiguous. Per-order eligibility (e.g. only confirmed orders route to
        POS / delivery) is enforced by the lifecycle service.
        """
        from rest_framework.exceptions import PermissionDenied as DRFPermissionDenied
        from apps.orders.delivery_service import DeliveryError
        from apps.orders.lifecycle_service import LifecycleError, OrderLifecycleService

        ids = request.data.get('ids')
        action_name = request.data.get('action')
        if not isinstance(ids, list) or not ids:
            return Response(
                {'detail': 'Provide a non-empty "ids" list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        perm_by_action = {
            'send_to_pos': 'send_to_pos_orders',
            'submit_delivery': 'send_to_delivery_orders',
            'cancel': 'cancel_orders_lifecycle',
            'delete': 'soft_delete_orders',
        }
        if action_name not in perm_by_action:
            return Response(
                {'detail': f'Unknown bulk action "{action_name}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pos_channel = None
        if action_name == 'send_to_pos':
            from apps.sales_channels.models import SalesChannel
            pos_channel = SalesChannel.objects.filter(
                id=request.data.get('pos_sales_channel') or 0,
            ).first()
            if pos_channel is None:
                return Response(
                    {'detail': 'pos_sales_channel is required to send orders to POS.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        reason = (request.data.get('reason') or '').strip()
        scoped = self._scope_queryset(Order.objects.all(), request.user, 'view_orders')
        by_id = {o.id: o for o in scoped.filter(id__in=ids)}

        results = []
        for raw_id in ids:
            order = by_id.get(raw_id)
            if order is None:
                results.append({'id': raw_id, 'ok': False, 'error': 'Not found or not permitted.'})
                continue
            entry = {'id': order.id, 'order_number': order.order_number}
            try:
                self._require_permission(request.user, perm_by_action[action_name], order)
                if action_name == 'send_to_pos':
                    OrderLifecycleService.send_to_pos(
                        order, pos_sales_channel=pos_channel, actor=request.user,
                    )
                elif action_name == 'submit_delivery':
                    OrderLifecycleService.submit_delivery(order, actor=request.user)
                elif action_name == 'cancel':
                    OrderLifecycleService.cancel(
                        order, actor=request.user, reason=reason or 'Bulk cancellation',
                    )
                else:  # delete
                    OrderManagementService.soft_delete_order(
                        order=order, actor=request.user, reason=reason or 'Bulk delete',
                    )
                entry['ok'] = True
            except (LifecycleError, DeliveryError) as exc:
                entry['ok'] = False
                entry['error'] = getattr(exc, 'message', str(exc))
            except DRFPermissionDenied:
                entry['ok'] = False
                entry['error'] = 'You do not have permission for this order.'
            except Exception as exc:  # noqa: BLE001 — never let one order kill the batch
                entry['ok'] = False
                entry['error'] = str(exc)
            results.append(entry)

        succeeded = sum(1 for r in results if r.get('ok'))
        return Response({
            'results': results,
            'summary': {
                'total': len(results),
                'succeeded': succeeded,
                'failed': len(results) - succeeded,
            },
        })

    @staticmethod
    def _lock_payload(order: Order) -> dict:
        user = order.edit_locked_by
        return {
            'locked': bool(user and order.edit_lock_expires_at and order.edit_lock_expires_at > timezone.now()),
            'user_id': user.id if user else None,
            'user_name': user.get_full_name() or user.get_username() if user else None,
            'locked_at': order.edit_locked_at,
            'expires_at': order.edit_lock_expires_at,
            'token': order.edit_lock_token,
        }

    @action(detail=True, methods=['post'], url_path='edit-lock')
    def acquire_edit_lock(self, request, pk=None):
        """Acquire or take over an expiring edit lock for collaborative order editing."""
        order = self.get_object()
        self._require_permission(request.user, self._permission_for_edit(order), order)
        serializer = OrderEditLockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            # of=('self',) locks ONLY the sales_order row. Without it, the
            # select_related('edit_locked_by') LEFT OUTER JOIN (the FK is
            # nullable) makes Postgres reject the lock: "FOR UPDATE cannot be
            # applied to the nullable side of an outer join".
            locked = (
                Order.all_objects
                .select_for_update(of=('self',))
                .select_related('edit_locked_by')
                .get(pk=order.pk)
            )
            now = timezone.now()
            active_other = (
                locked.edit_locked_by_id
                and locked.edit_locked_by_id != request.user.id
                and locked.edit_lock_expires_at
                and locked.edit_lock_expires_at > now
            )
            if active_other and not serializer.validated_data.get('force'):
                return Response(
                    {'detail': 'Order is currently being edited.', 'lock': self._lock_payload(locked)},
                    status=status.HTTP_409_CONFLICT,
                )

            previous_user = locked.edit_locked_by
            token = uuid.uuid4().hex
            locked.edit_locked_by = request.user
            locked.edit_locked_at = now
            locked.edit_lock_heartbeat_at = now
            locked.edit_lock_expires_at = now + timedelta(seconds=90)
            locked.edit_lock_token = token
            locked._actor = request.user
            locked.save(update_fields=[
                'edit_locked_by', 'edit_locked_at', 'edit_lock_heartbeat_at',
                'edit_lock_expires_at', 'edit_lock_token', 'updated_at',
            ])
            if previous_user and previous_user.id != request.user.id:
                OrderLoggingService.log(
                    order=locked,
                    action=OrderLog.Action.EDIT_LOCK_TAKEN_OVER,
                    user=request.user,
                    details={'previous_user_id': previous_user.id, 'previous_user_name': previous_user.get_full_name() or previous_user.get_username()},
                )
            else:
                OrderLoggingService.log(
                    order=locked,
                    action=OrderLog.Action.EDIT_LOCK_ACQUIRED,
                    user=request.user,
                    details={},
                )

        return Response({'lock': self._lock_payload(locked), 'order': OrderDetailSerializer(locked).data})

    @action(detail=True, methods=['post'], url_path='edit-lock-heartbeat')
    def heartbeat_edit_lock(self, request, pk=None):
        """Extend the current user's edit lock; returns 409 if another user took over."""
        order = self.get_object()
        self._require_permission(request.user, self._permission_for_edit(order), order)
        serializer = OrderEditLockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data.get('token', '')

        with transaction.atomic():
            # of=('self',) locks ONLY the sales_order row. Without it, the
            # select_related('edit_locked_by') LEFT OUTER JOIN (the FK is
            # nullable) makes Postgres reject the lock: "FOR UPDATE cannot be
            # applied to the nullable side of an outer join".
            locked = (
                Order.all_objects
                .select_for_update(of=('self',))
                .select_related('edit_locked_by')
                .get(pk=order.pk)
            )
            if locked.edit_locked_by_id != request.user.id or (token and locked.edit_lock_token != token):
                return Response(
                    {'detail': 'Another user is editing this order.', 'lock': self._lock_payload(locked)},
                    status=status.HTTP_409_CONFLICT,
                )
            now = timezone.now()
            locked.edit_lock_heartbeat_at = now
            locked.edit_lock_expires_at = now + timedelta(seconds=90)
            locked.save(update_fields=['edit_lock_heartbeat_at', 'edit_lock_expires_at', 'updated_at'])
        return Response({'lock': self._lock_payload(locked)})

    @action(detail=True, methods=['post'], url_path='release-edit-lock')
    def release_edit_lock(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, self._permission_for_edit(order), order)
        serializer = OrderEditLockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data.get('token', '')

        with transaction.atomic():
            # of=('self',) locks ONLY the sales_order row. Without it, the
            # select_related('edit_locked_by') LEFT OUTER JOIN (the FK is
            # nullable) makes Postgres reject the lock: "FOR UPDATE cannot be
            # applied to the nullable side of an outer join".
            locked = (
                Order.all_objects
                .select_for_update(of=('self',))
                .select_related('edit_locked_by')
                .get(pk=order.pk)
            )
            if locked.edit_locked_by_id == request.user.id and (not token or locked.edit_lock_token == token):
                locked.edit_locked_by = None
                locked.edit_locked_at = None
                locked.edit_lock_heartbeat_at = None
                locked.edit_lock_expires_at = None
                locked.edit_lock_token = ''
                locked._actor = request.user
                locked.save(update_fields=[
                    'edit_locked_by', 'edit_locked_at', 'edit_lock_heartbeat_at',
                    'edit_lock_expires_at', 'edit_lock_token', 'updated_at',
                ])
                OrderLoggingService.log(
                    order=locked,
                    action=OrderLog.Action.EDIT_LOCK_RELEASED,
                    user=request.user,
                    details={},
                )
        return Response({'lock': self._lock_payload(locked)})

    # ── Delivery endpoints ────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='submit-delivery')
    def submit_delivery(self, request, pk=None):
        """
        Submit this order to the external delivery provider.

        Behaviour:
          - If Celery is configured → enqueue the task (returns 202).
          - Otherwise             → run synchronously (returns 200).

        Guards: order must be PROCESSING and delivery_status must be NONE/FAILED.
        """
        order = self.get_object()
        self._require_permission(request.user, 'send_to_delivery_orders', order)

        # Run through the lifecycle service so the duplicate-submission guard is
        # enforced before the external API call.
        try:
            result = OrderLifecycleService.submit_delivery(order, actor=request.user)
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        except DeliveryError as exc:
            response_status = status.HTTP_400_BAD_REQUEST
            if exc.status_code >= 500 or not exc.status_code and (
                'cannot reach' in exc.message.lower()
                or 'timeout' in exc.message.lower()
                or 'unexpected delivery api error' in exc.message.lower()
            ):
                response_status = status.HTTP_502_BAD_GATEWAY

            return Response(
                {
                    'detail': exc.message,
                    'delivery_status_code': exc.status_code or None,
                },
                status=response_status,
            )
        except Exception as exc:
            logger.exception('Unexpected delivery submission error for order %s', order.pk)
            return Response(
                {'detail': str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(
            {
                'detail': f'Order {order.order_number} submitted to delivery provider.',
                'order_id': order.id,
                'delivery_reference': order.delivery_reference,
                'async': False,
                'result': result,
            }
        )

    @action(detail=True, methods=['patch'], url_path='delivery-status')
    def update_delivery_status(self, request, pk=None):
        """
        Update the delivery status of an order.

        Used by:
          - Provider webhooks (forwarded through core webhook handler)
          - Staff manually correcting status

        Never auto-changes the WooCommerce order status.
        """
        order = self.get_object()
        self._require_permission(request.user, 'view_delivery_tracking_orders', order)

        serializer = DeliveryStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from apps.orders.delivery_service import DeliverySubmissionService
        service = DeliverySubmissionService()

        # Update delivery reference if provided
        if data.get('delivery_reference'):
            order.delivery_reference = data['delivery_reference']
            order.save(update_fields=['delivery_reference', 'updated_at'])

        # Store extra provider response data if provided
        if data.get('provider_response'):
            order.delivery_response = data['provider_response']
            order.save(update_fields=['delivery_response', 'updated_at'])

        service.update_from_provider(
            order=order,
            provider_status=data['delivery_status'],
            actor=request.user,
        )

        if data.get('note'):
            order.internal_note = (
                f"{order.internal_note}\n[Delivery] {data['note']}".strip()
            )
            order.save(update_fields=['internal_note', 'updated_at'])

        return self._transition_response(order, request)

    # ── Order Outcome Actions (Confirm / Delay / Cancel) ────────────────

    @action(detail=True, methods=['post'], url_path='confirm')
    def confirm_order(self, request, pk=None):
        """
        Mark order as confirmed by staff.

        Sets outcome=CONFIRMED and records the timestamp + actor.
        Logs the action in the audit trail.
        """
        order = self.get_object()
        self._require_permission(request.user, 'confirm_orders', order)

        serializer = OrderConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            order = OrderLifecycleService.confirm(
                order, actor=request.user, note=data.get('note', ''),
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)

        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='not-answered')
    def not_answered(self, request, pk=None):
        """Record one unanswered client call attempt."""
        order = self.get_object()
        self._require_permission(request.user, 'update_unconfirmed_orders', order)
        try:
            order = OrderLifecycleService.mark_not_answered(
                order,
                actor=request.user,
                note=request.data.get('note', ''),
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='restore-delayed')
    def restore_delayed(self, request, pk=None):
        """Return a delayed order to the first-call pending state."""
        order = self.get_object()
        self._require_permission(request.user, 'delay_orders', order)
        try:
            order = OrderLifecycleService.restore_delayed(order, actor=request.user)
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='delay')
    def delay_order(self, request, pk=None):
        """
        Mark order as delayed with required date and reason.

        Sets outcome=DELAYED and stores delay_date, delay_reason.
        Logs the action in the audit trail.
        """
        order = self.get_object()
        self._require_permission(request.user, 'delay_orders', order)

        serializer = OrderDelaySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            order = OrderLifecycleService.delay(
                order,
                actor=request.user,
                delay_date=data['delay_date'],
                delay_reason=data['delay_reason'],
                note=data.get('note', ''),
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)

        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='cancel-outcome')
    def cancel_outcome(self, request, pk=None):
        """
        Mark order outcome as cancelled with required reason.

        Sets outcome=CANCELLED (this is the business outcome, separate
        from the order processing status). Also sets order status to CANCELLED.
        Logs the action in the audit trail.
        """
        order = self.get_object()
        self._require_permission(request.user, 'cancel_orders_lifecycle', order)

        serializer = OrderCancelOutcomeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            order = OrderLifecycleService.cancel(
                order,
                actor=request.user,
                reason=data['cancellation_reason'],
                note=data.get('note', ''),
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)

        return self._transition_response(order, request)

    @action(detail=False, methods=['post'], url_path='packaging-lookup')
    def packaging_lookup(self, request):
        """Find an outbound order by ticket, order code, WooCommerce ID, or delivery code."""
        self._require_permission(request.user, 'view_orders')
        serializer = OrderReturnLookupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        candidates = self._return_lookup_candidates(serializer.validated_data['query'])
        qs = (
            self._scope_queryset(Order.all_objects.all(), request.user, 'view_orders')
            .select_related(
                'company', 'sales_channel', 'pos_sales_channel', 'client',
                'created_by', 'deleted_by', 'packaged_by',
            )
            .prefetch_related('lines', 'lines__product')
            .filter(self._return_lookup_q(candidates))
            .distinct()
            .order_by('-created_at')
        )
        order = qs.first()
        if not order:
            return Response(
                {'detail': 'No order matched this ticket, WooCommerce ID, order code, or delivery code.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        self._require_permission(request.user, 'view_orders', order)

        warnings = []
        if not (order.delivery_code or order.delivery_reference or order.in_store_pickup):
            warnings.append('This order has no delivery code yet. Send it to delivery before packaging.')
        if order.outcome == Order.Outcome.CANCELLED or order.status == Order.Status.CANCELLED:
            warnings.append('This order is cancelled. Packaging should be blocked unless a manager confirms.')
        if order.returned_at or order.delivery_status in (
            Order.DeliveryStatus.RETURNED,
            Order.DeliveryStatus.CANCELLED,
        ):
            warnings.append('This order is already returned/cancelled in delivery.')

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.PACKAGING_UPDATED,
            user=request.user,
            details={
                'event': 'packaging_scan_lookup',
                'query': serializer.validated_data['query'],
                'matched_candidates': sorted(candidates),
                'warnings': warnings,
            },
        )
        return Response({
            'query': serializer.validated_data['query'],
            'matches': qs.count(),
            'warnings': warnings,
            'order': OrderDetailSerializer(order).data,
        })

    @action(detail=True, methods=['post'], url_path='package')
    def package_order(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, 'update_confirmed_orders', order)
        serializer = OrderPackagingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = OrderLifecycleService.package_order(
                order,
                actor=request.user,
                packaging_items=serializer.validated_data['packaging_items'],
                allow_update=serializer.validated_data.get('allow_update', False),
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='unpackage')
    def unpackage_order(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, 'update_confirmed_orders', order)
        try:
            order = OrderLifecycleService.unpackage_order(order, actor=request.user)
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='mark-pickup')
    def mark_pickup(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, 'send_to_pos_orders', order)
        serializer = OrderPickupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = OrderLifecycleService.mark_in_store_pickup(
                order, actor=request.user, note=serializer.validated_data.get('note', ''),
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='send-to-pos')
    def send_to_pos(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, 'send_to_pos_orders', order)
        serializer = OrderSendToPOSSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = OrderLifecycleService.send_to_pos(
                order,
                pos_sales_channel=serializer.validated_data['pos_sales_channel'],
                actor=request.user,
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='validate-pos')
    def validate_pos(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, 'validate_pos_orders', order)
        serializer = OrderPOSCheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            order = OrderLifecycleService.validate_pos(
                order,
                actor=request.user,
                payment_method=data.get('payment_method', ''),
                payment_method_title=data.get('payment_method_title', ''),
                customer_note=data.get('customer_note', ''),
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='process-return')
    def process_return(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, 'process_return_orders', order)
        serializer = OrderReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = OrderLifecycleService.process_return(
                order,
                actor=request.user,
                reason=serializer.validated_data.get('return_reason', ''),
                return_type=serializer.validated_data.get('return_type'),
                line_conditions=serializer.validated_data.get('line_conditions') or None,
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='restore-return-stock')
    def restore_return_stock(self, request, pk=None):
        order = self.get_object()
        self._require_permission(request.user, 'restore_stock_from_return_orders', order)
        try:
            order = OrderLifecycleService.restore_stock_from_return(order, actor=request.user)
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return self._transition_response(order, request)

    # ── Manual status override + WooCommerce resync (Phase D) ────────────

    @action(detail=True, methods=['post'], url_path='manual-transition')
    def manual_transition(self, request, pk=None):
        """Admin/manager-only backward status override (reason required, audited).

        Gated on the ``manual_status_override`` permission. The lifecycle service
        re-validates the move against the current derived status, applies the
        documented side-effects (stock re-deduct / points / WC-sync intent) and
        writes the MANUAL_STATUS_OVERRIDE audit log. Any resulting WooCommerce
        push is scheduled after commit so the local status stays the source of
        truth even if the push later fails.
        """
        order = self.get_object()
        self._require_permission(request.user, 'manual_status_override', order)

        serializer = ManualTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            order = OrderLifecycleService.manual_transition(
                order,
                target=data['target'],
                actor=request.user,
                reason=data['reason'],
            )
        except LifecycleError as exc:
            return Response({'detail': exc.message}, status=status.HTTP_400_BAD_REQUEST)

        return self._transition_response(order, request)

    @action(detail=True, methods=['post'], url_path='retry-sync')
    def retry_sync(self, request, pk=None):
        """Retry a failed/parked WooCommerce status push.

        Explicit operator action — runs the push immediately with ``force=True``
        (bypassing the global gate). Never raises on a WooCommerce failure: the
        outcome is recorded on the order (``sync_status`` / ``sync_error_message``)
        and the local status is untouched.
        """
        order = self.get_object()
        self._require_permission(request.user, 'import_orders', order)
        if order.source != Order.Source.WOOCOMMERCE or not order.external_order_id:
            return Response(
                {'detail': 'Only WooCommerce-sourced orders can be re-synced.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        order = WooCommerceSyncService.retry(order, actor=request.user)
        return Response(OrderDetailSerializer(order).data)

    # ── Bulk-action endpoints (Phase 2) ──────────────────────────────────
    # Each accepts {"order_ids": [...], extras...} and returns per-item
    # success/failure. Each item is wrapped in its own transaction so one
    # failure doesn't roll back the whole batch.

    def _bulk_dispatch(self, request, *, permission: str, action_fn):
        self._require_permission(request.user, permission)
        order_ids = request.data.get('order_ids') or []
        if not isinstance(order_ids, list) or not order_ids:
            return Response(
                {'detail': 'order_ids must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        succeeded: list[int] = []
        failed: list[dict] = []
        for raw_id in order_ids:
            try:
                pk = int(raw_id)
            except (TypeError, ValueError):
                failed.append({'id': raw_id, 'error': 'invalid id'})
                continue
            try:
                qs = self._scope_queryset(
                    Order.all_objects.all(), request.user, 'view_orders',
                )
                order = qs.get(pk=pk)
            except Order.DoesNotExist:
                failed.append({'id': pk, 'error': 'not found'})
                continue
            try:
                with transaction.atomic():
                    action_fn(order, request)
                succeeded.append(pk)
            except (LifecycleError, DeliveryError) as exc:
                failed.append({'id': pk, 'error': getattr(exc, 'message', str(exc))})
            except Exception as exc:  # noqa: BLE001
                failed.append({'id': pk, 'error': str(exc)})
        return Response({'succeeded': succeeded, 'failed': failed})

    @action(detail=False, methods=['post'], url_path='bulk-confirm')
    def bulk_confirm(self, request):
        def _do(order, req):
            OrderLifecycleService.confirm(order, actor=req.user, note=req.data.get('note', ''))
        return self._bulk_dispatch(request, permission='update_orders_status', action_fn=_do)

    @action(detail=False, methods=['post'], url_path='bulk-not-answered')
    def bulk_not_answered(self, request):
        def _do(order, req):
            OrderLifecycleService.mark_not_answered(
                order,
                actor=req.user,
                note=req.data.get('note', ''),
            )
        return self._bulk_dispatch(request, permission='update_orders_status', action_fn=_do)

    @action(detail=False, methods=['post'], url_path='bulk-delay')
    def bulk_delay(self, request):
        delay_date = request.data.get('delay_date')
        if not delay_date:
            return Response({'detail': 'delay_date is required.'}, status=status.HTTP_400_BAD_REQUEST)
        reason = request.data.get('delay_reason', '')
        def _do(order, req):
            OrderLifecycleService.delay(
                order, actor=req.user, delay_date=delay_date,
                delay_reason=reason, note=req.data.get('note', ''),
            )
        return self._bulk_dispatch(request, permission='update_orders_status', action_fn=_do)

    @action(detail=False, methods=['post'], url_path='bulk-cancel')
    def bulk_cancel(self, request):
        reason = request.data.get('reason', '')
        def _do(order, req):
            OrderLifecycleService.cancel(order, actor=req.user, reason=reason, note=req.data.get('note', ''))
        return self._bulk_dispatch(request, permission='update_orders_status', action_fn=_do)

    @action(detail=False, methods=['post'], url_path='bulk-send-delivery')
    def bulk_send_delivery(self, request):
        def _do(order, req):
            OrderLifecycleService.submit_delivery(order, actor=req.user)
        return self._bulk_dispatch(request, permission='send_to_delivery_orders', action_fn=_do)

    @action(detail=False, methods=['post'], url_path='return-lookup')
    def return_lookup(self, request):
        """Find an order from scanner text, QR URL, WooCommerce ID, or order code."""
        self._require_permission(request.user, 'view_orders')
        serializer = OrderReturnLookupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        candidates = self._return_lookup_candidates(serializer.validated_data['query'])
        qs = (
            self._scope_queryset(Order.all_objects.all(), request.user, 'view_orders')
            .select_related('company', 'sales_channel', 'pos_sales_channel', 'client', 'created_by', 'deleted_by')
            .prefetch_related('lines', 'lines__product')
            .filter(self._return_lookup_q(candidates))
            .distinct()
            .order_by('-created_at')
        )
        order = qs.first()
        if not order:
            return Response(
                {'detail': 'No order matched this barcode, QR code, WooCommerce ID, or order code.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        self._require_permission(request.user, 'view_orders', order)
        return Response({
            'query': serializer.validated_data['query'],
            'matches': qs.count(),
            'order': OrderDetailSerializer(order).data,
        })

    # ── Summary / stats ──────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        """Return order KPIs for the dashboard (aggregates ALL statuses)."""
        from django.db.models import Count, Sum, Q

        self._require_permission(request.user, 'view_orders')

        qs = self._scope_queryset(Order.objects.all(), request.user, 'view_orders')
        deleted_qs = self._scope_queryset(
            Order.all_objects.filter(is_deleted=True),
            request.user,
            'view_orders',
        )

        for param, field in (
            ('company', 'company_id'),
            ('sales_channel', 'sales_channel_id'),
            ('brand', 'sales_channel__brand_id'),
            ('status', 'status'),
            ('wc_status', 'wc_status'),
            ('source', 'source'),
            ('payment_status', 'payment_status'),
            ('contact_status', 'contact_status'),
            ('return_exchange_status', 'return_exchange_status'),
        ):
            value = request.query_params.get(param)
            if value and value != 'all':
                qs = qs.filter(**{field: value})
                deleted_qs = deleted_qs.filter(**{field: value})

        qs = self._apply_search(qs, request.query_params.get('search'))
        deleted_qs = self._apply_search(deleted_qs, request.query_params.get('search'))

        data = qs.aggregate(
            total_orders        = Count('id'),
            pending             = Count('id', filter=Q(status=Order.Status.PENDING)),
            processing          = Count('id', filter=Q(status=Order.Status.PROCESSING)),
            completed           = Count('id', filter=Q(status=Order.Status.COMPLETED)),
            cancelled           = Count('id', filter=Q(status=Order.Status.CANCELLED)),
            revenue             = Sum('total', filter=Q(status__in=[
                Order.Status.PROCESSING, Order.Status.COMPLETED,
            ])),
            woocommerce_count   = Count('id', filter=Q(source=Order.Source.WOOCOMMERCE)),
            pos_count           = Count('id', filter=Q(source=Order.Source.POS)),
            manual_count        = Count('id', filter=Q(source=Order.Source.MANUAL)),
            # Outcome counts
            confirmed_count     = Count('id', filter=Q(outcome=Order.Outcome.CONFIRMED)),
            delayed_count       = Count('id', filter=Q(outcome=Order.Outcome.DELAYED)),
            cancelled_outcome   = Count('id', filter=Q(outcome=Order.Outcome.CANCELLED)),
        )
        data['revenue'] = str(data['revenue'] or '0.00')
        data['flow_counts'] = {
            'all': qs.count(),
            'needs_confirmation': qs.filter(
                outcome=Order.Outcome.NONE,
            ).exclude(
                source=Order.Source.POS,
            ).filter(
                status__in=[
                    Order.Status.PENDING,
                    Order.Status.PROCESSING,
                    Order.Status.ON_HOLD,
                    Order.Status.COMPLETED,
                ],
            ).count(),
            'delayed': qs.filter(outcome=Order.Outcome.DELAYED).count(),
            'ready_delivery': qs.filter(
                outcome=Order.Outcome.CONFIRMED,
                in_store_pickup=False,
            ).exclude(
                source=Order.Source.POS,
            ).filter(
                delivery_status__in=[
                    Order.DeliveryStatus.NONE,
                    Order.DeliveryStatus.PENDING,
                    Order.DeliveryStatus.FAILED,
                ],
            ).count(),
            'pickup': qs.filter(
                in_store_pickup=True,
                pos_validated_at__isnull=True,
            ).count(),
            'waiting_pos': qs.filter(
                in_store_pickup=True,
                sent_to_pos_at__isnull=False,
                pos_validated_at__isnull=True,
            ).count(),
            'in_delivery': qs.filter(delivery_status__in=[
                Order.DeliveryStatus.QUEUED,
                Order.DeliveryStatus.SUBMITTED,
                Order.DeliveryStatus.ACCEPTED,
                Order.DeliveryStatus.IN_TRANSIT,
            ]).count(),
            'packaged': qs.filter(
                packaging_status__in=[
                    Order.PackagingStatus.PACKAGED,
                    Order.PackagingStatus.UPDATED,
                ],
                final_outcome=Order.FinalOutcome.NONE,
            ).count(),
            'waiting_delivery_result': qs.filter(
                delivery_status__in=[
                    Order.DeliveryStatus.SUBMITTED,
                    Order.DeliveryStatus.ACCEPTED,
                    Order.DeliveryStatus.IN_TRANSIT,
                ],
                final_outcome=Order.FinalOutcome.NONE,
            ).count(),
            'failed_delivery': qs.filter(
                final_outcome=Order.FinalOutcome.FAILED_DELIVERY,
            ).count(),
            'done': qs.filter(
                (
                    Q(final_outcome=Order.FinalOutcome.SUCCESSFUL_SALE) |
                    Q(source=Order.Source.POS, status=Order.Status.COMPLETED)
                )
                & Q(returned_at__isnull=True)
                & ~Q(delivery_status=Order.DeliveryStatus.RETURNED)
                & ~Q(delivery_status=Order.DeliveryStatus.CANCELLED)
                & ~Q(return_exchange_status__in=[
                    Order.ReturnExchangeStatus.RETURNED,
                    Order.ReturnExchangeStatus.EXCHANGED,
                ])
            ).count(),
            'returned': qs.filter(
                Q(returned_at__isnull=False) |
                Q(delivery_status=Order.DeliveryStatus.RETURNED) |
                Q(return_exchange_status=Order.ReturnExchangeStatus.RETURNED) |
                Q(final_outcome=Order.FinalOutcome.RETURNED)
            ).count(),
            'exchanged': qs.filter(
                return_exchange_status=Order.ReturnExchangeStatus.EXCHANGED
            ).count(),
            'cancelled': qs.filter(
                Q(outcome=Order.Outcome.CANCELLED) |
                Q(status=Order.Status.CANCELLED)
            ).count(),
            'deleted': (
                deleted_qs.count()
                if request.user.is_superuser or PermissionService.has_permission(
                    request.user,
                    'view_soft_deleted_orders',
                )
                else 0
            ),
        }

        # Phase 2 — 10-state workflow tabs (one filter per bucket, clean queries).
        data['workflow_counts'] = {
            'all': qs.count(),
            'pending':          qs.filter(workflow_status=Order.WorkflowStatus.PENDING).count(),
            'answered':         qs.filter(workflow_status=Order.WorkflowStatus.ANSWERED).count(),
            'not_answered':     qs.filter(workflow_status=Order.WorkflowStatus.NOT_ANSWERED).count(),
            'delayed':          qs.filter(workflow_status=Order.WorkflowStatus.DELAYED).count(),
            'sent_to_delivery': qs.filter(workflow_status=Order.WorkflowStatus.SENT_TO_DELIVERY).count(),
            'packaging':        qs.filter(workflow_status=Order.WorkflowStatus.PACKAGING).count(),
            'done':             qs.filter(workflow_status=Order.WorkflowStatus.DONE).count(),
            'retour':           qs.filter(workflow_status=Order.WorkflowStatus.RETOUR).count(),
            'cancelled':        qs.filter(workflow_status=Order.WorkflowStatus.CANCELLED).count(),
            'changed':          qs.filter(workflow_status=Order.WorkflowStatus.CHANGED).count(),
        }

        # Phase D — clean order_status KPI block (additive; the legacy buckets
        # above are untouched). Counts realised sales / revenue from the derived
        # order_status, so returns / exchanges / cancellations are excluded
        # automatically (they outrank ``done`` in the precedence).
        kpis = OrderKPIService.compute(queryset=qs)
        kpis['revenue'] = str(kpis['revenue'])
        data['order_status_kpis'] = kpis

        # Revenue is sensitive financial data. Strip the aggregate revenue
        # figures for users who lack ``can_view_financial_reports`` (Super
        # Admin / CEO / company Manager keep them). Per-order ``total`` and the
        # order-detail money totals are NOT touched — staff still process
        # orders; only the dashboard aggregates are gated. Defence-in-depth:
        # the frontend also hides the cards, but the client is never trusted.
        can_view_revenue = (
            request.user.is_superuser
            or PermissionService.has_permission(
                request.user, 'can_view_financial_reports'
            )
        )
        if not can_view_revenue:
            data.pop('revenue', None)
            if isinstance(data.get('order_status_kpis'), dict):
                data['order_status_kpis'].pop('revenue', None)

        return Response(data)

    # ── WooCommerce helpers ──────────────────────────────────────────────

    @staticmethod
    def _get_wc_channel(sales_channel_id, user):
        """Validate and return a WooCommerce SalesChannel."""
        if not sales_channel_id:
            return None, Response(
                {'detail': 'sales_channel is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            channel = SalesChannel.objects.select_related('brand__company').get(
                id=sales_channel_id,
            )
        except SalesChannel.DoesNotExist:
            return None, Response(
                {'detail': 'Sales channel not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        if channel.channel_type != SalesChannel.ChannelType.WOOCOMMERCE:
            return None, Response(
                {'detail': 'Not a WooCommerce channel.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return channel, None

    @staticmethod
    def _wc_client(channel):
        """Return a WooCommerceAPI client for the given channel."""
        return WooCommerceAPI(
            url=channel.wc_store_url,
            consumer_key=channel.wc_consumer_key,
            consumer_secret=channel.wc_consumer_secret,
            version='wc/v3',
            timeout=WC_HTTP_TIMEOUT_SECONDS,
        )

    @staticmethod
    def _fetch_wc_import_orders(
        wc_api,
        per_page: int = WC_FETCH_PER_PAGE,
        max_pages: Optional[int] = None,
        after=None,
        max_orders: Optional[int] = None,
    ) -> list:
        """
        Fetch WooCommerce orders with the configured import status.

        Paginates through every page until WooCommerce returns an empty batch.
        No artificial cap — returns exactly what WooCommerce has.
        """
        params = {
            'per_page': per_page,
            'orderby':  'date',
            'order':    'desc',
            'status':   WC_IMPORT_STATUS,
        }
        if after:
            params['after'] = after.isoformat()

        all_orders: list = []
        page = 1

        while True:
            if max_pages is not None and page > max_pages:
                break

            params['page'] = page
            try:
                resp = wc_api.get('orders', params=params)
            except requests_exceptions.Timeout as exc:
                raise TimeoutError(
                    f"WooCommerce timed out at page {page}. Retry later."
                ) from exc
            except requests_exceptions.RequestException as exc:
                raise ConnectionError(
                    f"WooCommerce request failed at page {page}: {exc}"
                ) from exc

            if resp.status_code >= 400:
                raise Exception(f"WC API error {resp.status_code}: {resp.text[:300]}")

            batch = resp.json()
            if not batch:
                break

            all_orders.extend(batch)
            if max_orders and len(all_orders) >= max_orders:
                return all_orders[:max_orders]

            # Stop conditions: last page reached or partial page
            total_pages = int(resp.headers.get('X-WP-TotalPages', '0') or 0)
            if total_pages and page >= total_pages:
                break
            if len(batch) < per_page:
                break

            page += 1

        return all_orders

    @staticmethod
    def _fetch_wc_import_orders_page(
        wc_api,
        *,
        page: int,
        per_page: int,
        search: str = '',
    ) -> dict:
        """
        Fetch one lightweight page for preview.

        Preview must be fast and safe for large WooCommerce stores, so it does
        not download every historical order before opening the UI.
        """
        params = {
            'per_page': per_page,
            'page': page,
            'orderby': 'date',
            'order': 'desc',
            'status': WC_IMPORT_STATUS,
            '_fields': WC_PREVIEW_FIELDS,
        }
        if search:
            params['search'] = search

        try:
            resp = wc_api.get('orders', params=params)
        except requests_exceptions.Timeout as exc:
            raise TimeoutError(
                f"WooCommerce timed out while loading preview page {page}."
            ) from exc
        except requests_exceptions.RequestException as exc:
            raise ConnectionError(
                f"WooCommerce preview request failed at page {page}: {exc}"
            ) from exc

        if resp.status_code >= 400:
            raise Exception(f"WC API error {resp.status_code}: {resp.text[:300]}")

        return {
            'orders': resp.json(),
            'total': int(resp.headers.get('X-WP-Total', '0') or 0),
            'total_pages': int(resp.headers.get('X-WP-TotalPages', '0') or 0),
        }

    @staticmethod
    def _last_successful_sync_start(channel: SalesChannel):
        last_finished_at = (
            OrderSyncEvent.objects
            .filter(
                sales_channel=channel,
                status__in=[
                    OrderSyncEvent.SyncStatus.COMPLETED,
                    OrderSyncEvent.SyncStatus.PARTIAL,
                ],
                finished_at__isnull=False,
            )
            .order_by('-finished_at')
            .values_list('finished_at', flat=True)
            .first()
        )
        if last_finished_at:
            return last_finished_at - timedelta(minutes=SYNC_OVERLAP_MINUTES)

        # If old imports exist but no sync event was recorded, avoid a costly
        # historical pull by continuing from the newest local Woo timestamp.
        latest_wc_timestamp = (
            Order.all_objects
            .filter(
                sales_channel=channel,
                source=Order.Source.WOOCOMMERCE,
                wc_status=WC_IMPORT_STATUS,
                wc_date_modified__isnull=False,
            )
            .order_by('-wc_date_modified')
            .values_list('wc_date_modified', flat=True)
            .first()
        )
        if latest_wc_timestamp is None:
            latest_wc_timestamp = (
                Order.all_objects
                .filter(
                    sales_channel=channel,
                    source=Order.Source.WOOCOMMERCE,
                    wc_status=WC_IMPORT_STATUS,
                    wc_date_created__isnull=False,
                )
                .order_by('-wc_date_created')
                .values_list('wc_date_created', flat=True)
                .first()
            )

        if latest_wc_timestamp:
            return latest_wc_timestamp - timedelta(minutes=SYNC_OVERLAP_MINUTES)

        return None

    # ── Sync all orders from WooCommerce ────────────────────────────────

    @action(detail=False, methods=['post'], url_path='sync')
    def sync(self, request):
        """
        Pull WooCommerce processing orders into the local DB.
        Records an OrderSyncEvent for audit.

        Only fetches status=processing. Incremental sync is used by default so
        normal operations pull new/changed website orders instead of history.

        Body params:
          sales_channel  (int)   – required
          incremental    (bool)  – default true
          max_orders     (int)   – optional safety/debug cap
        """
        channel, err = self._get_wc_channel(
            request.data.get('sales_channel'), request.user,
        )
        if err:
            return err
        self._require_permission_for_channel(request.user, 'import_orders', channel)

        incremental = self._safe_bool(request.data.get('incremental'), default=True)
        max_orders = request.data.get('max_orders')
        max_orders = self._safe_positive_int(max_orders, 0) if max_orders else None

        sync_from = self._last_successful_sync_start(channel) if incremental else None
        event = OrderSyncEvent.objects.create(
            sales_channel      = channel,
            company            = channel.brand.company,
            triggered_by       = request.user,
            trigger_source     = OrderSyncEvent.TriggerSource.MANUAL,
            status             = OrderSyncEvent.SyncStatus.RUNNING,
            sync_from          = sync_from,
            sync_to            = timezone.now(),
            wc_statuses_synced = [WC_IMPORT_STATUS],
        )

        # ── Try to offload to Celery ──────────────────────────────────────
        try:
            from apps.orders.tasks import sync_orders_for_channel
            sync_orders_for_channel.delay(
                sales_channel_id=channel.id,
                incremental=incremental,
                triggered_by_user_id=request.user.id,
                max_orders=max_orders,
                event_id=event.id,
            )
            return Response(
                {
                    'detail': f'Sync enqueued for channel "{channel.name}".',
                    'event_id': event.id,
                    'sales_channel': channel.id,
                    'incremental': incremental,
                    'async': True,
                },
                status=status.HTTP_202_ACCEPTED,
            )
        except Exception as exc:
            logger.warning("Celery enqueue failed; falling back to bounded sync: %s", exc)

        # ── Synchronous fallback is intentionally bounded ─────────────────
        # If the worker is unavailable, never block the request on a full
        # historical import. Incremental syncs remain useful; full syncs are
        # limited to one page so operators get a clear response quickly.
        fallback_max_pages = None if incremental else 1
        fallback_max_orders = max_orders or (None if incremental else WC_FETCH_PER_PAGE)

        event.sync_from = sync_from
        event.sync_to = timezone.now()
        event.save(update_fields=['sync_from', 'sync_to'])

        logger.info(
            "Running bounded synchronous WooCommerce sync channel=%s incremental=%s max_pages=%s max_orders=%s",
            channel.name,
            incremental,
            fallback_max_pages,
            fallback_max_orders,
        )

        try:
            wc_client = self._wc_client(channel)
            wc_orders = self._fetch_wc_import_orders(
                wc_client,
                max_pages=fallback_max_pages,
                after=sync_from,
                max_orders=fallback_max_orders,
            )
        except Exception as exc:
            logger.error("WooCommerce fetch failed for sync: %s", exc)
            event.finish(
                created=0, updated=0, errors=1,
                error_detail=[{'wc_id': None, 'error': str(exc)}],
                status=OrderSyncEvent.SyncStatus.FAILED,
            )
            return Response(
                {'detail': f'Failed to fetch orders from WooCommerce: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        event.fetched_count = len(wc_orders)
        event.save(update_fields=['fetched_count'])

        created, updated, errors, error_details = OrderIngestionService.bulk_sync(
            wc_orders=wc_orders,
            sales_channel=channel,
            source=Order.Source.WOOCOMMERCE,
            created_by=request.user,
            sync_event=event,
        )

        event.finish(created=created, updated=updated, errors=errors, error_detail=error_details)

        return Response({
            'detail':   'Sync completed.',
            'event_id': event.id,
            'created':  created,
            'updated':  updated,
            'errors':   errors,
            'total':    len(wc_orders),
            'async':    False,
            'incremental': incremental,
            'fallback_bounded': True,
        })

    # ── Preview orders (fetch without saving) ────────────────────────────

    @action(detail=False, methods=['post'], url_path='preview')
    def preview(self, request):
        """
        Preview one page of new WooCommerce processing orders (no DB writes).
        Existing local WooCommerce orders are hidden by default.

        Body params:
          sales_channel  (int)  – required
          page           (int)  – default 1
          page_size      (int)  – default 25, max 100
          search         (str)  – optional WooCommerce search term
          new_only       (bool) – default true, hide already imported orders
        """
        channel, err = self._get_wc_channel(
            request.data.get('sales_channel'), request.user,
        )
        if err:
            return err
        self._require_permission_for_channel(request.user, 'view_orders', channel)

        page = self._safe_positive_int(request.data.get('page'), 1)
        page_size = self._safe_positive_int(
            request.data.get('page_size'),
            WC_PREVIEW_PER_PAGE,
            maximum=WC_PREVIEW_MAX_PER_PAGE,
        )
        search = str(request.data.get('search') or '').strip()
        new_only = self._safe_bool(request.data.get('new_only'), default=True)

        try:
            wc_client = self._wc_client(channel)
            page_data = self._fetch_wc_import_orders_page(
                wc_client,
                page=page,
                per_page=page_size,
                search=search,
            )
            wc_orders = page_data['orders']
        except TimeoutError as exc:
            logger.warning("WooCommerce preview timeout: %s", exc)
            return Response({'detail': str(exc)}, status=status.HTTP_504_GATEWAY_TIMEOUT)
        except Exception as exc:
            logger.error("WooCommerce preview fetch failed: %s", exc)
            return Response(
                {'detail': f'Failed to fetch orders from WooCommerce: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        wc_ids = [str(o.get('id', '')) for o in wc_orders if o.get('id')]

        # Check only the visible page instead of scanning every local order.
        existing_ids = set(
            Order.all_objects.filter(
                sales_channel=channel,
                external_order_id__in=wc_ids,
            )
            .values_list('external_order_id', flat=True)
        )

        preview_items = []
        for o in wc_orders:
            wc_id   = str(o.get('id', ''))
            billing = o.get('billing', {})
            preview_items.append({
                'wc_id':                o.get('id'),
                'order_number':         o.get('number', ''),
                'status':               o.get('status', ''),
                'total':                o.get('total', '0'),
                'currency':             o.get('currency', 'TND'),
                'customer_name': (
                    f"{billing.get('first_name', '')} {billing.get('last_name', '')}".strip()
                ),
                'customer_email':       billing.get('email', ''),
                'line_items_count':     len(o.get('line_items', [])),
                'date_created':         o.get('date_created', ''),
                'payment_method_title': o.get('payment_method_title', ''),
                'exists_locally':       wc_id in existing_ids,
            })
        visible_items = [
            item for item in preview_items
            if not new_only or not item['exists_locally']
        ]

        return Response({
            'sales_channel':      channel.id,
            'sales_channel_name': channel.name,
            'status_filter':      WC_IMPORT_STATUS,
            'page':               page,
            'page_size':          page_size,
            'total_remote_count': page_data['total'],
            'total_pages':        page_data['total_pages'],
            'has_next':           bool(page_data['total_pages'] and page < page_data['total_pages']),
            'has_previous':       page > 1,
            'search':             search,
            'new_only':           new_only,
            'total_count':        len(visible_items),
            'existing_count':     sum(1 for p in preview_items if p['exists_locally']),
            'new_count':          sum(1 for p in preview_items if not p['exists_locally']),
            'orders':             visible_items,
        })

    # ── Sync selected orders by WC IDs ──────────────────────────────────

    @action(detail=False, methods=['post'], url_path='sync-selected')
    def sync_selected(self, request):
        """
        Fetch and sync only the specified WooCommerce order IDs.
        Body: {'sales_channel': id, 'wc_order_ids': [1, 2, 3]}
        Records an OrderSyncEvent for audit.
        """
        channel, err = self._get_wc_channel(
            request.data.get('sales_channel'), request.user,
        )
        if err:
            return err
        self._require_permission_for_channel(request.user, 'import_orders', channel)

        wc_order_ids = request.data.get('wc_order_ids', [])
        if not wc_order_ids:
            return Response(
                {'detail': 'wc_order_ids is required and must not be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        event = OrderSyncEvent.objects.create(
            sales_channel       = channel,
            company             = channel.brand.company,
            triggered_by        = request.user,
            trigger_source      = OrderSyncEvent.TriggerSource.MANUAL,
            status              = OrderSyncEvent.SyncStatus.RUNNING,
            sync_from           = None,
            sync_to             = timezone.now(),
            wc_statuses_synced  = [WC_IMPORT_STATUS],
        )

        try:
            wc_client = self._wc_client(channel)
            ids_str   = ','.join(str(i) for i in wc_order_ids)
            resp = wc_client.get(
                'orders',
                params={
                    'include': ids_str,
                    'per_page': 100,
                    'status': WC_IMPORT_STATUS,
                },
            )
            if resp.status_code >= 400:
                raise Exception(f"WC API error {resp.status_code}: {resp.text[:300]}")
            wc_orders = resp.json()
        except Exception as exc:
            logger.error("WooCommerce selected fetch failed: %s", exc)
            event.finish(
                created=0, updated=0, errors=1,
                error_detail=[{'wc_id': None, 'error': str(exc)}],
                status=OrderSyncEvent.SyncStatus.FAILED,
            )
            return Response(
                {'detail': f'Failed to fetch orders from WooCommerce: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        wc_orders = [
            o for o in wc_orders
            if str(o.get('status', '')).lower() == WC_IMPORT_STATUS
        ]

        event.fetched_count = len(wc_orders)
        event.save(update_fields=['fetched_count'])

        created, updated, errors, error_details = OrderIngestionService.bulk_sync(
            wc_orders=wc_orders,
            sales_channel=channel,
            source=Order.Source.WOOCOMMERCE,
            created_by=request.user,
            sync_event=event,
        )

        event.finish(created=created, updated=updated, errors=errors, error_detail=error_details)

        return Response({
            'detail':   'Selected orders synced.',
            'event_id': event.id,
            'created':  created,
            'updated':  updated,
            'errors':   errors,
            'total':    len(wc_orders),
        })

    @staticmethod
    def _require_permission_for_channel(user, codename: str, channel: SalesChannel):
        if user.is_superuser:
            return
        if not PermissionService.has_permission(
            user,
            codename,
            company=channel.brand.company,
            brand=channel.brand,
            sales_channel=channel,
        ):
            raise PermissionDenied('You do not have permission to perform this action.')


# ═════════════════════════════════════════════════════════════════════════════
# SYNC EVENT VIEWSET  (read-only)
# ═════════════════════════════════════════════════════════════════════════════

class OrderSyncEventViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only list/retrieve for OrderSyncEvent records.

    Query params:
      sales_channel  – filter by channel ID
      company        – filter by company ID
      status         – filter by sync status (running/completed/partial/failed)
    """
    serializer_class    = OrderSyncEventSerializer
    permission_classes  = [IsAuthenticated]
    filter_backends     = [DjangoFilterBackend, OrderingFilter]
    ordering_fields     = ['started_at', 'finished_at']
    ordering            = ['-started_at']

    def get_queryset(self):
        user = self.request.user
        if not user.is_superuser and not PermissionService.has_permission(user, 'view_orders'):
            return OrderSyncEvent.objects.none()

        qs = OrderSyncEvent.objects.select_related(
            'sales_channel', 'company', 'triggered_by',
        ).all()

        # Workspace scoping (applies to Super Admin too): limit to the active
        # company unless an explicit ?company filter is given. No company
        # selected and none requested = global mode (all events).
        explicit_company = self.request.query_params.get('company')
        if explicit_company:
            qs = qs.filter(company_id=explicit_company)
        elif getattr(user, 'current_company_id', None):
            qs = qs.filter(company_id=user.current_company_id)

        # Active-brand focus narrows to that brand's channels.
        if getattr(user, 'current_brand_id', None):
            qs = qs.filter(sales_channel__brand_id=user.current_brand_id)

        channel_id = self.request.query_params.get('sales_channel')
        if channel_id:
            qs = qs.filter(sales_channel_id=channel_id)

        sync_status = self.request.query_params.get('status')
        if sync_status:
            qs = qs.filter(status=sync_status)

        return qs
