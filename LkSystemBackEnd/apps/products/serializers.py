"""
LkSystem Products App - Serializers
DRF Serializers for the simplified Product model.
"""

from rest_framework import serializers
from decimal import Decimal

from .models import Product, ProductAuditLog


class PackItemSerializer(serializers.Serializer):
    """Validates a single pack item entry."""
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class ProductSerializer(serializers.ModelSerializer):
    """Full serializer for detail views and create/update."""

    brand_name = serializers.CharField(source='brand.name', read_only=True, allow_null=True)
    profit_margin = serializers.FloatField(read_only=True)
    pack_items_detail = serializers.SerializerMethodField(read_only=True)
    categories = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    category_names = serializers.SerializerMethodField(read_only=True)
    stock_total = serializers.SerializerMethodField(read_only=True)
    stock_by_channel = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Product
        fields = [
            'id',
            'wc_product_id',
            'name',
            'image_url',
            'product_link',
            'barcode',
            'product_type',
            'status',
            'purchase_price',
            'sales_price',
            'brand',
            'brand_name',
            'categories',
            'category_names',
            'profit_margin',
            'is_pack',
            'pack_items',
            'stock_total',
            'stock_by_channel',
            'pack_items_detail',
            'last_synced_at',
            'wc_date_created',
            'wc_date_modified',
            'created_at',
            'updated_at',
            'is_deleted',
            'deleted_at',
        ]
        read_only_fields = [
            'id',
            'wc_product_id',
            'last_synced_at',
            'wc_date_created',
            'wc_date_modified',
            'created_at',
            'updated_at',
            'is_deleted',
            'deleted_at',
        ]

    def get_pack_items_detail(self, obj):
        """Enrich pack_items with product name and image for display."""
        if not obj.is_pack or not obj.pack_items:
            return None
        ids = [item['product_id'] for item in obj.pack_items]
        products = {p.id: p for p in Product.objects.filter(pk__in=ids)}
        result = []
        for item in obj.pack_items:
            p = products.get(item['product_id'])
            result.append({
                'product_id': item['product_id'],
                'quantity': item['quantity'],
                'product_name': p.name if p else '(deleted)',
                'product_image': p.image_url if p else '',
                'product_barcode': p.barcode if p else '',
            })
        return result

    def get_category_names(self, obj):
        if not hasattr(obj, 'categories'):
            return []
        return list(obj.categories.values_list('name', flat=True))

    def get_stock_by_channel(self, obj):
        from apps.inventory.models import SalesChannelInventory

        rows = (
            SalesChannelInventory.objects
            .filter(product=obj)
            .select_related('sales_channel')
            .order_by('sales_channel__name')
        )
        return [
            {
                'sales_channel_id': row.sales_channel_id,
                'sales_channel_name': row.sales_channel.name if row.sales_channel else '',
                'sales_channel_type': row.sales_channel.channel_type if row.sales_channel else '',
                'quantity': row.quantity,
                'reserved_quantity': row.reserved_quantity,
                'available_quantity': row.available_quantity,
                'minimum_quantity': row.minimum_quantity,
                'bin_location': row.bin_location,
                'updated_at': row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ]

    def get_stock_total(self, obj):
        return sum(row['quantity'] for row in self.get_stock_by_channel(obj))

    def validate(self, attrs):
        is_pack = attrs.get('is_pack', getattr(self.instance, 'is_pack', False))
        pack_items = attrs.get('pack_items', getattr(self.instance, 'pack_items', None))

        if is_pack:
            if not pack_items or not isinstance(pack_items, list) or len(pack_items) == 0:
                raise serializers.ValidationError({
                    'pack_items': 'A pack must have at least one item.'
                })
            # Validate structure
            serializer = PackItemSerializer(data=pack_items, many=True)
            serializer.is_valid(raise_exception=True)
        elif pack_items:
            raise serializers.ValidationError({
                'pack_items': 'pack_items must be empty when is_pack is False.'
            })

        return attrs


class ProductListSerializer(serializers.ModelSerializer):
    """Lightweight serializer optimised for list views."""

    brand_name = serializers.CharField(source='brand.name', read_only=True, allow_null=True)
    stock_total = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Product
        fields = [
            'id',
            'wc_product_id',
            'name',
            'image_url',
            'product_link',
            'barcode',
            'product_type',
            'status',
            'purchase_price',
            'sales_price',
            'brand',
            'brand_name',
            'stock_total',
            'is_pack',
            'pack_items',
            'created_at',
            'updated_at',
            'is_deleted',
            'deleted_at',
        ]

    def get_stock_total(self, obj):
        return sum(inv.quantity for inv in obj.sales_channel_inventories.all())


class ProductAuditLogSerializer(serializers.ModelSerializer):
    """Read-only serializer for audit log entries."""

    user_name = serializers.CharField(source='user.full_name', read_only=True, default='System')
    action_display = serializers.CharField(source='get_action_display', read_only=True)

    class Meta:
        model = ProductAuditLog
        fields = [
            'id',
            'action',
            'action_display',
            'user',
            'user_name',
            'changes',
            'timestamp',
        ]
        read_only_fields = fields


class WooCommerceProductWebhookSerializer(serializers.Serializer):
    """
    Validates and transforms incoming WooCommerce product webhook payloads
    to the simplified local model format.
    """

    id = serializers.IntegerField(required=True)
    name = serializers.CharField(max_length=255, required=True)
    sku = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    type = serializers.CharField(required=False, default='simple')
    status = serializers.CharField(required=False, default='publish')
    permalink = serializers.URLField(required=False, allow_blank=True, default='')

    # Pricing
    regular_price = serializers.CharField(required=False, allow_blank=True, default='')

    # Media
    images = serializers.ListField(child=serializers.DictField(), required=False, default=list)

    # Timestamps
    date_created = serializers.DateTimeField(required=False, allow_null=True)
    date_modified = serializers.DateTimeField(required=False, allow_null=True)

    def to_internal_value(self, data):
        validated = super().to_internal_value(data)

        validated['wc_product_id'] = validated.pop('id')
        validated['barcode'] = validated.pop('sku', '')

        # Map WC type → local product_type (default to resell)
        wc_type = validated.pop('type', 'simple')
        validated['product_type'] = 'packaging' if wc_type == 'packaging' else 'resell'

        # Product link
        validated['product_link'] = validated.pop('permalink', '')

        # Pricing
        regular_price = validated.pop('regular_price', '')
        validated['sales_price'] = Decimal(regular_price) if regular_price else Decimal('0.00')

        # Primary image
        images = validated.pop('images', [])
        validated['image_url'] = images[0].get('src', '') if images else ''

        # Timestamps
        validated['wc_date_created'] = validated.pop('date_created', None)
        validated['wc_date_modified'] = validated.pop('date_modified', None)

        return validated
