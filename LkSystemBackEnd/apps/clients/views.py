"""
LkSystem Clients App - Views
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.shortcuts import get_object_or_404

from .models import Client
from .filters import ClientFilterSet
from .serializers import (
    ClientListSerializer,
    ClientDetailSerializer,
    ClientCreateSerializer,
    ClientCreateFromPOSSerializer,
)
from apps.rbac.permissions import ActionPermissionMixin
from apps.orders.models import Order
from apps.orders.serializers import OrderListSerializer, OrderDetailSerializer


class ClientViewSet(ActionPermissionMixin, viewsets.ModelViewSet):
    """
        CRUD for Client records.

        POS pages can request scoped filtering with:
            ?scope=pos&brand=<brand_id>&sales_channel=<channel_id>

        In POS scope we include clients that match either brand or sales channel,
        plus generic clients not tied to either (both fields null).
    """

    # RBAC: client writes require client permissions (unlisted writes default to
    # edit_clients). Reads need view_clients (held by all operational roles) and
    # are brand/company-scoped in get_queryset.
    action_permissions = {
        'create': 'create_clients',
        'create_from_pos': 'create_clients',
        'destroy': 'delete_clients',
    }
    default_read_permission = 'view_clients'
    default_write_permission = 'edit_clients'

    queryset = Client.objects.select_related(
        'company', 'brand', 'sales_channel', 'reseller', 'created_by',
    ).all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = ClientFilterSet
    search_fields = ['email', 'first_name', 'last_name', 'phone']
    ordering_fields = ['created_at', 'email', 'first_name', 'points', 'number_of_orders']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = super().get_queryset().annotate(
            calculated_points=Sum('orders__total', filter=Q(orders__is_deleted=False)),
            calculated_order_count=Count('orders', filter=Q(orders__is_deleted=False), distinct=True),
            calculated_return_count=Count(
                'orders',
                filter=(
                    Q(orders__is_deleted=False)
                    & Q(orders__source=Order.Source.WOOCOMMERCE)
                    & (
                        Q(orders__returned_at__isnull=False)
                        | Q(orders__status=Order.Status.RETURNED)
                    )
                ),
                distinct=True,
            ),
        )
        
        user = self.request.user

        # Brand-workspace + multi-tenant scoping. ``visible_brand_ids`` is the
        # shared source of truth used by every other module (products, orders,
        # promotions, …): it narrows to the ACTIVE brand (``current_brand_id``)
        # when a brand workspace is focused, to the selected company's brands for
        # a company-scoped user, and returns None only for an unscoped global
        # admin. Generic clients (no brand) stay visible inside a brand workspace
        # so company-level records are never hidden — but a sibling brand's
        # clients never leak in.
        from apps.rbac.services import visible_brand_ids
        brand_ids = visible_brand_ids(user)
        if brand_ids is not None:
            if not brand_ids:
                return qs.none()
            qs = qs.filter(Q(brand_id__in=brand_ids) | Q(brand__isnull=True))

        # Tenant isolation by the active company (also applied for a global
        # admin who has selected a company in the workspace switcher).
        if user.current_company_id:
            qs = qs.filter(company_id=user.current_company_id)

        # Explicit POS scope param: narrow to a single channel's brand on demand
        # (used by POS reads that pass a brand without a focused workspace).
        scope = self.request.query_params.get('scope', '').lower()
        brand = self.request.query_params.get('brand')
        if scope == 'pos' and brand:
            qs = qs.filter(Q(brand_id=brand) | Q(brand__isnull=True))

        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return ClientListSerializer
        if self.action == 'retrieve':
            return ClientDetailSerializer
        return ClientCreateSerializer

    def perform_create(self, serializer):
        # Always attach the creator (audit) and the active company (multi-tenancy).
        user = self.request.user
        extra = {'created_by': user, 'company': user.current_company}

        focused = getattr(user, 'current_brand_id', None)
        if focused:
            # Inside a brand workspace, always tag the new client to that brand
            # (and drop any brand the request tried to send) so "Add Client"
            # uses the current brand automatically and the record stays visible
            # in this workspace.
            serializer.validated_data.pop('brand', None)
            extra['brand_id'] = focused
        else:
            # No brand focus: keep the form's brand only if it is one the user
            # may actually reach — never attach a client to a brand outside the
            # user's scope (visible_brand_ids returns None for a global admin).
            from apps.rbac.services import visible_brand_ids
            allowed = visible_brand_ids(user)
            provided = serializer.validated_data.get('brand')
            if provided is not None and allowed is not None and provided.id not in allowed:
                serializer.validated_data['brand'] = None

        serializer.save(**extra)

    @action(detail=False, methods=['post'], url_path='create-from-pos')
    def create_from_pos(self, request):
        """
        Create a new client directly from the POS page.
        
        ✨ SALES CHANNEL IS REQUIRED ✨
        The frontend MUST select a sales channel before calling this endpoint.
        The dialog should be disabled until a channel is selected.
        
        Request body:
        {
            "sales_channel": 1,  # ✨ REQUIRED - gets brand AND company from this
            "email": "customer@example.com",  # Required
            "first_name": "John",
            "last_name": "Doe",
            "phone": "+216 95 123456",
            "address": "123 Main St",
            "city": "Tunis",
            "country": "TN"
        }
        
        Response: Created client object with:
          - auto-assigned brand from sales_channel
          - auto-assigned company from sales_channel.brand.company
          - source=POS
          - sales_channel_id & sales_channel_name (for POS to track which channel)
          - created_by for audit trail
        
        Errors:
          - 400: Missing or invalid sales_channel
          - 400: Email already exists
          - 400: Phone already exists
          - 400: Sales channel not found or misconfigured
        
        Data Integrity:
          - Client company MUST match sales_channel.brand.company
          - Backend NEVER uses request.user.current_company
          - This prevents cross-tenant data leaks
        """
        serializer = ClientCreateFromPOSSerializer(
            data=request.data,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)

        # The serializer already selects an existing client (matched by phone or
        # email within the channel's company) instead of failing. Wrap the save
        # so any remaining unique collision (e.g. an email already in use) also
        # resolves to "select the existing client" rather than a raw 400 — POS
        # must never dead-end when the customer is already on file.
        try:
            with transaction.atomic():
                client = serializer.save(created_by=request.user)
        except IntegrityError:
            existing = self._find_existing_pos_client(request)
            if existing is not None:
                return Response(
                    {**ClientCreateFromPOSSerializer(existing).data, 'existing': True},
                    status=status.HTTP_200_OK,
                )
            return Response(
                {'detail': 'A client with this email or phone number already exists.'},
                status=status.HTTP_409_CONFLICT,
            )

        was_existing = bool(getattr(client, '_was_existing', False))
        return Response(
            {**ClientCreateFromPOSSerializer(client).data, 'existing': was_existing},
            status=status.HTTP_200_OK if was_existing else status.HTTP_201_CREATED,
        )

    @staticmethod
    def _find_existing_pos_client(request):
        """Best-effort lookup of the client a POS create collided with, scoped to
        the sales-channel's company (phone first, then email)."""
        from apps.sales_channels.models import SalesChannel
        from .utils import normalize_tunisian_phone
        sc = (
            SalesChannel.objects.select_related('brand__company')
            .filter(id=request.data.get('sales_channel') or 0)
            .first()
        )
        if sc is None or sc.brand is None:
            return None
        company = sc.brand.company
        phone = (request.data.get('phone') or '').strip()
        email = (request.data.get('email') or '').strip().lower()
        normalized = normalize_tunisian_phone(phone) if phone else None
        client = None
        if normalized:
            client = Client.objects.filter(company=company, phone_normalized=normalized).first()
        if client is None and email:
            client = Client.objects.filter(company=company, email=email).first()
        return client

    @action(detail=True, methods=['patch'], url_path='block')
    def block(self, request, pk=None):
        """Manually block / unblock a client, capturing the reason and actor.

        Gated by ``edit_clients`` (ActionPermissionMixin default for writes) and
        tenant-scoped via ``get_object`` → ``get_queryset``."""
        client = self.get_object()
        blocked = bool(request.data.get('is_blocked', True))
        if blocked:
            client.block(reason=request.data.get('blocked_reason', ''), by=request.user)
        else:
            client.unblock()
        client.save(update_fields=[
            'is_blocked', 'blocked_reason', 'blocked_at', 'blocked_by', 'updated_at',
        ])
        return Response(self.get_serializer(client).data)

    @action(detail=True, methods=['get'], url_path='orders')
    def orders(self, request, pk=None):
        client = self.get_object()
        qs = (
            Order.objects
            .filter(client=client)
            .select_related('company', 'sales_channel', 'pos_sales_channel', 'client', 'created_by')
            .prefetch_related('lines', 'lines__product')
            .order_by('-created_at')
        )
        serializer = OrderListSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='orders/(?P<order_id>[^/.]+)')
    def order_detail(self, request, pk=None, order_id=None):
        client = self.get_object()
        order = get_object_or_404(
            Order.objects
            .select_related('company', 'sales_channel', 'pos_sales_channel', 'client', 'created_by')
            .prefetch_related('lines', 'lines__product'),
            pk=order_id,
            client=client,
        )
        return Response(OrderDetailSerializer(order).data)
