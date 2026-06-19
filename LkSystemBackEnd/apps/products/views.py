"""
LkSystem Products App - Views
DRF ViewSets for Product management with soft delete.
"""

import csv
import io
from decimal import Decimal, InvalidOperation

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import JSONParser, MultiPartParser
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone

from apps.rbac.permissions import ActionPermissionMixin
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
    # Delegate to the central scope helper so a Super Admin inside a company
    # workspace is limited to that company's channels (and to the active brand
    # when one is focused). Returns None only in global mode (no company).
    from apps.rbac.services import visible_sales_channel_ids
    helper_ids = visible_sales_channel_ids(user)
    if helper_ids is not None:
        return helper_ids
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


class ProductViewSet(ActionPermissionMixin, viewsets.ModelViewSet):
    """
    Product CRUD with soft delete, restore, and audit trail.

    By default only non-deleted products are returned.
    Pass ``?show_deleted=true`` to include soft-deleted products,
    or ``?only_deleted=true`` to list deleted ones exclusively.
    """

    # RBAC: every action is gated on a product permission codename (the Role
    # Permissions page is the source of truth). Reads default to view_products;
    # any unlisted write defaults to edit_products (deny-by-default), so an
    # Employee with only view_products can list products but cannot create,
    # edit, delete, sync or import them.
    action_permissions = {
        'create': 'create_products',
        'pos_cache': 'use_pos',
        'sync': 'create_products',
        'sync_selected': 'create_products',
        'import_csv': 'create_products',
        'destroy': 'delete_products',
    }
    default_read_permission = 'view_products'
    default_write_permission = 'edit_products'

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    # ``categories`` enables ?categories=<id> to filter products by category
    # (the category drill-down + the Products page category filter).
    filterset_fields = ['brand', 'product_type', 'status', 'categories']
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

        # Scope by the brands the user can reach. ``visible_brand_ids`` already
        # scopes a Super Admin to their actively-selected company (workspace
        # context) and narrows to the active brand when one is focused; it
        # returns None ONLY when there is no company selected (global mode).
        # So we must NOT short-circuit on is_superuser here, otherwise the
        # selected-company context would be ignored and products from other
        # companies would leak into the list.
        from apps.rbac.services import visible_brand_ids
        brand_ids = visible_brand_ids(user)
        if brand_ids is None:
            return qs
        if not brand_ids:
            return qs.none()
        return qs.filter(brand_id__in=brand_ids)

    # ── Create / Update with audit ──────────────────────────────────────

    def perform_create(self, serializer):
        user = self.request.user

        # Resolve the active brand: a focused brand workspace, or the brand of
        # an operational account's assigned sales point.
        active_brand_id = getattr(user, 'current_brand_id', None)
        if not active_brand_id and getattr(user, 'assigned_sales_channel_id', None):
            from apps.sales_channels.models import SalesChannel
            active_brand_id = (
                SalesChannel.objects.filter(id=user.assigned_sales_channel_id)
                .values_list('brand_id', flat=True).first()
            )

        save_kwargs = {}
        if active_brand_id:
            # Inside a brand workspace, always create the product under the
            # active brand (drop any brand sent by the client) so it can never
            # land under the wrong brand and the user need not re-pick it.
            serializer.validated_data.pop('brand', None)
            save_kwargs['brand_id'] = active_brand_id
        else:
            # No brand focus: keep the chosen brand only if it is one the user
            # may actually reach — never create under an out-of-scope brand.
            from apps.rbac.services import visible_brand_ids
            allowed = visible_brand_ids(user)
            provided = serializer.validated_data.get('brand')
            if provided is not None and allowed is not None and provided.id not in allowed:
                from rest_framework.exceptions import ValidationError
                raise ValidationError(
                    {'brand': 'You cannot create a product under a brand outside your scope.'}
                )

        instance = serializer.save(**save_kwargs)
        # Run model-level pack validation (circular refs, existence checks)
        instance.full_clean()
        ProductAuditLog.objects.create(
            product=instance,
            user=user,
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

        # Use the shared scope helper so a CEO whose ``allowed_brands``
        # holds a single brand still has access to every POS channel
        # of every brand in their company.
        user = request.user
        from apps.rbac.services import visible_sales_channel_ids
        channel_ids = visible_sales_channel_ids(user)
        if channel_ids is not None and sales_channel.id not in channel_ids:
            return Response(
                {'detail': 'You do not have access to this sales channel.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        sellable_products = list(
            Product.objects
            .filter(
                brand=sales_channel.brand,
                status=Product.ProductStatus.PUBLISH,
                product_type__in=Product.SELLABLE_TYPES,  # POS only sells resell_product + pack
            )
            .order_by('name')
        )

        # Include pack components in the offline cache so IndexedDB can validate
        # and deduct component stock while offline. The React catalogue still
        # filters the visible grid to SELLABLE_TYPES, so component/packaging rows
        # stay hidden from the cashier.
        component_ids = set()
        for product in sellable_products:
            if not product.is_pack or not product.pack_items:
                continue
            for item in product.pack_items:
                product_id = item.get('product_id') if isinstance(item, dict) else None
                if product_id:
                    component_ids.add(product_id)

        products = list(
            Product.objects
            .filter(
                Q(
                    brand=sales_channel.brand,
                    status=Product.ProductStatus.PUBLISH,
                    product_type__in=Product.SELLABLE_TYPES,
                ) |
                Q(
                    id__in=component_ids,
                )
            )
            .distinct()
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

        # Channel access must honour company scope, not just the per-user
        # allowed_brands M2M. A CEO / Manager is company-scoped and typically
        # has NO allowed_brands row, yet reaches every brand of their company
        # (same rule as BrandViewSet.get_queryset). The previous
        # allowed_brands-only check therefore wrongly returned 403 for a CEO.
        # visible_brand_ids() centralises the scope rule (None = unrestricted)
        # so no role name is ever hard-coded here.
        user = request.user
        from apps.rbac.services import visible_brand_ids
        allowed_brand_ids = visible_brand_ids(user)
        if allowed_brand_ids is not None and sales_channel.brand_id not in allowed_brand_ids:
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

    # ─── Bulk operations ──────────────────────────────────────────────────

    BULK_STATUS_CHOICES = ('publish', 'draft', 'pending', 'private')

    @action(detail=False, methods=['post'], url_path='bulk-change-status')
    def bulk_change_status(self, request):
        """
        Change ``status`` for several products in a single transaction.

        Body: ``{"ids": [1, 2, 3], "status": "publish"}``.

        Each affected row is audit-logged (UPDATE) with its before/after
        ``status`` so the change is traceable per product.
        """
        ids = request.data.get('ids')
        new_status = request.data.get('status')

        if not isinstance(ids, list) or not ids:
            return Response(
                {'detail': 'Provide a non-empty list of product ids.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_status not in self.BULK_STATUS_CHOICES:
            return Response(
                {'detail': f'status must be one of {self.BULK_STATUS_CHOICES}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Scope to what the user is allowed to touch — same querysets as list.
        qs = self.get_queryset().filter(pk__in=ids)
        affected = []
        with transaction.atomic():
            for product in qs:
                if product.status == new_status:
                    continue
                old_status = product.status
                product.status = new_status
                product.save(update_fields=['status', 'updated_at'])
                ProductAuditLog.objects.create(
                    product=product,
                    user=request.user,
                    action=ProductAuditLog.Action.UPDATE,
                    changes={'status': [old_status, new_status]},
                )
                affected.append(product.id)

        return Response({
            'updated': len(affected),
            'requested': len(ids),
            'status': new_status,
            'updated_ids': affected,
        })

    @action(detail=False, methods=['get'], url_path='export-csv')
    def export_csv(self, request):
        """
        Stream the current (filtered) catalogue as a CSV file.

        Respects every filter/search/ordering the list endpoint accepts,
        so e.g. ``?brand=3&status=publish`` only exports those rows.
        Used by the Products page "Export" button.
        """
        qs = self.filter_queryset(self.get_queryset()).select_related('brand')

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        ts = timezone.now().strftime('%Y%m%d-%H%M%S')
        response['Content-Disposition'] = f'attachment; filename="products-{ts}.csv"'

        writer = csv.writer(response)
        writer.writerow([
            'id', 'name', 'barcode', 'product_type', 'status',
            'purchase_price', 'sales_price', 'brand_id', 'brand_name',
            'wc_product_id', 'product_link', 'image_url',
            'is_pack', 'created_at', 'updated_at',
        ])
        for p in qs.iterator(chunk_size=200):
            writer.writerow([
                p.id, p.name, p.barcode or '', p.product_type, p.status,
                str(p.purchase_price or ''), str(p.sales_price or ''),
                p.brand_id or '', p.brand.name if p.brand_id else '',
                p.wc_product_id or '', p.product_link or '', p.image_url or '',
                'true' if p.is_pack else 'false',
                p.created_at.isoformat() if p.created_at else '',
                p.updated_at.isoformat() if p.updated_at else '',
            ])

        return response

    @action(
        detail=False,
        methods=['post'],
        url_path='import-csv',
        parser_classes=[MultiPartParser, JSONParser],
    )
    def import_csv(self, request):
        """
        Upsert products from an uploaded CSV.

        Multipart payload: ``file=<your.csv>``. The file must have a header
        row. Matching is by **barcode** (case-insensitive) — rows with an
        existing barcode are updated, rows with a new barcode are created,
        rows missing a barcode are skipped (counted as errors).

        Recognised columns (case-insensitive): ``barcode``, ``name``,
        ``product_type``, ``status``, ``purchase_price``, ``sales_price``,
        ``brand_id``, ``product_link``, ``image_url``.

        Returns ``{created, updated, skipped, errors: [{row, message}]}``.
        """
        upload = request.FILES.get('file')
        if not upload:
            return Response(
                {'detail': 'Upload a CSV under the "file" field.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            decoded = upload.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            return Response(
                {'detail': 'File is not valid UTF-8. Save the CSV as UTF-8 and retry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reader = csv.DictReader(io.StringIO(decoded))
        if not reader.fieldnames:
            return Response(
                {'detail': 'CSV is empty or has no header row.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Normalise headers so we accept "Barcode" / "BARCODE" / " barcode" alike.
        field_map = {h.strip().lower(): h for h in reader.fieldnames if h}

        def cell(row, key):
            real = field_map.get(key)
            return (row.get(real) or '').strip() if real else ''

        created = 0
        updated = 0
        skipped = 0
        errors = []

        VALID_TYPES = {'resell_product', 'pack', 'component', 'packaging_item'}
        # Accept legacy CSV exports and map them onto the canonical taxonomy.
        LEGACY_TYPE_ALIASES = {
            'resell': 'resell_product',
            'finished': 'resell_product',
            'packaging': 'packaging_item',
            'raw_material': 'component',
        }
        VALID_STATUS = set(self.BULK_STATUS_CHOICES)

        def to_decimal(raw):
            if raw in ('', None):
                return None
            try:
                return Decimal(raw)
            except (InvalidOperation, TypeError):
                raise ValueError(f'Invalid price: {raw!r}')

        with transaction.atomic():
            for line_num, row in enumerate(reader, start=2):  # start=2 → header is line 1
                barcode = cell(row, 'barcode')
                if not barcode:
                    skipped += 1
                    errors.append({'row': line_num, 'message': 'missing barcode'})
                    continue

                try:
                    payload = {
                        'name': cell(row, 'name') or None,
                        'product_type': (cell(row, 'product_type') or '').lower() or None,
                        'status': (cell(row, 'status') or '').lower() or None,
                        'purchase_price': to_decimal(cell(row, 'purchase_price')),
                        'sales_price': to_decimal(cell(row, 'sales_price')),
                        'product_link': cell(row, 'product_link') or None,
                        'image_url': cell(row, 'image_url') or None,
                    }
                except ValueError as exc:
                    skipped += 1
                    errors.append({'row': line_num, 'message': str(exc)})
                    continue

                if payload['product_type']:
                    payload['product_type'] = LEGACY_TYPE_ALIASES.get(
                        payload['product_type'], payload['product_type']
                    )
                if payload['product_type'] and payload['product_type'] not in VALID_TYPES:
                    skipped += 1
                    errors.append({
                        'row': line_num,
                        'message': f"product_type must be one of {sorted(VALID_TYPES)}",
                    })
                    continue
                if payload['status'] and payload['status'] not in VALID_STATUS:
                    skipped += 1
                    errors.append({
                        'row': line_num,
                        'message': f"status must be one of {sorted(VALID_STATUS)}",
                    })
                    continue

                brand_id_raw = cell(row, 'brand_id')
                brand_id = int(brand_id_raw) if brand_id_raw.isdigit() else None

                # Strip None values so we don't overwrite saved fields with blanks.
                clean = {k: v for k, v in payload.items() if v is not None}
                if brand_id is not None:
                    clean['brand_id'] = brand_id

                existing = Product.all_objects.filter(barcode__iexact=barcode).first()
                if existing:
                    for k, v in clean.items():
                        setattr(existing, k, v)
                    existing.save()
                    ProductAuditLog.objects.create(
                        product=existing,
                        user=request.user,
                        action=ProductAuditLog.Action.UPDATE,
                        changes={k: ['<via csv>', str(v)] for k, v in clean.items()},
                    )
                    updated += 1
                else:
                    if not clean.get('name'):
                        skipped += 1
                        errors.append({
                            'row': line_num,
                            'message': 'name is required to create a new product',
                        })
                        continue
                    clean.setdefault('product_type', 'resell_product')
                    clean.setdefault('status', 'publish')
                    clean.setdefault('purchase_price', Decimal('0'))
                    clean.setdefault('sales_price', Decimal('0'))
                    new_p = Product.objects.create(barcode=barcode, **clean)
                    ProductAuditLog.objects.create(
                        product=new_p,
                        user=request.user,
                        action=ProductAuditLog.Action.CREATE,
                    )
                    created += 1

        return Response({
            'created': created,
            'updated': updated,
            'skipped': skipped,
            'errors': errors,
        })

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
