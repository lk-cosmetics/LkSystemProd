"""
LkSystem Inventory App - Views
REST API views for inventory management.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
import django_filters
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db import transaction
from django.db.models import Sum, F, Q

from apps.inventory.models import (
    BillOfMaterials,
    InventoryMovement,
    ProductionBatch,
    ProductionBatchComponent,
    SalesChannelInventory,
)
from apps.sales_channels.models import SalesChannel
from apps.inventory.serializers import (
    SalesChannelInventoryListSerializer, SalesChannelInventoryDetailSerializer,
    SalesChannelInventoryCreateSerializer, SalesChannelInventoryAdjustSerializer,
    InventoryMovementListSerializer, InventoryMovementDetailSerializer,
    InventoryMovementCreateSerializer, InventoryMovementCompleteSerializer,
    TransferCreateSerializer, ProductInventorySummarySerializer,
    BillOfMaterialsListSerializer, BillOfMaterialsDetailSerializer,
    ProductionBatchListSerializer, ProductionBatchDetailSerializer,
    ProductionBatchSendSerializer, ProductionBatchReceiveSerializer,
    ProductionBatchUpdateSerializer, ProductionBatchCancelSerializer,
)
from apps.rbac.permissions import ActionPermissionMixin


def _allowed_sales_channel_ids(user):
    """
    Channel ids visible to ``user`` (or ``None`` for unrestricted reach).

    Delegates to the shared RBAC helper so every viewset that scopes
    on channels uses the same logic. The previous implementation only
    looked at ``user.allowed_brands`` for non-channel-scoped roles,
    which over-narrowed company-scoped roles (CEO) whose
    ``allowed_brands`` typically holds a single seed brand.
    """
    from apps.rbac.services import visible_sales_channel_ids
    return visible_sales_channel_ids(user)


class SalesChannelInventoryViewSet(ActionPermissionMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing sales channel inventory levels.
    
    list: Get all channel inventories
    retrieve: Get single channel inventory with movement history
    create: Create new channel inventory record
    update: Update inventory settings (min/max, location)
    adjust: Quick stock adjustment
    """
    # RBAC: stock WRITES require inventory permissions; unlisted writes (e.g.
    # adjust) default to edit_inventory. Reads stay open (IsAuthenticated) and
    # are channel-scoped in get_queryset.
    action_permissions = {
        'create': 'create_inventory',
        'destroy': 'delete_inventory',
        'bulk_upsert': 'create_inventory',
        'bulk_delete': 'delete_inventory',
    }
    default_write_permission = 'edit_inventory'

    queryset = SalesChannelInventory.objects.select_related(
        'sales_channel', 'sales_channel__brand', 'product'
    ).all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['sales_channel', 'sales_channel__brand__company', 'product']
    search_fields = ['product__name', 'product__barcode', 'bin_location']
    ordering_fields = ['quantity', 'updated_at', 'product__name']
    ordering = ['-updated_at']
    
    def get_serializer_class(self):
        if self.action == 'list':
            return SalesChannelInventoryListSerializer
        elif self.action == 'retrieve':
            return SalesChannelInventoryDetailSerializer
        elif self.action in ['create', 'update', 'partial_update']:
            return SalesChannelInventoryCreateSerializer
        elif self.action == 'adjust':
            return SalesChannelInventoryAdjustSerializer
        return SalesChannelInventoryListSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        allowed_channel_ids = _allowed_sales_channel_ids(self.request.user)
        if allowed_channel_ids is not None:
            queryset = queryset.filter(sales_channel_id__in=allowed_channel_ids)
        return queryset

    @action(detail=False, methods=['post'], url_path='bulk-upsert')
    def bulk_upsert(self, request):
        """Create or update many channel-inventory rows in one atomic call.

        Body: ``{"items": [{"sales_channel", "product", "quantity",
        "minimum_quantity"?, "maximum_quantity"?, "bin_location"?}, ...]}``.
        Each (sales_channel, product) pair is upserted — existing rows have their
        quantity/settings set, new ones are created. Channels outside the user's
        reach are rejected. All-or-nothing: any invalid row rolls back the batch.
        ``reserved_quantity`` is never touched (it is system-managed).
        """
        items = request.data.get('items')
        if not isinstance(items, list) or not items:
            return Response(
                {'detail': 'Provide a non-empty "items" list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        allowed = _allowed_sales_channel_ids(request.user)
        created, updated, errors = 0, 0, []
        with transaction.atomic():
            for idx, item in enumerate(items):
                try:
                    channel_id = int(item.get('sales_channel'))
                    product_id = int(item.get('product'))
                    quantity = int(item.get('quantity'))
                except (TypeError, ValueError):
                    errors.append({'index': idx, 'error': 'sales_channel, product and quantity are required.'})
                    continue
                if quantity < 0:
                    errors.append({'index': idx, 'error': 'Quantity cannot be negative.'})
                    continue
                if allowed is not None and channel_id not in allowed:
                    errors.append({'index': idx, 'error': 'You cannot manage this sales channel.'})
                    continue

                # ``mode`` controls how ``quantity`` is applied to the existing
                # on-hand: ``set`` (overwrite), ``add`` (+), ``subtract`` (−,
                # floored at 0). The current row is locked so concurrent bulk
                # edits can't lose an increment.
                mode = str(item.get('mode') or 'set').lower()
                existing = (
                    SalesChannelInventory.objects.select_for_update()
                    .filter(sales_channel_id=channel_id, product_id=product_id)
                    .first()
                )
                current = existing.quantity if existing else 0
                if mode == 'add':
                    new_qty = current + quantity
                elif mode in ('subtract', 'decrease', 'remove'):
                    new_qty = max(0, current - quantity)
                else:  # 'set'
                    new_qty = quantity

                fields = {'quantity': new_qty}
                for opt in ('minimum_quantity', 'maximum_quantity', 'bin_location'):
                    if item.get(opt) not in (None, ''):
                        fields[opt] = item[opt]

                if existing:
                    for key, value in fields.items():
                        setattr(existing, key, value)
                    existing.save()
                    updated += 1
                else:
                    SalesChannelInventory.objects.create(
                        sales_channel_id=channel_id, product_id=product_id, **fields,
                    )
                    created += 1
            if errors:
                transaction.set_rollback(True)
        if errors:
            return Response(
                {'detail': 'No changes were saved — fix the highlighted rows.', 'errors': errors},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({'created': created, 'updated': updated, 'total': created + updated})

    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        """Delete many channel-inventory rows by id. Body: ``{"ids": [...]}``.

        Only rows the user can reach (channel-scoped via ``get_queryset``) are
        deleted, so this can never remove another tenant's stock rows.
        """
        ids = request.data.get('ids')
        if not isinstance(ids, list) or not ids:
            return Response(
                {'detail': 'Provide a non-empty "ids" list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        qs = self.get_queryset().filter(id__in=ids)
        deleted = qs.count()
        qs.delete()
        return Response({'deleted': deleted})


    @action(detail=True, methods=['post'])
    def adjust(self, request, pk=None):
        """
        Quick stock adjustment for this inventory record.
        Creates an adjustment movement automatically.
        """
        store_inv = self.get_object()
        serializer = SalesChannelInventoryAdjustSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        quantity_change = serializer.validated_data['quantity_change']
        movement_type = serializer.validated_data['movement_type']
        notes = serializer.validated_data.get('notes', '')
        
        # Create the movement
        movement = InventoryMovement.objects.create(
            sales_channel=store_inv.sales_channel,
            product=store_inv.product,
            movement_type=movement_type,
            status=InventoryMovement.MovementStatus.COMPLETED,
            quantity=abs(quantity_change),
            quantity_before=store_inv.quantity,
            quantity_after=store_inv.quantity + (
                quantity_change if movement_type == 'ADJUSTMENT_IN' 
                else -abs(quantity_change)
            ),
            notes=notes,
            created_by=request.user,
        )
        
        return Response({
            'message': 'Stock adjusted successfully',
            'movement_reference': movement.reference_number,
            'new_quantity': movement.quantity_after,
        })
    
    @action(detail=False, methods=['get'])
    def low_stock(self, request):
        """Get all low stock items across all channels."""
        queryset = self.get_queryset().filter(
            quantity__lte=F('minimum_quantity')
        )
        
        # Filter by company if provided
        company_id = request.query_params.get('company')
        if company_id:
            queryset = queryset.filter(sales_channel__brand__company_id=company_id)

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def out_of_stock(self, request):
        """Get all out of stock items."""
        queryset = self.get_queryset().filter(quantity__lte=0)
        
        company_id = request.query_params.get('company')
        if company_id:
            queryset = queryset.filter(sales_channel__brand__company_id=company_id)

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def by_product(self, request):
        """Get inventory summary for a specific product across all channels."""
        product_id = request.query_params.get('product')
        if not product_id:
            return Response(
                {'error': 'product query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        inventories = self.get_queryset().filter(product_id=product_id)
        
        if not inventories.exists():
            return Response({
                'product_id': product_id,
                'total_quantity': 0,
                'total_reserved': 0,
                'total_available': 0,
                'channels_count': 0,
                'channel_breakdown': []
            })
        
        # Calculate totals
        totals = inventories.aggregate(
            total_quantity=Sum('quantity'),
            total_reserved=Sum('reserved_quantity'),
        )
        
        product = inventories.first().product
        
        return Response({
            'product_id': int(product_id),
            'product_name': product.name,
            'product_barcode': product.barcode,
            'total_quantity': totals['total_quantity'] or 0,
            'total_reserved': totals['total_reserved'] or 0,
            'total_available': (totals['total_quantity'] or 0) - (totals['total_reserved'] or 0),
            'channels_count': inventories.count(),
            'channel_breakdown': SalesChannelInventoryListSerializer(inventories, many=True).data
        })


class InventoryMovementFilter(django_filters.FilterSet):
    """Filters for the movements list, including a date range over ``created_at``.

    ``?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`` is inclusive by calendar date,
    alongside the existing channel / product / type / status filters.
    """
    start_date = django_filters.DateFilter(field_name='created_at', lookup_expr='date__gte')
    end_date = django_filters.DateFilter(field_name='created_at', lookup_expr='date__lte')

    class Meta:
        model = InventoryMovement
        fields = ['sales_channel', 'product', 'movement_type', 'status']


class InventoryMovementViewSet(ActionPermissionMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing inventory movements.
    
    list: Get all movements
    retrieve: Get single movement details
    create: Create new movement (stock in/out)
    complete: Complete a pending movement
    transfer: Create inter-channel transfer
    """
    # RBAC: movement WRITES require inventory permissions; unlisted writes (e.g.
    # complete, transfer) default to edit_inventory. Reads stay open
    # (IsAuthenticated) and are channel-scoped in get_queryset.
    action_permissions = {
        'create': 'create_inventory',
        'destroy': 'delete_inventory',
    }
    default_write_permission = 'edit_inventory'

    queryset = InventoryMovement.objects.select_related(
        'sales_channel', 'product', 'destination_channel', 'created_by'
    ).all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = InventoryMovementFilter
    search_fields = ['reference_number', 'product__name', 'external_reference', 'notes']
    ordering_fields = ['created_at', 'quantity', 'movement_type']
    ordering = ['-created_at']
    
    def get_serializer_class(self):
        if self.action == 'list':
            return InventoryMovementListSerializer
        elif self.action == 'retrieve':
            return InventoryMovementDetailSerializer
        elif self.action == 'create':
            return InventoryMovementCreateSerializer
        elif self.action == 'complete':
            return InventoryMovementCompleteSerializer
        elif self.action == 'transfer':
            return TransferCreateSerializer
        return InventoryMovementListSerializer
    
    def get_queryset(self):
        queryset = super().get_queryset()
        allowed_channel_ids = _allowed_sales_channel_ids(self.request.user)
        if allowed_channel_ids is not None:
            queryset = queryset.filter(
                Q(sales_channel_id__in=allowed_channel_ids)
                | Q(destination_channel_id__in=allowed_channel_ids)
            )
        
        # Filter by company
        company_id = self.request.query_params.get('company')
        if company_id:
            queryset = queryset.filter(sales_channel__brand__company_id=company_id)
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date:
            queryset = queryset.filter(created_at__date__gte=start_date)
        if end_date:
            queryset = queryset.filter(created_at__date__lte=end_date)
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Complete a pending movement."""
        movement = self.get_object()
        serializer = InventoryMovementCompleteSerializer(
            movement, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        return Response({
            'message': 'Movement completed successfully',
            'reference_number': movement.reference_number,
        })
    
    @action(detail=False, methods=['post'])
    def transfer(self, request):
        """Create an inter-channel transfer."""
        serializer = TransferCreateSerializer(
            data=request.data, 
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        transfer_out = serializer.save()
        
        return Response({
            'message': 'Transfer created successfully',
            'transfer_out_reference': transfer_out.reference_number,
            'transfer_in_reference': transfer_out.related_movement.reference_number if transfer_out.related_movement else None,
        }, status=status.HTTP_201_CREATED)
    
    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get movement summary statistics."""
        queryset = self.get_queryset().filter(
            status=InventoryMovement.MovementStatus.COMPLETED
        )
        
        # Group by movement type
        from django.db.models import Count
        by_type = queryset.values('movement_type').annotate(
            count=Count('id'),
            total_quantity=Sum('quantity'),
        )
        
        return Response({
            'total_movements': queryset.count(),
            'by_type': list(by_type),
        })


class BillOfMaterialsViewSet(viewsets.ModelViewSet):
    """
    Normalised product BOMs.

    Scope: a BOM belongs to its ``finished_product.brand``. The viewset
    filters to the brands the calling user can reach (CEO sees every
    brand in their company; Manager sees their assigned brands; Stock
    Keeper same). Permission gates by RBAC action codenames so a custom
    role with just ``view_manufacturing`` is read-only.
    """
    queryset = BillOfMaterials.objects.select_related(
        'finished_product', 'finished_product__brand', 'created_by'
    ).prefetch_related('items__component')
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['finished_product', 'finished_product__brand__company', 'is_active']
    search_fields = ['name', 'finished_product__name', 'finished_product__barcode']
    ordering_fields = ['created_at', 'updated_at', 'version']
    ordering = ['-updated_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return BillOfMaterialsListSerializer
        return BillOfMaterialsDetailSerializer

    def get_queryset(self):
        from apps.rbac.services import visible_brand_ids
        qs = super().get_queryset()
        brand_ids = visible_brand_ids(self.request.user)
        if brand_ids is None:
            return qs
        if not brand_ids:
            return qs.none()
        return qs.filter(finished_product__brand_id__in=brand_ids)

    def get_permissions(self):
        from apps.rbac.permissions import require_permission
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated(), require_permission('view_manufacturing')()]
        if self.action == 'create':
            return [IsAuthenticated(), require_permission('create_manufacturing')()]
        if self.action in ('update', 'partial_update'):
            return [IsAuthenticated(), require_permission('edit_manufacturing')()]
        if self.action == 'destroy':
            return [IsAuthenticated(), require_permission('delete_manufacturing')()]
        return [IsAuthenticated()]


class ProductionBatchViewSet(viewsets.ModelViewSet):
    """
    Production batches: send-to-factory deducts BOM components from
    warehouse stock; receive-from-factory increases finished-product
    stock and decreases the batch's in-factory balance.

    Scope: filter by the channels the user can reach. Permission gates:
    ``view_manufacturing`` for read, ``send_to_factory`` for create /
    send, ``receive_from_factory`` for the receive action, plus
    ``edit_manufacturing`` for arbitrary updates and ``delete_manufacturing``
    for destroy / cancel. A role can hold any subset (e.g. Stock Keeper
    has view + send + receive but no edit / delete).
    """
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    queryset = ProductionBatch.objects.select_related(
        'sales_channel', 'sales_channel__brand', 'finished_product', 'bom', 'created_by'
    ).prefetch_related('components__component', 'components__sent_movement')
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['sales_channel', 'sales_channel__brand__company', 'finished_product', 'status']
    search_fields = ['batch_number', 'finished_product__name', 'notes']
    ordering_fields = ['created_at', 'updated_at', 'planned_quantity', 'received_quantity']
    ordering = ['-created_at']

    def get_queryset(self):
        from apps.rbac.services import visible_sales_channel_ids
        qs = super().get_queryset()
        channel_ids = visible_sales_channel_ids(self.request.user)
        if channel_ids is None:
            return qs
        if not channel_ids:
            return qs.none()
        return qs.filter(sales_channel_id__in=channel_ids)

    def get_permissions(self):
        from apps.rbac.permissions import require_permission
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated(), require_permission('view_manufacturing')()]
        if self.action == 'create':
            return [IsAuthenticated(), require_permission('send_to_factory')()]
        if self.action == 'receive':
            return [IsAuthenticated(), require_permission('receive_from_factory')()]
        if self.action in ('update', 'partial_update'):
            return [IsAuthenticated(), require_permission('edit_manufacturing')()]
        if self.action in ('destroy', 'cancel'):
            return [IsAuthenticated(), require_permission('delete_manufacturing')()]
        return [IsAuthenticated()]

    def get_serializer_class(self):
        if self.action == 'list':
            return ProductionBatchListSerializer
        if self.action == 'create':
            return ProductionBatchSendSerializer
        if self.action == 'receive':
            return ProductionBatchReceiveSerializer
        if self.action in ('partial_update', 'update'):
            return ProductionBatchUpdateSerializer
        if self.action == 'cancel':
            return ProductionBatchCancelSerializer
        return ProductionBatchDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        batch = serializer.save()
        output = ProductionBatchDetailSerializer(batch, context=self.get_serializer_context())
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        batch = self.get_object()
        serializer = self.get_serializer(
            data=request.data,
            context={**self.get_serializer_context(), 'batch': batch},
        )
        serializer.is_valid(raise_exception=True)
        batch = serializer.save()
        output = ProductionBatchDetailSerializer(batch, context=self.get_serializer_context())
        return Response(output.data)

    @action(detail=True, methods=['post', 'delete'])
    def cancel(self, request, pk=None):
        batch = self.get_object()
        serializer = self.get_serializer(
            data=request.data,
            context={**self.get_serializer_context(), 'batch': batch},
        )
        serializer.is_valid(raise_exception=True)
        batch = serializer.save()
        output = ProductionBatchDetailSerializer(batch, context=self.get_serializer_context())
        return Response(output.data)

    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        serializer = ProductionBatchCancelSerializer(
            data=request.data,
            context={**self.get_serializer_context(), 'batch': batch},
        )
        serializer.is_valid(raise_exception=True)
        batch = serializer.save()
        output = ProductionBatchDetailSerializer(batch, context=self.get_serializer_context())
        return Response(output.data)

    @action(detail=False, methods=['get'])
    def in_factory(self, request):
        """Summarize component quantities currently sent to the factory."""
        queryset = ProductionBatchComponent.objects.filter(
            production_batch__status__in=[
                ProductionBatch.Status.SENT_TO_FACTORY,
                ProductionBatch.Status.PARTIALLY_RECEIVED,
            ],
            quantity_sent__gt=F('quantity_consumed'),
        )

        company_id = request.query_params.get('company')
        sales_channel_id = request.query_params.get('sales_channel')
        component_id = request.query_params.get('component')
        if company_id:
            queryset = queryset.filter(production_batch__sales_channel__brand__company_id=company_id)
        if sales_channel_id:
            queryset = queryset.filter(production_batch__sales_channel_id=sales_channel_id)
        if component_id:
            queryset = queryset.filter(component_id=component_id)

        rows = (
            queryset
            .values('component_id', 'component__name', 'component__barcode')
            .annotate(
                total_sent=Sum('quantity_sent'),
                total_consumed=Sum('quantity_consumed'),
            )
            .order_by('component__name')
        )

        data = [
            {
                'component_id': row['component_id'],
                'component_name': row['component__name'],
                'component_barcode': row['component__barcode'],
                'quantity_sent': row['total_sent'] or 0,
                'quantity_consumed': row['total_consumed'] or 0,
                'in_factory_quantity': (row['total_sent'] or 0) - (row['total_consumed'] or 0),
            }
            for row in rows
        ]
        return Response(data)
