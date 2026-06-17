"""
LkSystem Products App - Serializers
DRF Serializers for the simplified Product model.
"""

import json

from rest_framework import serializers
from decimal import Decimal

from .models import Product, ProductAuditLog
from apps.categories.models import Category


class PackItemSerializer(serializers.Serializer):
    """Validates a single pack item entry."""
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class ProductSerializer(serializers.ModelSerializer):
    """Full serializer for detail views and create/update."""

    brand_name = serializers.CharField(source='brand.name', read_only=True, allow_null=True)
    profit_margin = serializers.FloatField(read_only=True)
    pack_items_detail = serializers.SerializerMethodField(read_only=True)
    # Writable: lets staff link a product to categories from the product form
    # (WooCommerce sync still attaches its own via the product-sync hook). The
    # assigned categories are validated to the product's own brand in validate().
    categories = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=Category.objects.all(),
    )
    category_names = serializers.SerializerMethodField(read_only=True)
    stock_total = serializers.SerializerMethodField(read_only=True)
    stock_by_channel = serializers.SerializerMethodField(read_only=True)
    image = serializers.ImageField(required=False, allow_null=True, use_url=True)

    class Meta:
        model = Product
        fields = [
            'id',
            'wc_product_id',
            'name',
            'image_url',
            'image',
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Tenant isolation: a user may only link a product to categories inside
        # the sales channels they can reach. Scoping the field queryset rejects
        # a foreign-company category PK at field level — before validate() and
        # independent of when the product's brand is resolved (the brand can be
        # injected after validation on the workspace-create path).
        request = self.context.get('request')
        categories_field = self.fields.get('categories')
        if request is not None and categories_field is not None:
            from apps.rbac.services import visible_sales_channel_ids
            channel_ids = visible_sales_channel_ids(request.user)
            if channel_ids is None:
                queryset = Category.objects.all()
            elif not channel_ids:
                queryset = Category.objects.none()
            else:
                queryset = Category.objects.filter(sales_channel_id__in=channel_ids)
            categories_field.child_relation.queryset = queryset

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
        # Multipart (image upload) sends pack_items as a JSON string; decode it
        # back to a list / None so the structural checks below see real data.
        raw_pack_items = attrs.get('pack_items')
        if isinstance(raw_pack_items, str):
            try:
                attrs['pack_items'] = (
                    json.loads(raw_pack_items) if raw_pack_items.strip() else None
                )
            except (ValueError, TypeError):
                raise serializers.ValidationError(
                    {'pack_items': 'Invalid pack_items JSON.'}
                )

        is_pack = attrs.get('is_pack', getattr(self.instance, 'is_pack', False))
        pack_items = attrs.get('pack_items', getattr(self.instance, 'pack_items', None))
        product_type = attrs.get(
            'product_type', getattr(self.instance, 'product_type', Product.ProductType.RESELL_PRODUCT)
        )

        # Keep product_type='pack' and the is_pack flag in sync (single source of truth).
        if product_type == Product.ProductType.PACK:
            is_pack = True
        if is_pack:
            product_type = Product.ProductType.PACK
        attrs['is_pack'] = is_pack
        attrs['product_type'] = product_type

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

        # Categories can only be linked within the product's own brand — a
        # category belongs to a brand through its sales channel.
        categories = attrs.get('categories')
        if categories:
            brand = attrs.get('brand') or getattr(self.instance, 'brand', None)
            brand_id = getattr(brand, 'id', None)
            if brand_id is not None:
                cross_brand = [
                    c.name for c in categories
                    if getattr(c.sales_channel, 'brand_id', None) not in (None, brand_id)
                ]
                if cross_brand:
                    raise serializers.ValidationError({
                        'categories': (
                            "These categories belong to a different brand: "
                            + ", ".join(cross_brand)
                        )
                    })

        return attrs

    def create(self, validated_data):
        instance = super().create(validated_data)
        self._mirror_uploaded_image(instance, validated_data)
        return instance

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        self._mirror_uploaded_image(instance, validated_data)
        return instance

    @staticmethod
    def _mirror_uploaded_image(instance, validated_data):
        """Mirror a freshly uploaded image's served URL into ``image_url``.

        Keeps a single display field (``image_url``) so every existing render
        path — POS cards, order lines, BI, pack builder — shows the uploaded
        picture with no per-call change. Only runs when a new file was uploaded
        in this request; pasting or clearing the URL text field is untouched.
        """
        if validated_data.get('image') and instance.image:
            url = instance.image.url
            if instance.image_url != url:
                instance.image_url = url
                instance.save(update_fields=['image_url'])


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
            'image',
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

        # Every product synced from WooCommerce is a normal sellable good, so it
        # maps to RESELL_PRODUCT. The internal-only taxonomies (component for BOM
        # parts, packaging_item for shipping supplies) are created locally and
        # never arrive over a WooCommerce webhook.
        validated.pop('type', None)  # WC "type" is informational only
        validated['product_type'] = Product.ProductType.RESELL_PRODUCT

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
