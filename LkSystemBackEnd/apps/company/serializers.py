"""
LkSystem Company App - Serializers
"""

from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field, OpenApiExample
from drf_spectacular.types import OpenApiTypes
from .models import Company


class CompanySerializer(serializers.ModelSerializer):
    """
    Full serializer for Company model.
    Only 'name' is required! Everything else is optional or auto-generated.
    """
    
    brands_count = serializers.SerializerMethodField(read_only=True, help_text='Number of brands under this company')
    logo = serializers.ImageField(required=False, allow_null=True, use_url=True, help_text='Company logo image file')
    
    # Make these fields explicitly optional in the API with helpful descriptions
    name = serializers.CharField(
        max_length=255,
        help_text='Company name (required). Will be auto-capitalized.'
    )
    legal_name = serializers.CharField(
        required=False, 
        allow_blank=True, 
        default='',
        help_text='Legal registered name. Auto-filled from name if empty.'
    )
    abbreviation = serializers.CharField(
        required=False, 
        allow_blank=True, 
        default='',
        max_length=5,
        help_text='Short code (max 5 chars). Auto-generated from name if empty. Always uppercase.'
    )
    
    class Meta:
        model = Company
        fields = [
            'id',
            'name',
            'legal_name',
            'abbreviation',
            'logo',
            'matricule_fiscale',
            'registre_commerce',
            'activity_code',
            'bank_name',
            'rib',
            'address',
            'city',
            'phone',
            'email',
            'is_active',
            'brands_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'brands_count']
    
    @extend_schema_field(OpenApiTypes.INT)
    def get_brands_count(self, obj):
        """Return the count of brands for this company."""
        if hasattr(obj, 'brands'):
            return obj.brands.count()
        return 0
    
    def validate_name(self, value):
        """Clean and capitalize name properly."""
        return value.strip().title() if value else value
    
    def validate_abbreviation(self, value):
        """Ensure abbreviation is uppercase and max 5 chars."""
        if value:
            return value.upper()[:5]
        return value  # Empty is OK, model will auto-generate
    
    def validate_email(self, value):
        """Normalize email to lowercase."""
        return value.lower().strip() if value else value
    
    def validate_phone(self, value):
        """Clean phone number."""
        if value:
            # Remove spaces and common separators
            return value.replace(' ', '').replace('-', '').replace('.', '')
        return value


class CompanyListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for Company list views with logo support.
    """
    
    brands_count = serializers.SerializerMethodField(read_only=True)
    logo = serializers.ImageField(read_only=True, use_url=True)
    
    class Meta:
        model = Company
        fields = [
            'id',
            'name',
            'abbreviation',
            'logo',
            'city',
            'is_active',
            'brands_count',
        ]
    
    def get_brands_count(self, obj):
        if hasattr(obj, 'brands'):
            return obj.brands.count()
        return 0


class CompanyDetailSerializer(CompanySerializer):
    """
    Detailed serializer for Company with nested brands.
    Used for retrieve operations.
    """
    
    brands = serializers.SerializerMethodField(read_only=True)
    
    class Meta(CompanySerializer.Meta):
        fields = CompanySerializer.Meta.fields + ['brands']
    
    def get_brands(self, obj):
        """Return nested brands data."""
        if hasattr(obj, 'brands'):
            from apps.brands.serializers import BrandListSerializer
            return BrandListSerializer(
                obj.brands.all(), many=True, context=self.context
            ).data
        return []
