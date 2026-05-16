"""
LkSystem Products App - Views
DRF ViewSets for Product management with soft delete.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import JSONParser
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.utils import timezone

from .models import Product, ProductAuditLog
from .serializers import (
    ProductSerializer,
    ProductListSerializer,
    ProductAuditLogSerializer,
)
from .service import ProductService
from apps.categories.service import CategoryService
from apps.sales_channels.models import SalesChannel
from apps.inventory.models import SalesChannelInventory


def _user_scoped_channel_ids(user):
    if user.is_superuser:
        return None
    try:
        from apps.rbac.services import PermissionService
        scoped = set(
            PermissionService.get_user_assignments(user)
            .filter(sales_channel__isnull=False)
            .values_list('sales_channel_id', flat=True)
        )
        if scoped:
            return scoped
    except Exception:
        pass
    return None


class ProductViewSet(viewsets.ModelViewSet):
    """
    Product CRUD with soft delete, restore, and audit trail.

    By default only non-deleted products are returned.
    Pass ``?show_deleted=true`` to include soft-deleted products,
    or ``?only_deleted=true`` to list deleted ones exclusively.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['brand', 'product_type', 'status']
    search_fields = ['name', 'barcode']
    ordering_fields = ['name', 'sales_price', 'purchase_price', 'created_at']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return ProductListSerializer
        return ProductSerializer

    def get_queryset(self):
        user = self.request.user

        # Decide which manager to use based on query params
        show_deleted = self.request.query_params.get('show_deleted', '').lower() == 'true'
        only_deleted = self.request.query_params.get('only_deleted', '').lower() == 'true'

        if only_deleted:
            qs = Product.all_objects.filter(is_deleted=True)
        elif show_deleted:
            qs = Product.all_objects.all()
        else:
            qs = Product.objects.all()  # excludes deleted by default

        qs = qs.select_related('brand').prefetch_related('categories', 'sales_channel_inventories')

        if user.is_superuser:
            return qs
        scoped_channel_ids = _user_scoped_channel_ids(user)
        if scoped_channel_ids is not None:
            scoped_brand_ids = SalesChannel.objects.filter(
                id__in=scoped_channel_ids,
            ).values_list('brand_id', flat=True)
            return qs.filter(brand_id__in=scoped_brand_ids)
        if user.allowed_brands.exists():
            return qs.filter(brand__in=user.allowed_brands.all())
        return qs.none()

    # ── Create / Update with audit ──────────────────────────────────────

    def perform_create(self, serializer):
        instance = serializer.save()
        # Run model-level pack validation (circular refs, existence checks)
        instance.full_clean()
        ProductAuditLog.objects.create(
            product=instance,
            user=self.request.user,
            action=ProductAuditLog.Action.CREATE,
        )

    def perform_update(self, serializer):
        old_data = {f: getattr(serializer.instance, f) for f in serializer.validated_data}
        instance = serializer.save()
        # Run model-level pack validation (circular refs, existence checks)
        instance.full_clean()

        # Build change dict
        changes = {}
        for field, old_val in old_data.items():
            new_val = getattr(instance, field)
            if str(old_val) != str(new_val):
                changes[field] = [str(old_val), str(new_val)]

        if changes:
            ProductAuditLog.objects.create(
                product=instance,
                user=self.request.user,
                action=ProductAuditLog.Action.UPDATE,
                changes=changes,
            )

    # ── Override destroy for soft delete ─────────────────────────────────

    def destroy(self, request, *args, **kwargs):
        """
        Default behavior: soft delete.
        Use ?hard=true to permanently delete an already soft-deleted product.
        """
        hard_delete = request.query_params.get('hard', '').lower() == 'true'
        pk = kwargs.get('pk')

        if hard_delete:
            try:
                product = Product.all_objects.get(pk=pk, is_deleted=True)
            except Product.DoesNotExist:
                return Response(
                    {'detail': 'Hard delete is only allowed for products already marked as deleted.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            self.check_object_permissions(request, product)
            product.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # Soft delete path (idempotent): if already deleted, return 204 quietly.
        try:
            product = Product.all_objects.get(pk=pk)
        except Product.DoesNotExist:
            return Response(
                {'detail': 'Product not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        self.check_object_permissions(request, product)

        if product.is_deleted:
            return Response(status=status.HTTP_204_NO_CONTENT)

        self.perform_destroy(product)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_destroy(self, instance):
        instance.soft_delete(user=self.request.user)

    # ── Custom actions ──────────────────────────────────────────────────

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """Restore a soft-deleted product."""
        try:
            product = Product.all_objects.get(pk=pk, is_deleted=True)
        except Product.DoesNotExist:
            return Response(
                {'detail': 'Deleted product not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        product.restore(user=request.user)
        return Response(ProductSerializer(product).data)

    @action(detail=True, methods=['get'], url_path='audit')
    def audit_log(self, request, pk=None):
        """Return the audit trail for a single product."""
        product = self.get_object()
        logs = ProductAuditLog.objects.filter(product=product)
        return Response(ProductAuditLogSerializer(logs, many=True).data)

    @action(detail=True, methods=['get'], url_path='pack-stock')
    def pack_stock(self, request, pk=None):
        """Compute available pack stock per sales channel (dynamic, never stored)."""
        product = self.get_object()
        if not product.is_pack:
            return Response(
                {'detail': 'This product is not a pack.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        channel_id = request.query_params.get('sales_channel')
        stock = product.get_pack_stock(
            sales_channel_id=int(channel_id) if channel_id else None
        )
        # Enrich with channel names
        from apps.sales_channels.models import SalesChannel
        channels = {c.id: c.name for c in SalesChannel.objects.filter(id__in=stock.keys())}
        result = [
            {
                'sales_channel_id': ch_id,
                'sales_channel_name': channels.get(ch_id, ''),
                'available_quantity': qty,
            }
            for ch_id, qty in stock.items()
        ]
        return Response(result)

    @action(detail=False, methods=['get'])
    def search_barcode(self, request):
        barcode = request.query_params.get('barcode')
        if not barcode:
            return Response(
                {'detail': 'barcode query parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            product = self.get_queryset().get(barcode=barcode)
            return Response(ProductSerializer(product).data)
        except Product.DoesNotExist:
            return Response(
                {'detail': 'Product not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=False, methods=['get'], url_path='pos-cache')
    def pos_cache(self, request):
        """
        Return a full POS product snapshot for one sales channel.

        This endpoint is intentionally unpaginated because the POS needs a
        complete local IndexedDB cache to keep selling during short internet
        outages. Stock comes from SalesChannelInventory for the selected POS
        channel; missing inventory rows are represented as zero stock.
        """
        sales_channel_id = request.query_params.get('sales_channel')
        if not sales_channel_id:
            return Response(
                {'detail': 'sales_channel query parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            sales_channel = (
                SalesChannel.objects
                .select_related('brand', 'brand__company')
                .get(pk=sales_channel_id)
            )
        except SalesChannel.DoesNotExist:
            return Response(
                {'detail': 'Sales channel not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        user = request.user
        scoped_channel_ids = _user_scoped_channel_ids(user)
        if scoped_channel_ids is not None and sales_channel.id not in scoped_channel_ids:
            return Response(
                {'detail': 'You do not have access to this sales channel.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if (
            scoped_channel_ids is None
            and not user.is_superuser
            and not user.allowed_brands.filter(pk=sales_channel.brand_id).exists()
        ):
            return Response(
                {'detail': 'You do not have access to this sales channel.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        products = list(
            Product.objects
            .filter(brand=sales_channel.brand, status=Product.ProductStatus.PUBLISH)
            .order_by('name')
        )
        product_ids = [product.id for product in products]
        inventory_by_product = {
            inv.product_id: inv
            for inv in SalesChannelInventory.objects.filter(
                sales_channel=sales_channel,
                product_id__in=product_ids,
            )
        }

        product_rows = []
        for product in products:
            inv = inventory_by_product.get(product.id)
            row = ProductListSerializer(product, context={'request': request}).data
            row['stock'] = {
                'inventory_id': inv.id if inv else None,
                'quantity': inv.quantity if inv else 0,
                'reserved_quantity': inv.reserved_quantity if inv else 0,
                'available_quantity': inv.available_quantity if inv else 0,
                'updated_at': inv.updated_at.isoformat() if inv and inv.updated_at else None,
            }
            product_rows.append(row)

        return Response({
            'sales_channel': sales_channel.id,
            'sales_channel_name': sales_channel.name,
            'brand': sales_channel.brand_id,
            'brand_name': sales_channel.brand.name if sales_channel.brand else None,
            'last_sync': timezone.now().isoformat(),
            'products': product_rows,
        })

    # ── WooCommerce Sync ────────────────────────────────────────────────

    def _get_validated_sales_channel(self, request):
        sales_channel_id = request.data.get('sales_channel')
        if not sales_channel_id:
            return None, Response(
                {'detail': 'sales_channel is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            sales_channel = SalesChannel.objects.get(id=sales_channel_id)
        except SalesChannel.DoesNotExist:
            return None, Response(
                {'detail': 'Sales channel not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        user = request.user
        if not user.is_superuser:
            if not user.allowed_brands.filter(pk=sales_channel.brand_id).exists():
                return None, Response(
                    {'detail': 'You do not have access to this sales channel.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if sales_channel.channel_type != SalesChannel.ChannelType.WOOCOMMERCE:
            return None, Response(
                {'detail': 'This sales channel is not a WooCommerce channel.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return sales_channel, None

    def _sync_categories_before_products(self, sales_channel, user):
        """Keep local category rows ready before attaching product categories."""
        category_service = CategoryService(sales_channel)
        try:
            return category_service.sync_all(created_by=user, updated_by=user)
        except Exception as exc:
            # Product sync can still proceed; product category links will attach
            # on the next sync once categories are available.
            return {'errors': 1, 'detail': str(exc)}

    @action(detail=False, methods=['post'])
    def sync(self, request):
        sales_channel, error = self._get_validated_sales_channel(request)
        if error:
            return error

        try:
            category_result = self._sync_categories_before_products(sales_channel, request.user)
            service = ProductService(sales_channel)
            result = service.sync_all(
                created_by=request.user,
                updated_by=request.user,
            )
            return Response({
                'detail': 'Products synced successfully.',
                'created': result.get('created', 0),
                'updated': result.get('updated', 0),
                'errors': result.get('errors', 0),
                'categories': category_result,
            })
        except Exception as e:
            return Response(
                {'detail': f'Sync failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['post'])
    def preview(self, request):
        sales_channel, error = self._get_validated_sales_channel(request)
        if error:
            return error

        try:
            service = ProductService(sales_channel)
            wc_products = service.fetch_all()

            existing_wc_ids = set(
                Product.objects.filter(
                    brand=sales_channel.brand,
                ).values_list('wc_product_id', flat=True)
            )

            products_preview = []
            for product in wc_products:
                wc_id = product.get('id')
                products_preview.append({
                    'wc_id': wc_id,
                    'name': product.get('name', ''),
                    'sku': product.get('sku', ''),
                    'price': product.get('regular_price', '0'),
                    'status': product.get('status', 'publish'),
                    'type': product.get('type', 'simple'),
                    'image': (
                        product.get('images', [{}])[0].get('src', '')
                        if product.get('images') else ''
                    ),
                    'exists_locally': wc_id in existing_wc_ids,
                })

            return Response({
                'sales_channel': sales_channel.id,
                'sales_channel_name': sales_channel.name,
                'total_count': len(products_preview),
                'existing_count': sum(1 for p in products_preview if p['exists_locally']),
                'new_count': sum(1 for p in products_preview if not p['exists_locally']),
                'products': products_preview,
            })
        except Exception as e:
            return Response(
                {'detail': f'Failed to fetch products from WooCommerce: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['post'], url_path='sync-selected')
    def sync_selected(self, request):
        sales_channel, error = self._get_validated_sales_channel(request)
        if error:
            return error

        wc_product_ids = request.data.get('wc_product_ids', [])
        if not wc_product_ids or not isinstance(wc_product_ids, list):
            return Response(
                {'detail': 'wc_product_ids must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            category_result = self._sync_categories_before_products(sales_channel, request.user)
            service = ProductService(sales_channel)
            created_count = 0
            updated_count = 0
            errors = []

            for wc_id in wc_product_ids:
                try:
                    _, created = service.sync_one(wc_id)
                    if created:
                        created_count += 1
                    else:
                        updated_count += 1
                except Exception as e:
                    errors.append({'wc_id': wc_id, 'error': str(e)})

            return Response({
                'detail': 'Selected products synced.',
                'created': created_count,
                'updated': updated_count,
                'errors': len(errors),
                'categories': category_result,
                'error_details': errors if errors else None,
            })
        except Exception as e:
            return Response(
                {'detail': f'Sync failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
