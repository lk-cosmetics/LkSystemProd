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
# CAISSE EXPENSES
# ──────────────────────────────────────────────────────────────────────

from .models import Expense  # noqa: E402


class ExpenseSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, default=None)

    class Meta:
        model = Expense
        fields = [
            'id', 'company', 'sales_channel', 'sales_channel_name',
            'amount', 'category', 'category_display',
            'note', 'occurred_at',
            'created_by', 'created_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['company', 'created_by', 'created_at', 'updated_at']

    def validate(self, attrs):
        sc = attrs.get('sales_channel')
        if sc is None:
            raise serializers.ValidationError({'sales_channel': 'Required.'})
        if sc.channel_type != SalesChannel.ChannelType.POS:
            raise serializers.ValidationError(
                {'sales_channel': 'Expenses can only be recorded against a POS sales channel.'}
            )
        amount = attrs.get('amount')
        if amount is None or amount <= 0:
            raise serializers.ValidationError({'amount': 'Amount must be greater than zero.'})
        return attrs
