"""
LkSystem Sales Channels App - Views
"""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter

from .models import SalesChannel
from .signals import broadcast_channel_event
from .serializers import (
    SalesChannelSerializer,
    SalesChannelListSerializer,
    WebhookTokenSerializer,
)
from apps.rbac.permissions import ActionPermissionMixin


@extend_schema_view(
    list=extend_schema(
        tags=['Sales Channels'],
        summary='List all sales channels',
        description='Returns a paginated list of all sales channels. Supports filtering by brand, channel type, and active status.',
    ),
    create=extend_schema(
        tags=['Sales Channels'],
        summary='Create a sales channel',
        description='Create a new sales channel (WooCommerce or POS) under a brand.',
    ),
    retrieve=extend_schema(
        tags=['Sales Channels'],
        summary='Get sales channel details',
        description='Retrieve detailed information about a specific sales channel including its configuration.',
    ),
    update=extend_schema(
        tags=['Sales Channels'],
        summary='Update a sales channel',
        description='Update all fields of an existing sales channel.',
    ),
    partial_update=extend_schema(
        tags=['Sales Channels'],
        summary='Partial update a sales channel',
        description='Update specific fields of an existing sales channel.',
    ),
    destroy=extend_schema(
        tags=['Sales Channels'],
        summary='Delete a sales channel',
        description='Delete a sales channel.',
    ),
)
class SalesChannelViewSet(ActionPermissionMixin, viewsets.ModelViewSet):
    """
    API ViewSet for SalesChannel management.

    Provides CRUD operations for sales channels.
    Supports filtering by brand and channel type.
    """

    # RBAC: channel WRITES require sales-channel permissions (unlisted writes —
    # regenerate-webhook, store-url — default to edit_sales_channels). Reads
    # stay open (IsAuthenticated) and are channel-scoped in get_queryset, so
    # operational roles populate channel dropdowns without view_sales_channels.
    action_permissions = {
        'create': 'create_sales_channels',
        'destroy': 'delete_sales_channels',
    }
    default_write_permission = 'edit_sales_channels'

    queryset = SalesChannel.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['brand', 'channel_type', 'is_active']
    search_fields = ['name', 'brand__name', 'brand__company__name']
    ordering_fields = ['name', 'created_at', 'channel_type']
    ordering = ['name']
    
    def perform_create(self, serializer):
        instance = serializer.save()
        broadcast_channel_event('created', instance.id)

    def perform_update(self, serializer):
        instance = serializer.save()
        broadcast_channel_event('updated', instance.id)

    def perform_destroy(self, instance):
        channel_id = instance.id
        instance.delete()
        broadcast_channel_event('deleted', channel_id)

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        # Use full serializer for all operations to return all data
        return SalesChannelSerializer
    
    def get_queryset(self):
        """
        Scope channels per the user's RBAC reach. ``visible_sales_channel_ids``
        returns the union of:
          - explicit channel-level assignments (Cashier / Sales Rep),
          - every channel of the brands the user can access — which in
            turn includes ``allowed_brands`` AND every brand in the
            user's ``current_company`` when the user is company-scoped.

        Without this, a CEO with a single ``allowed_brands`` entry saw
        only that one brand's channels even though the role grants
        company-wide reach.
        """
        user = self.request.user
        queryset = super().get_queryset().select_related('brand', 'brand__company')

        from apps.rbac.services import visible_sales_channel_ids
        channel_ids = visible_sales_channel_ids(user)
        if channel_ids is None:
            return queryset
        if not channel_ids:
            return queryset.none()
        return queryset.filter(id__in=channel_ids)
    
    @extend_schema(
        tags=['Sales Channels'],
        summary='Filter channels by type',
        description='Get sales channels filtered by type (WOOCOMMERCE or POS).',
        parameters=[
            OpenApiParameter(name='type', description='Channel type (WOOCOMMERCE or POS)', required=False, type=str),
        ],
    )
    @action(detail=False, methods=['get'])
    def by_type(self, request):
        """
        Get sales channels filtered by type.
        GET /api/v1/sales-channels/by_type/?type=WOOCOMMERCE
        """
        channel_type = request.query_params.get('type', None)
        if channel_type:
            channels = self.get_queryset().filter(channel_type=channel_type)
        else:
            channels = self.get_queryset()
        
        page = self.paginate_queryset(channels)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(channels, many=True)
        return Response(serializer.data)
    
    @extend_schema(
        tags=['Sales Channels'],
        summary='Get active channels',
        description='Retrieve only active sales channels (is_active=True).',
    )
    @action(detail=False, methods=['get'])
    def active(self, request):
        """
        Get only active sales channels.
        GET /api/v1/sales-channels/active/
        """
        active_channels = self.get_queryset().filter(is_active=True)
        page = self.paginate_queryset(active_channels)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(active_channels, many=True)
        return Response(serializer.data)
    
    @extend_schema(
        tags=['Sales Channels'],
        summary='Get WooCommerce channels',
        description='Retrieve only WooCommerce sales channels.',
    )
    @action(detail=False, methods=['get'])
    def woocommerce(self, request):
        """
        Get only WooCommerce channels.
        GET /api/v1/sales-channels/woocommerce/
        """
        woo_channels = self.get_queryset().filter(
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE
        )
        page = self.paginate_queryset(woo_channels)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(woo_channels, many=True)
        return Response(serializer.data)
    
    @extend_schema(
        tags=['Sales Channels'],
        summary='Get POS channels',
        description='Retrieve only POS (Point of Sale) sales channels.',
    )
    @action(detail=False, methods=['get'])
    def pos(self, request):
        """
        Get only POS channels.
        GET /api/v1/sales-channels/pos/
        """
        pos_channels = self.get_queryset().filter(
            channel_type=SalesChannel.ChannelType.POS
        )
        page = self.paginate_queryset(pos_channels)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(pos_channels, many=True)
        return Response(serializer.data)
    
    @extend_schema(
        tags=['Sales Channels'],
        summary='Regenerate webhook token',
        description='''
Generate or regenerate the webhook token for this WooCommerce sales channel.

**⚠️ Warning:** This will replace the existing webhook token! Make sure to update your WooCommerce webhook settings with the new token.

**What is the webhook token?**
- This token is used by your WooCommerce store to authenticate when sending webhooks (order updates, etc.) to this system.
- Add this token to your WooCommerce webhook secret field.

**Note:** `consumer_key` and `consumer_secret` must be provided by the user from WooCommerce > Settings > REST API.

Only works for channels with type = WOOCOMMERCE.
''',
        responses={200: WebhookTokenSerializer},
    )
    @action(detail=True, methods=['post'], url_path='regenerate-webhook')
    def regenerate_webhook(self, request, pk=None):
        """
        Generate a new webhook token for this channel.
        POST /api/v1/sales-channels/{id}/regenerate-webhook/
        """
        channel = self.get_object()
        
        if channel.channel_type != SalesChannel.ChannelType.WOOCOMMERCE:
            return Response(
                {'error': 'This endpoint only works for WooCommerce channels.'},
                status=400
            )
        
        webhook_token = channel.generate_webhook_token()

        broadcast_channel_event('updated', channel.id)
        return Response({
            'message': 'Webhook token regenerated successfully.',
            'webhook_token': webhook_token,
            'channel_id': channel.id,
            'channel_name': channel.name,
            'usage_hint': 'Add this token to your WooCommerce webhook secret field.',
        })
    
    @extend_schema(
        tags=['Sales Channels'],
        summary='Update WooCommerce store URL',
        description='Update the WooCommerce store URL for this sales channel.',
    )
    @action(detail=True, methods=['patch'], url_path='store-url')
    def update_store_url(self, request, pk=None):
        """
        Update the WooCommerce store URL.
        PATCH /api/v1/sales-channels/{id}/store-url/
        """
        channel = self.get_object()
        store_url = request.data.get('store_url')
        
        if not store_url:
            return Response(
                {'error': 'store_url is required.'},
                status=400
            )
        
        channel.wc_store_url = store_url
        channel.save(update_fields=['wc_store_url', 'updated_at'])

        broadcast_channel_event('updated', channel.id)
        return Response({
            'message': 'Store URL updated successfully.',
            'store_url': store_url,
        })


# ──────────────────────────────────────────────────────────────────────
# CAISSE EXPENSES
# ──────────────────────────────────────────────────────────────────────

from decimal import Decimal
from datetime import datetime, time, timedelta
from django.db.models import Sum, Q
from django.utils import timezone
from rest_framework import status as http_status
from .models import CashMovement
from .serializers import CashMovementSerializer


def _day_bounds(day):
    """Return (start, end) timezone-aware datetimes for a given local date."""
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(day, time.min), tz)
    end = timezone.make_aware(datetime.combine(day, time.max), tz)
    return start, end


@extend_schema_view(
    list=extend_schema(
        tags=['POS Caisse'],
        summary='List caisse cash movements (expenses + alimentations)',
        parameters=[
            OpenApiParameter('type', str, description="Filter by side: 'expense' or 'deposit'."),
            OpenApiParameter('sales_channel', int, description='Filter by POS register id.'),
            OpenApiParameter('date_from', str, description='ISO date (inclusive).'),
            OpenApiParameter('date_to', str, description='ISO date (inclusive).'),
            OpenApiParameter('category', str, description='Sub-category value (depends on type).'),
        ],
    ),
    create=extend_schema(tags=['POS Caisse'], summary='Record a new caisse cash movement'),
    retrieve=extend_schema(tags=['POS Caisse']),
    update=extend_schema(tags=['POS Caisse']),
    partial_update=extend_schema(tags=['POS Caisse']),
    destroy=extend_schema(tags=['POS Caisse']),
)
class CashMovementViewSet(viewsets.ModelViewSet):
    """Unified POS caisse cash movements — expenses (cash out) and alimentations
    / deposits (cash in), discriminated by ``movement_type``. Filter a single
    side with ``?type=expense`` or ``?type=deposit``. Deleting is a soft delete
    so the caisse history keeps the original entry and its reversal.
    """
    serializer_class = CashMovementSerializer
    permission_classes = [IsAuthenticated]

    def _get_allowed_channel_ids(self):
        # Single source of truth for channel scoping (workspace-aware): scopes
        # a Super Admin to the selected company, narrows to the active brand,
        # and honours channel/brand assignments. None = global (no filter).
        from apps.rbac.services import visible_sales_channel_ids
        return visible_sales_channel_ids(self.request.user)

    def get_queryset(self):
        # Soft-deleted movements stay out of the lists (and can't be deleted
        # twice); they still surface in the caisse history/journal.
        qs = CashMovement.objects.filter(is_deleted=False).select_related(
            'sales_channel', 'sales_channel__brand', 'created_by',
        )
        allowed_channel_ids = self._get_allowed_channel_ids()
        if allowed_channel_ids is not None:
            qs = qs.filter(sales_channel_id__in=allowed_channel_ids)
        params = self.request.query_params
        # ``type`` selects one side of the till (expense / deposit).
        movement_type = params.get('type')
        if movement_type:
            qs = qs.filter(movement_type=movement_type)
        sc = params.get('sales_channel')
        if sc:
            qs = qs.filter(sales_channel_id=sc)
        category = params.get('category')
        if category:
            qs = qs.filter(category=category)
        date_from = params.get('date_from')
        if date_from:
            try:
                qs = qs.filter(occurred_at__date__gte=datetime.fromisoformat(date_from).date())
            except ValueError:
                pass
        date_to = params.get('date_to')
        if date_to:
            try:
                qs = qs.filter(occurred_at__date__lte=datetime.fromisoformat(date_to).date())
            except ValueError:
                pass
        return qs

    def perform_create(self, serializer):
        sc = serializer.validated_data['sales_channel']
        allowed_channel_ids = self._get_allowed_channel_ids()
        if allowed_channel_ids is not None and sc.id not in allowed_channel_ids:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('You do not have access to this POS caisse.')
        serializer.save(
            company_id=sc.brand.company_id,
            created_by=self.request.user if self.request.user.is_authenticated else None,
        )

    def perform_destroy(self, instance):
        # Soft delete so the movement stays in the caisse history as a reversing
        # entry; it stops counting toward the till balance.
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = (
            self.request.user if self.request.user.is_authenticated else None
        )
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'updated_at'])

    def _get_pos_channel_or_response(self, sc_id):
        try:
            channel = SalesChannel.objects.select_related('brand__company').get(pk=sc_id)
        except SalesChannel.DoesNotExist:
            return None, Response({'detail': 'Sales channel not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        # Caisse stats/history are available on every sales channel (POS and
        # WooCommerce alike); only access control gates them.
        allowed_channel_ids = self._get_allowed_channel_ids()
        if allowed_channel_ids is not None and channel.id not in allowed_channel_ids:
            return None, Response(
                {'detail': 'You do not have access to this POS caisse.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        return channel, None

    @staticmethod
    def _revenue_queryset(channel, start, end):
        from apps.orders.models import Order
        return Order.objects.filter(
            (
                Q(pos_sales_channel=channel)
                | Q(source=Order.Source.POS, sales_channel=channel)
            ),
            pos_validated_at__gte=start,
            pos_validated_at__lte=end,
        ).exclude(
            # Canonical lifecycle values are CANCELED / RETURNED (the old
            # CANCELLED / REFUNDED members no longer exist — referencing them
            # raised AttributeError and 500'd every caisse-stats call).
            status__in=[Order.Status.CANCELED, Order.Status.RETURNED],
        ).exclude(
            returned_at__isnull=False,
        )

    def _caisse_breakdown(self, channel, start, end):
        """Full daily cash-flow for a register, shared by stats + history.

        The physical drawer (``cash_balance``) counts only CASH-paid sales plus
        funding (alimentation), minus every cash-out (expenses incl. refunds).
        Card / bank-transfer sales are reported separately — they go to the bank,
        not the till. ``net_balance`` is kept (all-method revenue − expenses) for
        backward compatibility.
        """
        revenue_qs = self._revenue_queryset(channel, start, end)
        # Cash = explicit 'cash' or legacy/empty (the POS default is cash).
        cash_q = Q(payment_method__iexact='cash') | Q(payment_method='')
        cash_sales = revenue_qs.filter(cash_q).aggregate(t=Sum('total'))['t'] or Decimal('0')
        card_sales = revenue_qs.exclude(cash_q).aggregate(t=Sum('total'))['t'] or Decimal('0')
        revenue_total = cash_sales + card_sales
        revenue_count = revenue_qs.count()

        # Expenses (cash out) — exclude soft-deleted (a deleted dépense no
        # longer counts toward the balance).
        expense_qs = CashMovement.objects.filter(
            sales_channel=channel, movement_type=CashMovement.Type.EXPENSE,
            occurred_at__gte=start, occurred_at__lte=end, is_deleted=False,
        )
        expenses_total = expense_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')
        refunds = (
            expense_qs.filter(category='REFUND')
            .aggregate(t=Sum('amount'))['t'] or Decimal('0')
        )
        expenses_count = expense_qs.count()
        by_category = list(
            expense_qs.values('category').annotate(total=Sum('amount')).order_by('-total')
        )

        # Alimentations / deposits (cash in) — exclude soft-deleted.
        deposit_qs = CashMovement.objects.filter(
            sales_channel=channel, movement_type=CashMovement.Type.DEPOSIT,
            occurred_at__gte=start, occurred_at__lte=end, is_deleted=False,
        )
        funding_total = deposit_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')
        opening = (
            deposit_qs.filter(category='OPENING')
            .aggregate(t=Sum('amount'))['t'] or Decimal('0')
        )
        cash_added = funding_total - opening
        funding_count = deposit_qs.count()

        return {
            'revenue': revenue_total, 'revenue_count': revenue_count,
            'cash_sales': cash_sales, 'card_sales': card_sales,
            'expenses': expenses_total, 'expenses_count': expenses_count,
            'refunds': refunds,
            'opening': opening, 'cash_added': cash_added,
            'funding_total': funding_total, 'funding_count': funding_count,
            'net_balance': revenue_total - expenses_total,
            'cash_balance': funding_total + cash_sales - expenses_total,
            'by_category': by_category,
        }

    @action(detail=False, methods=['get'], url_path='caisse-stats')
    def caisse_stats(self, request):
        """Return today's revenue, dépenses, and net balance for a POS register.

        Query params:
          sales_channel (required) — POS channel id
          date (optional, ISO yyyy-mm-dd) — defaults to today (local tz)
        """
        sc_id = request.query_params.get('sales_channel')
        if not sc_id:
            return Response(
                {'detail': 'sales_channel query parameter is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        channel, response = self._get_pos_channel_or_response(sc_id)
        if response is not None:
            return response

        date_arg = request.query_params.get('date')
        if date_arg:
            try:
                day = datetime.fromisoformat(date_arg).date()
            except ValueError:
                return Response({'detail': 'Invalid date.'}, status=http_status.HTTP_400_BAD_REQUEST)
        else:
            day = timezone.localdate()
        start, end = _day_bounds(day)

        b = self._caisse_breakdown(channel, start, end)
        return Response({
            'date': day.isoformat(),
            'sales_channel': channel.id,
            'sales_channel_name': channel.name,
            'currency': 'TND',
            # Sales (revenue = all methods; cash/card split out)
            'revenue': str(b['revenue']),
            'revenue_count': b['revenue_count'],
            'cash_sales': str(b['cash_sales']),
            'card_sales': str(b['card_sales']),
            # Cash in — alimentation de caisse
            'opening': str(b['opening']),
            'cash_added': str(b['cash_added']),
            'funding_total': str(b['funding_total']),
            'funding_count': b['funding_count'],
            # Cash out
            'expenses': str(b['expenses']),
            'expenses_count': b['expenses_count'],
            'refunds': str(b['refunds']),
            # Balances
            'net_balance': str(b['net_balance']),
            'cash_balance': str(b['cash_balance']),
            'by_category': [
                {'category': row['category'], 'total': str(row['total'])}
                for row in b['by_category']
            ],
        })

    @action(detail=False, methods=['get'], url_path='caisse-history')
    def caisse_history(self, request):
        """Return day-by-day caisse history for a POS register."""
        sc_id = request.query_params.get('sales_channel')
        if not sc_id:
            return Response(
                {'detail': 'sales_channel query parameter is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        channel, response = self._get_pos_channel_or_response(sc_id)
        if response is not None:
            return response

        today = timezone.localdate()
        date_to_arg = request.query_params.get('date_to')
        date_from_arg = request.query_params.get('date_from')
        try:
            date_to = datetime.fromisoformat(date_to_arg).date() if date_to_arg else today
            date_from = (
                datetime.fromisoformat(date_from_arg).date()
                if date_from_arg else date_to - timedelta(days=13)
            )
        except ValueError:
            return Response({'detail': 'Invalid date range.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if date_from > date_to:
            return Response({'detail': 'date_from cannot be after date_to.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if (date_to - date_from).days > 60:
            return Response({'detail': 'Date range cannot exceed 60 days.'}, status=http_status.HTTP_400_BAD_REQUEST)

        rows = []
        day = date_to
        while day >= date_from:
            start, end = _day_bounds(day)
            b = self._caisse_breakdown(channel, start, end)
            rows.append({
                'date': day.isoformat(),
                'sales_channel': channel.id,
                'sales_channel_name': channel.name,
                'currency': 'TND',
                'revenue': str(b['revenue']),
                'revenue_count': b['revenue_count'],
                'cash_sales': str(b['cash_sales']),
                'expenses': str(b['expenses']),
                'expenses_count': b['expenses_count'],
                'funding_total': str(b['funding_total']),
                'net_balance': str(b['net_balance']),
                'cash_balance': str(b['cash_balance']),
            })
            day -= timedelta(days=1)
        return Response(rows)

    @action(detail=False, methods=['get'], url_path='caisse-journal')
    def caisse_journal(self, request):
        """Per-transaction caisse journal: every cash movement (sales, returns,
        expenses, alimentations) as its OWN row with a full timestamp, newest
        first. Powers the POS 'Historique de caisse' journal view. A sale shows
        on its validation date as money IN; a later return shows on its return
        date as money OUT — so a refunded order appears as both events."""
        from apps.orders.models import Order

        sc_id = request.query_params.get('sales_channel')
        if not sc_id:
            return Response(
                {'detail': 'sales_channel query parameter is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        channel, response = self._get_pos_channel_or_response(sc_id)
        if response is not None:
            return response

        today = timezone.localdate()
        date_to_arg = request.query_params.get('date_to')
        date_from_arg = request.query_params.get('date_from')
        try:
            date_to = datetime.fromisoformat(date_to_arg).date() if date_to_arg else today
            date_from = (
                datetime.fromisoformat(date_from_arg).date()
                if date_from_arg else date_to - timedelta(days=13)
            )
        except ValueError:
            return Response({'detail': 'Invalid date range.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if date_from > date_to:
            return Response({'detail': 'date_from cannot be after date_to.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if (date_to - date_from).days > 60:
            return Response({'detail': 'Date range cannot exceed 60 days.'}, status=http_status.HTTP_400_BAD_REQUEST)

        start = _day_bounds(date_from)[0]
        end = _day_bounds(date_to)[1]
        channel_q = Q(pos_sales_channel=channel) | Q(source=Order.Source.POS, sales_channel=channel)
        movements = []

        def _name(obj):
            return (obj.created_by.get_full_name() if getattr(obj, 'created_by_id', None) else '') or None

        # Sales — money IN (the sale event, on its validation date).
        for o in (
            Order.objects.filter(channel_q, pos_validated_at__gte=start, pos_validated_at__lte=end)
            .exclude(status=Order.Status.CANCELED).select_related('created_by')
        ):
            method = (o.payment_method or '').strip()
            movements.append({
                'id': f'sale-{o.id}', 'type': 'sale', 'type_display': 'Vente',
                'occurred_at': o.pos_validated_at.isoformat(),
                'amount': str(o.total), 'direction': 'in',
                'detail': o.order_number, 'payment_method': method or 'cash',
                'is_cash': method.lower() in ('', 'cash', 'espèces', 'especes'),
                'created_by_name': _name(o),
            })

        # Returns — money OUT (refund), on the return date.
        for o in (
            Order.objects.filter(channel_q, returned_at__gte=start, returned_at__lte=end)
            .select_related('created_by')
        ):
            movements.append({
                'id': f'return-{o.id}', 'type': 'return', 'type_display': 'Retour',
                'occurred_at': o.returned_at.isoformat(),
                'amount': str(o.total), 'direction': 'out',
                'detail': o.order_number, 'created_by_name': _name(o),
            })

        def _deleter_name(obj):
            return (obj.deleted_by.get_full_name() if getattr(obj, 'deleted_by_id', None) else '') or None

        cash_qs = CashMovement.objects.filter(
            sales_channel=channel,
        ).select_related('created_by', 'deleted_by')

        # Expenses (incl. refunds recorded as expenses) — money OUT, shown even
        # if later deleted so the history stays truthful.
        for e in cash_qs.filter(
            movement_type=CashMovement.Type.EXPENSE,
            occurred_at__gte=start, occurred_at__lte=end,
        ):
            movements.append({
                'id': f'expense-{e.id}', 'type': 'expense', 'type_display': e.category_display,
                'occurred_at': e.occurred_at.isoformat(),
                'amount': str(e.amount), 'direction': 'out',
                'detail': e.note or e.category_display, 'created_by_name': _name(e),
            })

        # Deleted expenses — the reversing money IN at the moment of deletion
        # (cancels the original OUT above, net zero, matching the balance).
        for e in cash_qs.filter(
            movement_type=CashMovement.Type.EXPENSE, is_deleted=True,
            deleted_at__gte=start, deleted_at__lte=end,
        ):
            movements.append({
                'id': f'expense-del-{e.id}', 'type': 'expense_deleted',
                'type_display': 'Dépense supprimée',
                'occurred_at': e.deleted_at.isoformat(),
                'amount': str(e.amount), 'direction': 'in',
                'detail': e.note or e.category_display, 'created_by_name': _deleter_name(e),
            })

        # Alimentations / deposits — the original money IN (shown even if the
        # alimentation was later deleted, so the history stays truthful).
        for d in cash_qs.filter(
            movement_type=CashMovement.Type.DEPOSIT,
            occurred_at__gte=start, occurred_at__lte=end,
        ):
            movements.append({
                'id': f'deposit-{d.id}', 'type': 'deposit', 'type_display': d.category_display,
                'occurred_at': d.occurred_at.isoformat(),
                'amount': str(d.amount), 'direction': 'in',
                'detail': d.note or d.category_display, 'created_by_name': _name(d),
            })

        # Deleted alimentations — the reversing money OUT at the moment of
        # deletion (cancels the original IN above, net zero).
        for d in cash_qs.filter(
            movement_type=CashMovement.Type.DEPOSIT, is_deleted=True,
            deleted_at__gte=start, deleted_at__lte=end,
        ):
            movements.append({
                'id': f'deposit-del-{d.id}', 'type': 'deposit_deleted',
                'type_display': 'Alimentation supprimée',
                'occurred_at': d.deleted_at.isoformat(),
                'amount': str(d.amount), 'direction': 'out',
                'detail': d.note or d.category_display, 'created_by_name': _deleter_name(d),
            })

        movements.sort(key=lambda m: m['occurred_at'], reverse=True)
        return Response({
            'sales_channel': channel.id,
            'sales_channel_name': channel.name,
            'currency': 'TND',
            'date_from': date_from.isoformat(),
            'date_to': date_to.isoformat(),
            'movements': movements[:500],
        })
