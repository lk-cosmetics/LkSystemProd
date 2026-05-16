"""
LkSystem Brands App - Serializers
"""

from rest_framework import serializers
from .models import Brand


class BrandSerializer(serializers.ModelSerializer):
    """
    Full serializer for Brand model.
    Includes nested sales channels.
    """
    
    sales_channels = serializers.SerializerMethodField(read_only=True)
    company_name = serializers.CharField(source='company.name', read_only=True)
    company_abbreviation = serializers.CharField(source='company.abbreviation', read_only=True)
    channels_count = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = Brand
        fields = [
            'id',
            'company',
            'company_name',
            'company_abbreviation',
            'name',
            'logo',
            'sales_channels',
            'channels_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_sales_channels(self, obj):
        """Return nested sales channels data."""
        if hasattr(obj, 'sales_channels'):
            from apps.sales_channels.serializers import SalesChannelNestedSerializer
            return SalesChannelNestedSerializer(
                obj.sales_channels.all(), many=True, context=self.context
            ).data
        return []
    
    def get_channels_count(self, obj):
        """Return the count of sales channels for this brand."""
        if hasattr(obj, 'sales_channels'):
            return obj.sales_channels.count()
        return 0


class BrandListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for Brand list views.
    """
    
    company_name = serializers.CharField(source='company.name', read_only=True)
    channels_count = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = Brand
        fields = [
            'id',
            'company',
            'company_name',
            'name',
            'logo',
            'channels_count',
            'created_at',
            'updated_at',
        ]
    
    def get_channels_count(self, obj):
        if hasattr(obj, 'sales_channels'):
            return obj.sales_channels.count()
        return 0
