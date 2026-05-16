"""
LkSystem Clients App - Views
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
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
from apps.orders.models import Order
from apps.orders.serializers import OrderListSerializer, OrderDetailSerializer


class ClientViewSet(viewsets.ModelViewSet):
    """
        CRUD for Client records.

        POS pages can request scoped filtering with:
            ?scope=pos&brand=<brand_id>&sales_channel=<channel_id>

        In POS scope we include clients that match either brand or sales channel,
        plus generic clients not tied to either (both fields null).
    """

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
                        | Q(orders__delivery_status=Order.DeliveryStatus.RETURNED)
                        | Q(orders__return_exchange_status=Order.ReturnExchangeStatus.RETURNED)
                    )
                ),
                distinct=True,
            ),
        )
        
        # Scope to current user's company for multi-tenancy
        if self.request.user.current_company:
            qs = qs.filter(company=self.request.user.current_company)

        scope = self.request.query_params.get('scope', '').lower()
        brand = self.request.query_params.get('brand')

        if scope == 'pos' and brand:
            # POS scope: clients belonging to this brand OR generic (no brand set)
            qs = qs.filter(Q(brand_id=brand) | Q(brand__isnull=True))

        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return ClientListSerializer
        if self.action == 'retrieve':
            return ClientDetailSerializer
        return ClientCreateSerializer

    def perform_create(self, serializer):
        # Always attach the user who created the client for audit trails
        # Auto-set company from user's current_company for multi-tenancy
        serializer.save(
            created_by=self.request.user,
            company=self.request.user.current_company
        )

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
        
        # ✨ Only pass created_by for audit trail
        # ✨ Company is auto-extracted from sales_channel.brand.company
        client = serializer.save(
            created_by=request.user
        )
        
        return Response(
            ClientCreateFromPOSSerializer(client).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['patch'], url_path='block')
    def block(self, request, pk=None):
        client = self.get_object()
        blocked = request.data.get('is_blocked', True)
        client.is_blocked = bool(blocked)
        client.save(update_fields=['is_blocked', 'updated_at'])
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
