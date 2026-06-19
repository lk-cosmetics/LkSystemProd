"""
LkSystem Promotions App - Serializers
DRF Serializers for Promotion and PromotionChannelRule.
"""

from rest_framework import serializers
from django.db import transaction
from django.utils import timezone
from decimal import Decimal

from .models import Promotion, PromotionChannelRule, DiscountType, PromotionStatus
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class PromotionChannelRuleSerializer(serializers.ModelSerializer):
    """Serializer for individual channel rules."""
    
    sales_channel_name = serializers.CharField(
        source='sales_channel.name',
        read_only=True
    )
    sales_channel_type = serializers.CharField(
        source='sales_channel.get_channel_type_display',
        read_only=True
    )
    
    class Meta:
        model = PromotionChannelRule
        fields = [
            'id',
            'sales_channel',
            'sales_channel_name',
            'sales_channel_type',
            'discount_value',
            'is_enabled',
            'channel_priority',
            'channel_max_usage',
            'channel_current_usage',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'channel_current_usage', 'created_at', 'updated_at']


class PromotionChannelRuleInputSerializer(serializers.Serializer):
    """Input serializer for creating/updating channel rules in bulk."""
    
    sales_channel = serializers.PrimaryKeyRelatedField(
        queryset=SalesChannel.objects.all()
    )
    discount_value = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0'),
    )
    is_enabled = serializers.BooleanField(default=True)
    channel_priority = serializers.IntegerField(default=0, min_value=0)
    channel_max_usage = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=0
    )

    def validate_sales_channel(self, value):
        if value.channel_type not in (
            SalesChannel.ChannelType.POS, SalesChannel.ChannelType.WOOCOMMERCE,
        ):
            raise serializers.ValidationError(
                'Promotions can only be applied to POS or WooCommerce sales channels.'
            )
        return value


class PromotionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""

    product_name = serializers.CharField(source='product.name', read_only=True)
    product_image = serializers.CharField(
        source='product.image_url', read_only=True, allow_null=True
    )
    brand_name = serializers.CharField(source='brand.name', read_only=True, allow_null=True)
    # Company info via brand → keeps Promotion model clean (no direct company FK needed)
    company_id = serializers.SerializerMethodField()
    company_name = serializers.SerializerMethodField()
    channel_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    discount_type_display = serializers.CharField(
        source='get_discount_type_display',
        read_only=True,
    )
    is_currently_active = serializers.BooleanField(read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Promotion
        fields = [
            'id',
            'name',
            'code',
            'product',
            'product_name',
            'product_image',
            'brand',
            'brand_name',
            'company_id',
            'company_name',
            'discount_type',
            'discount_type_display',
            'default_discount_value',
            'start_date',
            'end_date',
            'status',
            'status_display',
            'is_active',
            'is_currently_active',
            'channel_count',
            'priority',
            'current_usage',
            'max_usage',
            'created_by',
            'created_by_name',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'current_usage', 'created_at', 'updated_at']

    def get_channel_count(self, obj):
        """Count channels — uses prefetch_related so 0 extra queries."""
        # channel_rules is prefetched; .all() re-uses the cache
        return obj.channel_rules.count()

    def get_company_id(self, obj):
        """Company ID via brand (no extra query — brand__company is select_related)."""
        if obj.brand_id and obj.brand and obj.brand.company_id:
            return obj.brand.company_id
        return None

    def get_company_name(self, obj):
        """Company name via brand (no extra query — brand__company is select_related)."""
        if obj.brand_id and obj.brand and obj.brand.company:
            return obj.brand.company.name
        return None

    def get_created_by_name(self, obj):
        """Creator full name."""
        if obj.created_by:
            return obj.created_by.get_full_name()
        return None


class PromotionDetailSerializer(serializers.ModelSerializer):
    """Full serializer with nested channel rules."""

    product_name = serializers.CharField(source='product.name', read_only=True)
    product_image = serializers.CharField(
        source='product.image_url', read_only=True, allow_null=True
    )
    product_sales_price = serializers.DecimalField(
        source='product.sales_price',
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )
    brand_name = serializers.CharField(source='brand.name', read_only=True, allow_null=True)
    company_id = serializers.SerializerMethodField()
    company_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    discount_type_display = serializers.CharField(
        source='get_discount_type_display',
        read_only=True,
    )
    is_currently_active = serializers.BooleanField(read_only=True)
    is_within_usage_limit = serializers.BooleanField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    # Nested channel rules (prefetched — no extra queries)
    channel_rules = PromotionChannelRuleSerializer(many=True, read_only=True)

    class Meta:
        model = Promotion
        fields = [
            'id',
            'name',
            'description',
            'code',
            'product',
            'product_name',
            'product_image',
            'product_sales_price',
            'brand',
            'brand_name',
            'company_id',
            'company_name',
            'discount_type',
            'discount_type_display',
            'default_discount_value',
            'start_date',
            'end_date',
            'status',
            'status_display',
            'is_active',
            'is_currently_active',
            'is_within_usage_limit',
            'max_usage',
            'current_usage',
            'priority',
            'is_stackable',
            'channel_rules',
            'created_by',
            'created_by_name',
            'updated_by',
            'updated_by_name',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id', 'current_usage', 'created_at', 'updated_at',
            'created_by', 'updated_by',
        ]

    def get_company_id(self, obj):
        if obj.brand_id and obj.brand and obj.brand.company_id:
            return obj.brand.company_id
        return None

    def get_company_name(self, obj):
        if obj.brand_id and obj.brand and obj.brand.company:
            return obj.brand.company.name
        return None

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name()
        return None

    def get_updated_by_name(self, obj):
        if obj.updated_by:
            return obj.updated_by.get_full_name()
        return None


class PromotionCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating promotions with channel rules in one request.
    
    Accepts nested channel_rules for the Promotion Builder UI.
    """
    
    channel_rules = PromotionChannelRuleInputSerializer(many=True, write_only=True)
    
    class Meta:
        model = Promotion
        fields = [
            'name',
            'description',
            'code',
            'product',
            'brand',
            'discount_type',
            'default_discount_value',
            'start_date',
            'end_date',
            'status',
            'is_active',
            'max_usage',
            'priority',
            'is_stackable',
            'channel_rules',
        ]
    
    def validate(self, attrs):
        """Validate promotion data."""
        # Validate date range
        if attrs.get('start_date') and attrs.get('end_date'):
            if attrs['start_date'] >= attrs['end_date']:
                raise serializers.ValidationError({
                    'end_date': 'End date must be after start date.'
                })
        
        # Validate channel_rules
        channel_rules = attrs.get('channel_rules', [])
        if not channel_rules:
            raise serializers.ValidationError({
                'channel_rules': 'At least one sales channel rule is required.'
            })
        
        # Check for duplicate channels
        channel_ids = [rule['sales_channel'].id for rule in channel_rules]
        if len(channel_ids) != len(set(channel_ids)):
            raise serializers.ValidationError({
                'channel_rules': 'Duplicate sales channels are not allowed.'
            })
        
        return attrs
    
    def create(self, validated_data):
        """Create promotion with channel rules."""
        channel_rules_data = validated_data.pop('channel_rules')
        
        # Set created_by from context
        request = self.context.get('request')
        if request and request.user:
            validated_data['created_by'] = request.user
            validated_data['updated_by'] = request.user
        
        # Create promotion
        promotion = Promotion.objects.create(**validated_data)
        
        # Create channel rules
        for rule_data in channel_rules_data:
            PromotionChannelRule.objects.create(
                promotion=promotion,
                sales_channel=rule_data['sales_channel'],
                discount_value=rule_data['discount_value'],
                is_enabled=rule_data.get('is_enabled', True),
                channel_priority=rule_data.get('channel_priority', 0),
                channel_max_usage=rule_data.get('channel_max_usage'),
            )
        
        return promotion


class PromotionUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating promotions.
    Channel rules are managed separately via dedicated endpoints.
    """
    
    channel_rules = PromotionChannelRuleInputSerializer(many=True, required=False)
    
    class Meta:
        model = Promotion
        fields = [
            'name',
            'description',
            'code',
            'product',
            'brand',
            'discount_type',
            'default_discount_value',
            'start_date',
            'end_date',
            'status',
            'is_active',
            'max_usage',
            'priority',
            'is_stackable',
            'channel_rules',
        ]
    
    def validate(self, attrs):
        """Validate promotion data."""
        if attrs.get('start_date') and attrs.get('end_date'):
            if attrs['start_date'] >= attrs['end_date']:
                raise serializers.ValidationError({
                    'end_date': 'End date must be after start date.'
                })
        return attrs
    
    def update(self, instance, validated_data):
        """Update promotion and optionally replace channel rules."""
        channel_rules_data = validated_data.pop('channel_rules', None)
        
        # Set updated_by
        request = self.context.get('request')
        if request and request.user:
            instance.updated_by = request.user
        
        # Update promotion fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        
        # If channel_rules provided, replace all rules
        if channel_rules_data is not None:
            # Delete existing rules
            instance.channel_rules.all().delete()
            
            # Create new rules
            for rule_data in channel_rules_data:
                PromotionChannelRule.objects.create(
                    promotion=instance,
                    sales_channel=rule_data['sales_channel'],
                    discount_value=rule_data['discount_value'],
                    is_enabled=rule_data.get('is_enabled', True),
                    channel_priority=rule_data.get('channel_priority', 0),
                    channel_max_usage=rule_data.get('channel_max_usage'),
                )
        
        return instance


class BulkPromotionItemSerializer(serializers.Serializer):
    """One row of the bulk-create payload — a product with its own discount."""

    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    discount_type = serializers.ChoiceField(choices=DiscountType.choices)
    discount_value = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    name_override = serializers.CharField(
        required=False, allow_blank=True, max_length=255,
        help_text='Optional per-product name override; defaults to the shared name.',
    )


class BulkCreatePromotionsSerializer(serializers.Serializer):
    """
    Create one Promotion per ``items`` entry in a single atomic request.

    Every promotion is created with the same shared metadata (name, dates,
    channels, etc.) — the per-product discount type/value comes from the
    item itself. Channel rules are mirrored: every selected channel
    receives the item's discount value.
    """

    # ── Shared meta ────────────────────────────────────────────────────
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(
        required=False, allow_blank=True, default='',
    )
    code = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=50, default='',
    )
    brand = serializers.IntegerField(required=False, allow_null=True)
    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField(required=False, allow_null=True)
    status = serializers.ChoiceField(
        choices=PromotionStatus.choices,
        default=PromotionStatus.ACTIVE,
    )
    is_active = serializers.BooleanField(default=True)
    is_stackable = serializers.BooleanField(default=False)
    priority = serializers.IntegerField(default=0, min_value=0)
    max_usage = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    sales_channels = serializers.ListField(
        child=serializers.IntegerField(),
        allow_empty=False,
        help_text='IDs of POS sales channels the promotions apply to.',
    )

    # ── Items (one promotion per product) ─────────────────────────────
    items = BulkPromotionItemSerializer(many=True, allow_empty=False)

    # ────────────────────────────────────────────────────────────────────
    def validate(self, attrs):
        start = attrs.get('start_date')
        end = attrs.get('end_date')
        if start and end and start >= end:
            raise serializers.ValidationError({
                'end_date': 'End date must be after start date.',
            })

        # No duplicate products
        product_ids = [item['product'].id for item in attrs['items']]
        if len(product_ids) != len(set(product_ids)):
            raise serializers.ValidationError({
                'items': 'Duplicate products are not allowed.',
            })

        # All channels must exist and be a promotable type (POS or WooCommerce).
        channel_ids = list(dict.fromkeys(attrs['sales_channels']))  # de-dupe, keep order
        channels = list(SalesChannel.objects.filter(pk__in=channel_ids))
        if len(channels) != len(channel_ids):
            raise serializers.ValidationError({
                'sales_channels': 'One or more sales channels do not exist.',
            })
        allowed = (SalesChannel.ChannelType.POS, SalesChannel.ChannelType.WOOCOMMERCE)
        invalid = [c.name for c in channels if c.channel_type not in allowed]
        if invalid:
            raise serializers.ValidationError({
                'sales_channels':
                    f'Promotions only apply to POS or WooCommerce channels. Invalid: {", ".join(invalid)}',
            })

        attrs['_channels'] = channels
        return attrs

    def create(self, validated_data):
        import uuid as _uuid

        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None

        channels = validated_data.pop('_channels')
        items = validated_data.pop('items')
        brand_id = validated_data.pop('brand', None)

        # All siblings created together share one campaign UUID — the UI
        # surfaces them as a single row.
        group_id = _uuid.uuid4()

        shared = {
            'name': validated_data['name'],
            'description': validated_data.get('description', ''),
            'code': validated_data.get('code') or '',
            'brand_id': brand_id,
            'group_id': group_id,
            'start_date': validated_data['start_date'],
            'end_date': validated_data.get('end_date'),
            'status': validated_data.get('status', PromotionStatus.ACTIVE),
            'is_active': validated_data.get('is_active', True),
            'is_stackable': validated_data.get('is_stackable', False),
            'priority': validated_data.get('priority', 0),
            'max_usage': validated_data.get('max_usage'),
        }
        if user and user.is_authenticated:
            shared['created_by'] = user
            shared['updated_by'] = user

        created: list[Promotion] = []
        with transaction.atomic():
            for item in items:
                product = item['product']
                discount_type = item['discount_type']
                discount_value = item['discount_value']
                name = item.get('name_override') or shared['name']

                promo = Promotion.objects.create(
                    product=product,
                    discount_type=discount_type,
                    default_discount_value=discount_value,
                    **{**shared, 'name': name},
                )
                # Same discount applied to every selected channel
                PromotionChannelRule.objects.bulk_create([
                    PromotionChannelRule(
                        promotion=promo,
                        sales_channel=ch,
                        discount_value=discount_value,
                        is_enabled=True,
                    )
                    for ch in channels
                ])
                created.append(promo)

        return created


class BulkDeletePromotionsSerializer(serializers.Serializer):
    """Body for ``POST /promotions/bulk_delete/``."""

    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )


# =============================================================================
# Promotion GROUP serializers
# =============================================================================

class PromotionGroupMemberSerializer(serializers.ModelSerializer):
    """One member of a promotion group — a single product + its discount."""

    product_name = serializers.CharField(source='product.name', read_only=True)
    product_image = serializers.URLField(source='product.image_url', read_only=True, allow_null=True)
    product_barcode = serializers.CharField(source='product.barcode', read_only=True, allow_null=True)
    product_type = serializers.CharField(source='product.product_type', read_only=True)
    is_pack = serializers.BooleanField(source='product.is_pack', read_only=True)
    discount_value = serializers.DecimalField(
        source='default_discount_value', max_digits=10, decimal_places=2, read_only=True,
    )

    class Meta:
        model = Promotion
        fields = [
            'id',
            'product',
            'product_name',
            'product_image',
            'product_barcode',
            'product_type',
            'is_pack',
            'discount_type',
            'discount_value',
            'is_active',
            'current_usage',
        ]


class PromotionGroupListSerializer(serializers.Serializer):
    """One row per ``group_id`` for the campaign list view."""

    group_id = serializers.UUIDField()
    name = serializers.CharField()
    code = serializers.CharField(allow_blank=True, allow_null=True)
    description = serializers.CharField(allow_blank=True)
    brand = serializers.IntegerField(allow_null=True)
    brand_name = serializers.CharField(allow_null=True)
    company_id = serializers.IntegerField(allow_null=True)
    company_name = serializers.CharField(allow_null=True)

    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField(allow_null=True)
    status = serializers.CharField()
    is_active = serializers.BooleanField()
    is_currently_active = serializers.BooleanField()
    is_stackable = serializers.BooleanField()
    priority = serializers.IntegerField()
    max_usage = serializers.IntegerField(allow_null=True)

    product_count = serializers.IntegerField()
    channel_count = serializers.IntegerField()
    total_usage = serializers.IntegerField()

    # Compact discount summary — the wizard mirrors per-product values, so
    # the same group can contain a mix of percentage / fixed entries.
    discount_min = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    discount_max = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    discount_types = serializers.ListField(child=serializers.CharField())

    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class PromotionGroupDetailSerializer(serializers.Serializer):
    """Full group payload — shared meta + members + sales-channel set."""

    group_id = serializers.UUIDField()
    name = serializers.CharField()
    code = serializers.CharField(allow_blank=True, allow_null=True)
    description = serializers.CharField(allow_blank=True)
    brand = serializers.IntegerField(allow_null=True)
    brand_name = serializers.CharField(allow_null=True)
    company_id = serializers.IntegerField(allow_null=True)
    company_name = serializers.CharField(allow_null=True)

    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField(allow_null=True)
    status = serializers.CharField()
    is_active = serializers.BooleanField()
    is_currently_active = serializers.BooleanField()
    is_stackable = serializers.BooleanField()
    priority = serializers.IntegerField()
    max_usage = serializers.IntegerField(allow_null=True)
    total_usage = serializers.IntegerField()

    members = PromotionGroupMemberSerializer(many=True)
    sales_channel_ids = serializers.ListField(child=serializers.IntegerField())
    # ``sales_channels`` carries the same channels with their human-readable
    # names — the details dialog renders these instead of "Channel #<id>".
    sales_channels = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField(allow_null=True)),
    )


class PromotionGroupItemInputSerializer(serializers.Serializer):
    """One row of the update payload — keep ``member_id`` to edit in place."""

    member_id = serializers.IntegerField(required=False, allow_null=True)
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    discount_type = serializers.ChoiceField(choices=DiscountType.choices)
    discount_value = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)


class UpdatePromotionGroupSerializer(serializers.Serializer):
    """Body for ``POST /promotions/groups/<group_id>/update/``.

    Carries the desired final state of the group. The view reconciles:
        * delete members whose id is missing from ``items``
        * update members whose ``member_id`` is present
        * create new members for items without ``member_id``
    Channels are mirrored to every member (same set, per-member discount).
    """

    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    code = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=50, default='',
    )
    start_date = serializers.DateTimeField()
    end_date = serializers.DateTimeField(required=False, allow_null=True)
    status = serializers.ChoiceField(
        choices=PromotionStatus.choices, default=PromotionStatus.ACTIVE,
    )
    is_active = serializers.BooleanField(default=True)
    is_stackable = serializers.BooleanField(default=False)
    priority = serializers.IntegerField(default=0, min_value=0)
    max_usage = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    sales_channels = serializers.ListField(
        child=serializers.IntegerField(), allow_empty=False,
    )
    items = PromotionGroupItemInputSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        start = attrs.get('start_date')
        end = attrs.get('end_date')
        if start and end and start >= end:
            raise serializers.ValidationError({
                'end_date': 'End date must be after start date.',
            })

        product_ids = [item['product'].id for item in attrs['items']]
        if len(product_ids) != len(set(product_ids)):
            raise serializers.ValidationError({
                'items': 'Duplicate products are not allowed in the same group.',
            })

        channel_ids = list(dict.fromkeys(attrs['sales_channels']))
        channels = list(SalesChannel.objects.filter(pk__in=channel_ids))
        if len(channels) != len(channel_ids):
            raise serializers.ValidationError({
                'sales_channels': 'One or more sales channels do not exist.',
            })
        allowed = (SalesChannel.ChannelType.POS, SalesChannel.ChannelType.WOOCOMMERCE)
        invalid = [c.name for c in channels if c.channel_type not in allowed]
        if invalid:
            raise serializers.ValidationError({
                'sales_channels':
                    f'Promotions only apply to POS or WooCommerce channels. Invalid: {", ".join(invalid)}',
            })
        attrs['_channels'] = channels
        return attrs


class CalculateDiscountSerializer(serializers.Serializer):
    """Serializer for calculate_discount endpoint."""
    
    product_id = serializers.IntegerField()
    sales_channel_id = serializers.IntegerField()
    original_price = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False
    )


class DiscountResultSerializer(serializers.Serializer):
    """Response serializer for discount calculation."""
    
    product_id = serializers.IntegerField()
    product_name = serializers.CharField()
    sales_channel_id = serializers.IntegerField()
    sales_channel_name = serializers.CharField()
    original_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    discount_value = serializers.DecimalField(max_digits=10, decimal_places=2)
    discount_type = serializers.CharField()
    discounted_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    savings = serializers.DecimalField(max_digits=10, decimal_places=2)
    promotion_id = serializers.IntegerField()
    promotion_name = serializers.CharField()
