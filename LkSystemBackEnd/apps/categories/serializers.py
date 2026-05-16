"""
LkSystem Categories App - Serializers
DRF Serializers for Category model.
"""

from rest_framework import serializers
from .models import Category


class CategorySerializer(serializers.ModelSerializer):
    """
    Full serializer for Category model.
    Used for detailed views and create/update operations.
    """
    
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True)
    children_count = serializers.SerializerMethodField()
    
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
            'display_order',
            'children_count',
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
    
    def get_children_count(self, obj):
        """Get count of child categories."""
        return obj.children.count()


class CategoryListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for list views.
    Optimized for performance with minimal fields.
    """
    
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    
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
            'display_order',
            'brand_name',
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
