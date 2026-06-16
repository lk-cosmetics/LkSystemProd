"""
LkSystem Sales Channels App - Serializers
"""

from rest_framework import serializers
from .models import SalesChannel


class SalesChannelSerializer(serializers.ModelSerializer):
    """
    Full serializer for SalesChannel model.
    Returns all data including WooCommerce configuration.
    """
    
    channel_type_display = serializers.CharField(
        source='get_channel_type_display',
        read_only=True
    )
    company_id = serializers.IntegerField(source='brand.company_id', read_only=True)
    company_name = serializers.CharField(source='brand.company.name', read_only=True)
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    brand_logo = serializers.SerializerMethodField()

    def get_brand_logo(self, obj):
        logo = getattr(getattr(obj, 'brand', None), 'logo', None)
        if not logo:
            return None
        try:
            url = logo.url
        except ValueError:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url
    
    class Meta:
        model = SalesChannel
        fields = [
            'id',
            'brand',
            'brand_name',
            'brand_logo',
            'name',
            'code',
            'channel_type',
            'channel_type_display',
            'store_type',
            'is_active',
            'is_default',
            'address',
            'city',
            'state',
            'delivery_api_key',
            'phone',
            'email',
            'wc_store_url',
            'wc_consumer_key',
            'wc_consumer_secret',
            'wc_webhook_token',
            'wc_push_status_enabled',
            'company_id',
            'company_name',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        """Validate channel-type-specific required fields."""
        channel_type = attrs.get('channel_type', getattr(self.instance, 'channel_type', None))

        if channel_type == SalesChannel.ChannelType.WOOCOMMERCE:
            wc_store_url = attrs.get('wc_store_url', getattr(self.instance, 'wc_store_url', ''))
            wc_consumer_key = attrs.get('wc_consumer_key', getattr(self.instance, 'wc_consumer_key', ''))
            wc_consumer_secret = attrs.get('wc_consumer_secret', getattr(self.instance, 'wc_consumer_secret', ''))

            if not wc_store_url:
                raise serializers.ValidationError({
                    'wc_store_url': 'Store URL is required for WooCommerce channels.'
                })
            if not wc_consumer_key:
                raise serializers.ValidationError({
                    'wc_consumer_key': 'Consumer key is required. Get it from WooCommerce > Settings > REST API.'
                })
            if not wc_consumer_secret:
                raise serializers.ValidationError({
                    'wc_consumer_secret': 'Consumer secret is required. Get it from WooCommerce > Settings > REST API.'
                })

        return super().validate(attrs)


class SalesChannelNestedSerializer(serializers.ModelSerializer):
    """
    Nested serializer for SalesChannel within Brand.
    Returns all data.
    """
    
    channel_type_display = serializers.CharField(
        source='get_channel_type_display',
        read_only=True
    )
    brand_logo = serializers.SerializerMethodField()

    def get_brand_logo(self, obj):
        logo = getattr(getattr(obj, 'brand', None), 'logo', None)
        if not logo:
            return None
        try:
            url = logo.url
        except ValueError:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url
    
    class Meta:
        model = SalesChannel
        fields = [
            'id',
            'name',
            'brand_logo',
            'code',
            'channel_type',
            'channel_type_display',
            'store_type',
            'is_active',
            'is_default',
            'address',
            'city',
            'state',
            'delivery_api_key',
            'phone',
            'email',
            'wc_store_url',
            'wc_consumer_key',
            'wc_consumer_secret',
            'wc_webhook_token',
            'wc_push_status_enabled',
            'created_at',
            'updated_at',
        ]


class SalesChannelListSerializer(serializers.ModelSerializer):
    """
    Serializer for SalesChannel list views - returns all data.
    """

    channel_type_display = serializers.CharField(
        source='get_channel_type_display',
        read_only=True
    )
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    brand_logo = serializers.SerializerMethodField()
    company_name = serializers.CharField(source='brand.company.name', read_only=True)
    company_id = serializers.IntegerField(source='brand.company_id', read_only=True)

    def get_brand_logo(self, obj):
        logo = getattr(getattr(obj, 'brand', None), 'logo', None)
        if not logo:
            return None
        try:
            url = logo.url
        except ValueError:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url

    class Meta:
        model = SalesChannel
        fields = [
            'id',
            'brand',
            'brand_name',
            'brand_logo',
            'company_id',
            'company_name',
            'name',
            'code',
            'channel_type',
            'channel_type_display',
            'store_type',
            'is_active',
            'is_default',
            'address',
            'city',
            'state',
            'delivery_api_key',
            'phone',
            'email',
            'wc_store_url',
            'wc_consumer_key',
            'wc_consumer_secret',
            'wc_webhook_token',
            'wc_push_status_enabled',
            'created_at',
            'updated_at',
        ]


class WebhookTokenSerializer(serializers.Serializer):
    """
    Serializer for webhook token response.
    webhook_token is generated by the backend for WooCommerce to authenticate callbacks.
    """
    webhook_token = serializers.CharField(
        read_only=True, 
        help_text='Webhook authentication token (whk_xxx) - Use this in WooCommerce webhook settings'
    )


# ──────────────────────────────────────────────────────────────────────
# CAISSE — CASH MOVEMENTS (unified expenses + alimentations)
# ──────────────────────────────────────────────────────────────────────

from .models import (  # noqa: E402
    CashMovement, EXPENSE_CATEGORIES, DEPOSIT_CATEGORIES, CATEGORY_LABELS,
)


class CashMovementSerializer(serializers.ModelSerializer):
    """One serializer for both sides of the till — expenses (cash out) and
    alimentations / deposits (cash in), discriminated by ``movement_type``."""
    movement_type_display = serializers.CharField(source='get_movement_type_display', read_only=True)
    category_display = serializers.SerializerMethodField()
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, default=None)
    # Optional on the wire — defaults to "now" so a caller may omit it.
    occurred_at = serializers.DateTimeField(required=False)

    class Meta:
        model = CashMovement
        fields = [
            'id', 'company', 'sales_channel', 'sales_channel_name',
            'movement_type', 'movement_type_display',
            'category', 'category_display',
            'amount', 'note', 'occurred_at',
            'created_by', 'created_by_name',
            'is_deleted', 'deleted_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'company', 'created_by', 'is_deleted', 'deleted_at',
            'created_at', 'updated_at',
        ]

    def get_category_display(self, obj) -> str:
        return CATEGORY_LABELS.get(obj.category, obj.category)

    def validate(self, attrs):
        from django.utils import timezone
        if not attrs.get('occurred_at') and getattr(self.instance, 'occurred_at', None) is None:
            attrs['occurred_at'] = timezone.now()
        sc = attrs.get('sales_channel', getattr(self.instance, 'sales_channel', None))
        if sc is None:
            raise serializers.ValidationError({'sales_channel': 'Required.'})
        amount = attrs.get('amount', getattr(self.instance, 'amount', None))
        if amount is None or amount <= 0:
            raise serializers.ValidationError({'amount': 'Amount must be greater than zero.'})

        movement_type = attrs.get(
            'movement_type', getattr(self.instance, 'movement_type', None),
        )
        if movement_type not in (CashMovement.Type.EXPENSE, CashMovement.Type.DEPOSIT):
            raise serializers.ValidationError(
                {'movement_type': 'Must be "expense" or "deposit".'}
            )
        # Category must belong to the chosen side of the till.
        valid = EXPENSE_CATEGORIES if movement_type == CashMovement.Type.EXPENSE else DEPOSIT_CATEGORIES
        category = attrs.get('category', getattr(self.instance, 'category', None) or 'OTHER')
        if category not in valid:
            raise serializers.ValidationError(
                {'category': f'Invalid category for a {movement_type}. Allowed: {", ".join(valid)}.'}
            )
        attrs['category'] = category
        return attrs
