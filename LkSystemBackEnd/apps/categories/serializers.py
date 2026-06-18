"""
LkSystem Categories App - Serializers
DRF Serializers for Category model.
"""

from rest_framework import serializers
from .models import Category


class CategoryProductCountsMixin(serializers.Serializer):
    """Adds product tallies to a category payload.

    Reads the ``products_count`` / ``resell_products_count`` annotations set by
    ``CategoryViewSet.get_queryset`` (so list + detail pay no per-row query),
    and falls back to a live count for responses that bypass that queryset
    (e.g. the create/update response, which serializes the saved instance).
    """

    products_count = serializers.SerializerMethodField()
    resell_products_count = serializers.SerializerMethodField()

    def get_products_count(self, obj):
        annotated = getattr(obj, 'products_count', None)
        return annotated if annotated is not None else obj.products.count()

    def get_resell_products_count(self, obj):
        annotated = getattr(obj, 'resell_products_count', None)
        if annotated is not None:
            return annotated
        from apps.products.models import Product
        return obj.products.filter(product_type=Product.ProductType.RESELL_PRODUCT).count()


class CategorySerializer(CategoryProductCountsMixin, serializers.ModelSerializer):
    """
    Full serializer for Category model.
    Used for detailed views and create/update operations.
    """
    
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True)
    children_count = serializers.SerializerMethodField()
    image = serializers.ImageField(required=False, allow_null=True, use_url=True)

    class Meta:
        model = Category
        fields = [
            'id',
            'wc_category_id',
            'sales_channel',
            'name',
            'slug',
            'description',
            'parent',
            'parent_name',
            'image_url',
            'image',
            'display_order',
            'children_count',
            'products_count',
            'resell_products_count',
            'brand_name',
            'last_synced_at',
            'created_at',
            'updated_at',
            'created_by',
            'updated_by',
        ]
        read_only_fields = [
            'id',
            'wc_category_id',
            'last_synced_at',
            'created_at',
            'updated_at',
            'created_by',
            'updated_by',
        ]

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
        """Mirror a freshly uploaded image's served URL into ``image_url`` so the
        single display field used by the cards/detail keeps working. Only runs
        when a new file was uploaded; a pasted URL is left untouched."""
        if validated_data.get('image') and instance.image:
            url = instance.image.url
            if instance.image_url != url:
                instance.image_url = url
                instance.save(update_fields=['image_url'])
    
    def get_children_count(self, obj):
        """Get count of child categories."""
        return obj.children.count()


class CategoryListSerializer(CategoryProductCountsMixin, serializers.ModelSerializer):
    """
    Lightweight serializer for list views.
    Optimized for performance with minimal fields.
    """

    brand_name = serializers.CharField(source='brand.name', read_only=True)
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)
    image = serializers.ImageField(read_only=True, use_url=True)

    class Meta:
        model = Category
        fields = [
            'id',
            'wc_category_id',
            'sales_channel',
            'sales_channel_name',
            'name',
            'slug',
            'parent',
            'parent_name',
            'image_url',
            'image',
            'display_order',
            'brand_name',
            'products_count',
            'resell_products_count',
        ]


class CategoryTreeSerializer(serializers.ModelSerializer):
    """
    Recursive serializer for hierarchical category tree.
    """
    
    children = serializers.SerializerMethodField()
    
    class Meta:
        model = Category
        fields = [
            'id',
            'wc_category_id',
            'name',
            'slug',
            'children',
        ]
    
    def get_children(self, obj):
        """Recursively serialize child categories."""
        children = obj.children.all()
        return CategoryTreeSerializer(children, many=True, context=self.context).data


class WooCommerceCategoryWebhookSerializer(serializers.Serializer):
    """
    Serializer for WooCommerce category webhook payload.
    Validates and transforms incoming webhook data.
    """
    
    id = serializers.IntegerField(required=True)
    name = serializers.CharField(max_length=255, required=True)
    slug = serializers.SlugField(max_length=255, required=True)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    parent = serializers.IntegerField(required=False, default=0)
    menu_order = serializers.IntegerField(required=False, default=0)
    image = serializers.DictField(required=False, allow_null=True)
    
    def to_internal_value(self, data):
        """Transform WooCommerce payload to internal format."""
        validated = super().to_internal_value(data)
        
        # Extract image URL from nested structure
        image_data = validated.get('image')
        validated['image_url'] = ''
        if image_data and isinstance(image_data, dict):
            validated['image_url'] = image_data.get('src', '')
        
        # Store WC parent ID for sync resolution (not persisted on model)
        wc_parent = validated.pop('parent', 0) or 0
        validated['_wc_parent_id'] = wc_parent if wc_parent != 0 else None
        
        # Transform menu_order to display_order
        validated['display_order'] = validated.pop('menu_order', 0)
        
        # Transform id to wc_category_id
        validated['wc_category_id'] = validated.pop('id')
        
        return validated
