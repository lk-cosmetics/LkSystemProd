"""
LkSystem Orders App - Serializers
"""

from decimal import Decimal
from rest_framework import serializers
from .models import Order, OrderLine, OrderLog, OrderSyncEvent
from apps.sales_channels.models import SalesChannel
from apps.clients.models import Client
from apps.products.models import Product


# ═════════════════════════════════════════════════════════════════════════════
# ORDER LINE
# ═════════════════════════════════════════════════════════════════════════════

class OrderLineSerializer(serializers.ModelSerializer):
    """Read-only representation of an order line with product details."""
    product_name_from_api = serializers.CharField(source='product_name', read_only=True)
    product_id = serializers.IntegerField(source='product.id', read_only=True, required=False)
    product_type = serializers.CharField(source='product.product_type', read_only=True, default=None)
    product_status = serializers.CharField(source='product.get_status_display', read_only=True, default=None)
    product_image = serializers.SerializerMethodField()

    class Meta:
        model = OrderLine
        fields = [
            'id', 'product', 'product_id', 'external_line_id', 'wc_product_id', 
            'product_name', 'product_name_from_api', 'product_type', 'product_status',
            'barcode', 'product_image', 
            'quantity', 'unit_price', 'subtotal', 'tax', 'total',
            'return_condition', 'replacement_product',
            # Phase 2 — WC product linking flags
            'is_linked', 'unlinked_reason',
        ]

    def get_product_image(self, obj):
        """Get product image URL if product exists, otherwise return empty string."""
        if obj.product and hasattr(obj.product, 'image_url'):
            return obj.product.image_url
        return None


class OrderLineInputSerializer(serializers.Serializer):
    """Input shape for a single line item (mirrors WooCommerce line_items[] structure)."""
    product_id       = serializers.IntegerField(required=False, help_text='WC product id')
    local_product_id = serializers.IntegerField(required=False, help_text='Local product pk')
    sku              = serializers.CharField(required=False, allow_blank=True, default='')
    name             = serializers.CharField(required=False, allow_blank=True, default='')
    quantity         = serializers.IntegerField(min_value=1, default=1)
    price            = serializers.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    subtotal         = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    total_tax        = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    total            = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)


# ═════════════════════════════════════════════════════════════════════════════
# BILLING / SHIPPING helpers
# ═════════════════════════════════════════════════════════════════════════════

class BillingSerializer(serializers.Serializer):
    """Mirrors WooCommerce billing object."""
    first_name  = serializers.CharField(required=False, allow_blank=True, default='')
    last_name   = serializers.CharField(required=False, allow_blank=True, default='')
    company     = serializers.CharField(required=False, allow_blank=True, default='')
    email       = serializers.EmailField(required=False, allow_blank=True, default='')
    phone       = serializers.CharField(required=False, allow_blank=True, default='')
    address_1   = serializers.CharField(required=False, allow_blank=True, default='')
    address_2   = serializers.CharField(required=False, allow_blank=True, default='')
    city        = serializers.CharField(required=False, allow_blank=True, default='')
    state       = serializers.CharField(required=False, allow_blank=True, default='')
    postcode    = serializers.CharField(required=False, allow_blank=True, default='')
    country     = serializers.CharField(required=False, allow_blank=True, default='TN')
    customer_id = serializers.IntegerField(required=False)


# ═════════════════════════════════════════════════════════════════════════════
# ORDER – List / Detail
# ═════════════════════════════════════════════════════════════════════════════

class OrderListSerializer(serializers.ModelSerializer):
    """Compact list view — no lines, no raw payload."""
    company_name      = serializers.CharField(source='company.name', read_only=True)
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    pos_sales_channel_name = serializers.CharField(source='pos_sales_channel.name', read_only=True, default=None)
    pos_sales_channel_code = serializers.CharField(source='pos_sales_channel.code', read_only=True, default=None)
    brand             = serializers.IntegerField(source='brand_id', read_only=True)
    brand_name        = serializers.CharField(source='brand.name', read_only=True, default=None)
    client_id         = serializers.IntegerField(read_only=True)
    client_email      = serializers.CharField(source='client.email', read_only=True, default=None)
    client_phone      = serializers.CharField(source='client.phone', read_only=True, default=None)
    client_name       = serializers.SerializerMethodField()
    client_points     = serializers.IntegerField(source='client.points', read_only=True, default=0)
    client_is_blocked = serializers.BooleanField(source='client.is_blocked', read_only=True, default=False)
    client_return_count = serializers.IntegerField(source='client.number_of_returns', read_only=True, default=0)
    line_count        = serializers.SerializerMethodField()
    lifecycle_priority = serializers.SerializerMethodField()
    edit_locked_by_name = serializers.CharField(
        source='edit_locked_by.get_full_name', read_only=True, default=None,
    )
    packaged_by_name = serializers.CharField(
        source='packaged_by.get_full_name', read_only=True, default=None,
    )
    # Phase B/C/D — clean derived top-layer status, with human-readable labels.
    # These are persisted-but-derived (lifecycle service is the only writer); the
    # serializer exposes them read-only so the UI reads one clean status set.
    order_status_display = serializers.CharField(
        source='get_order_status_display', read_only=True,
    )
    confirmation_status_display = serializers.CharField(
        source='get_confirmation_status_display', read_only=True,
    )
    delivery_method_display = serializers.CharField(
        source='get_delivery_method_display', read_only=True,
    )
    stock_status_display = serializers.CharField(
        source='get_stock_status_display', read_only=True,
    )
    priority_level_display = serializers.CharField(
        source='get_priority_level_display', read_only=True,
    )
    sync_status_display = serializers.CharField(
        source='get_sync_status_display', read_only=True,
    )
    order_source_display = serializers.CharField(
        source='get_order_source_display', read_only=True,
    )

    class Meta:
        model  = Order
        fields = [
            'id', 'order_number', 'ticket_id', 'client_ticket_uuid',
            'external_order_id', 'wc_order_key',
            'company', 'company_name',
            'sales_channel', 'sales_channel_name',
            'brand', 'brand_name',
            'client', 'client_id', 'client_email', 'client_phone', 'client_name',
            'client_points', 'client_is_blocked', 'client_return_count',
            'status', 'wc_status', 'source', 'order_source', 'order_source_display',
            'payment_status', 'payment_method',
            'contact_status', 'return_exchange_status',
            'return_type', 'packaging_status', 'packaged_at', 'packaged_by',
            'packaged_by_name', 'final_outcome',
            # Phase 2 — unified workflow + auto-cancel + loyalty
            'workflow_status',
            'not_answered_at', 'not_answered_attempts',
            'auto_cancelled_at', 'auto_cancel_reason',
            'loyalty_points_granted', 'loyalty_points_granted_at', 'loyalty_points_amount',
            'billing_phone',
            'currency', 'subtotal', 'tax_total', 'shipping_total',
            'discount_type', 'discount_value', 'discount_total', 'total',
            'is_deleted', 'line_count',
            # Outcome fields
            'outcome', 'confirmed_at', 'delay_date', 'delay_reason',
            'cancellation_reason', 'outcome_note', 'outcome_changed_at',
            # Delivery fields (compact — no full response body)
            'delivery_status', 'delivery_reference', 'delivery_submitted_at',
            'delivery_code', 'delivery_external_reference', 'delivery_status_id',
            'delivery_order_id', 'delivery_client_id', 'delivery_cod_amount',
            'delivery_submitted_by', 'delivery_attempts',
            # POS / return / soft delete audit fields
            'in_store_pickup', 'pos_sales_channel', 'pos_sales_channel_name',
            'pos_sales_channel_code', 'sent_to_pos_at', 'sent_to_pos_by',
            'pos_validated_at', 'pos_validated_by',
            'returned_at', 'returned_by', 'return_reason',
            'stock_restored_at', 'stock_restored_by',
            'delete_reason', 'lifecycle_priority',
            'edit_locked_by', 'edit_locked_by_name', 'edit_locked_at',
            'edit_lock_heartbeat_at', 'edit_lock_expires_at', 'edit_lock_token',
            # Sync
            'synced_at',
            # Phase B/C/D — clean derived top-layer status (the single status
            # set the UI reads). Read-only: written only by the lifecycle service.
            'order_status', 'order_status_display',
            'confirmation_status', 'confirmation_status_display',
            'delivery_method', 'delivery_method_display',
            'stock_status', 'stock_status_display',
            'priority_level', 'priority_level_display',
            'sync_status', 'sync_status_display',
            'sync_error_message', 'last_sync_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            # Derived fields must never be set through the API — the lifecycle
            # service is the only writer. Guards against future writable subclasses.
            'order_status', 'confirmation_status', 'delivery_method',
            'stock_status', 'priority_level', 'sync_status',
            'sync_error_message', 'last_sync_at',
        ]

    @staticmethod
    def get_client_name(obj):
        if obj.client:
            return obj.client.full_name
        return None

    @staticmethod
    def get_line_count(obj):
        annotated = getattr(obj, 'line_count', None)
        if annotated is not None:
            return annotated
        return obj.lines.filter(is_deleted=False).count()

    @staticmethod
    def get_lifecycle_priority(obj):
        return getattr(obj, 'lifecycle_priority', None)


class OrderDetailSerializer(OrderListSerializer):
    """Full detail with lines, addresses, notes, delivery response, and raw payload."""
    lines            = serializers.SerializerMethodField()
    customer_lines   = serializers.SerializerMethodField()
    packaging_lines  = serializers.SerializerMethodField()
    created_by_name  = serializers.CharField(
        source='created_by.get_full_name', read_only=True, default=None,
    )
    billing_address  = serializers.SerializerMethodField()
    shipping_address = serializers.SerializerMethodField()
    stock_check      = serializers.SerializerMethodField()
    stock_by_channel = serializers.SerializerMethodField()

    class Meta(OrderListSerializer.Meta):
        fields = OrderListSerializer.Meta.fields + [
            'lines',
            'customer_lines', 'packaging_lines',
            # Billing flat columns
            'billing_first_name', 'billing_last_name', 'billing_company',
            'billing_email', 'billing_phone', 'billing_address_1', 'billing_address_2',
            'billing_city', 'billing_state', 'billing_postcode', 'billing_country',
            # Shipping flat columns
            'shipping_first_name', 'shipping_last_name',
            'shipping_address_1', 'shipping_city',
            'shipping_state', 'shipping_postcode', 'shipping_country',
            # Computed address dicts
            'billing_address', 'shipping_address',
            # Notes
            'customer_note', 'internal_note',
            # WooCommerce metadata
            'wc_date_created', 'wc_date_modified',
            'wc_meta_data',
            # Delivery full detail
            'delivery_response',
            'stock_check',
            'stock_by_channel',
            # Audit
            'created_by', 'created_by_name',
            'deleted_at', 'deleted_by',
        ]

    def get_lines(self, obj):
        lines_qs = obj.lines.filter(is_deleted=False).select_related('product')
        return OrderLineSerializer(lines_qs, many=True).data

    def get_customer_lines(self, obj):
        lines_qs = (
            obj.lines
            .filter(is_deleted=False)
            .exclude(product__product_type=Product.ProductType.PACKAGING_ITEM)
            .select_related('product')
        )
        return OrderLineSerializer(lines_qs, many=True).data

    def get_packaging_lines(self, obj):
        lines_qs = (
            obj.lines
            .filter(is_deleted=False, product__product_type=Product.ProductType.PACKAGING_ITEM)
            .select_related('product')
        )
        return OrderLineSerializer(lines_qs, many=True).data

    def get_billing_address(self, obj):
        return {
            'first_name': obj.billing_first_name,
            'last_name':  obj.billing_last_name,
            'company':    obj.billing_company,
            'email':      obj.billing_email,
            'phone':      obj.billing_phone,
            'address_1':  obj.billing_address_1,
            'address_2':  obj.billing_address_2,
            'city':       obj.billing_city,
            'state':      obj.billing_state,
            'postcode':   obj.billing_postcode,
            'country':    obj.billing_country,
        }

    def get_shipping_address(self, obj):
        return {
            'first_name': obj.shipping_first_name,
            'last_name':  obj.shipping_last_name,
            'address_1':  obj.shipping_address_1,
            'city':       obj.shipping_city,
            'state':      obj.shipping_state,
            'postcode':   obj.shipping_postcode,
            'country':    obj.shipping_country,
        }

    def get_stock_check(self, obj):
        from .stock_service import OrderStockAvailabilityService

        return OrderStockAvailabilityService.build(obj)

    def get_stock_by_channel(self, obj):
        from .stock_service import OrderStockAvailabilityService

        return OrderStockAvailabilityService.channel_breakdown(obj)


class OrderPickupSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default='')


class OrderSendToPOSSerializer(serializers.Serializer):
    pos_sales_channel = serializers.PrimaryKeyRelatedField(queryset=SalesChannel.objects.all())


class PackagingItemSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class OrderPackagingSerializer(serializers.Serializer):
    packaging_items = PackagingItemSerializer(many=True, min_length=1)
    allow_update = serializers.BooleanField(required=False, default=False)


class ReturnLineConditionSerializer(serializers.Serializer):
    line_id = serializers.IntegerField(min_value=1)
    condition = serializers.ChoiceField(choices=OrderLine.ReturnCondition.choices)
    replacement_product_id = serializers.IntegerField(min_value=1, required=False)


class OrderReturnSerializer(serializers.Serializer):
    return_reason = serializers.CharField(required=False, allow_blank=True, default='')
    return_type = serializers.ChoiceField(
        choices=Order.ReturnType.choices,
        required=False,
        default=Order.ReturnType.RETURNED,
    )
    line_conditions = ReturnLineConditionSerializer(
        many=True,
        required=False,
        default=list,
    )


class OrderReturnLookupSerializer(serializers.Serializer):
    query = serializers.CharField(min_length=1, max_length=255)


class OrderPOSCheckoutSerializer(serializers.Serializer):
    """Optional checkout details captured when validating a pickup order in POS."""
    payment_method = serializers.CharField(required=False, allow_blank=True, default='cash')
    payment_method_title = serializers.CharField(required=False, allow_blank=True, default='Cash')
    customer_note = serializers.CharField(required=False, allow_blank=True, default='')


# ═════════════════════════════════════════════════════════════════════════════
# POS / Manual creation
# ═════════════════════════════════════════════════════════════════════════════

class POSOrderCreateSerializer(serializers.Serializer):
    sales_channel        = serializers.PrimaryKeyRelatedField(queryset=SalesChannel.objects.all())
    ticket_id            = serializers.CharField(required=False, allow_blank=True, max_length=80)
    client_ticket_uuid   = serializers.CharField(required=False, allow_blank=True, max_length=64)
    client               = serializers.PrimaryKeyRelatedField(
        queryset=Client.objects.all(), required=False, allow_null=True,
    )
    billing              = BillingSerializer(required=False)
    line_items           = OrderLineInputSerializer(many=True, min_length=1)
    payment_method       = serializers.CharField(required=False, allow_blank=True, default='cash')
    payment_method_title = serializers.CharField(required=False, allow_blank=True, default='Cash')
    customer_note        = serializers.CharField(required=False, allow_blank=True, default='')
    status               = serializers.ChoiceField(
        choices=['pending', 'processing', 'completed'], default='completed',
    )
    discount_type  = serializers.ChoiceField(
        choices=Order.DiscountType.choices, default=Order.DiscountType.NONE,
        required=False,
    )
    discount_value = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, min_value=Decimal('0.00'),
    )
    subtotal       = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    total_tax      = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    shipping_total = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    discount_total = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    total          = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)


class ManualOrderCreateSerializer(POSOrderCreateSerializer):
    """Back-office (Order Manager) order creation — ``source=MANUAL``.

    Identical request shape to the POS serializer, but it represents an order
    an admin keys in by hand rather than a till sale, so the default workflow
    status is ``processing`` (a new order awaiting fulfilment) instead of
    ``completed``. The endpoint that consumes this serializer does NOT force
    ``outcome=CONFIRMED`` / ``payment_status=PAID`` / POS validation, leaving
    the POS checkout path untouched.
    """
    status = serializers.ChoiceField(
        choices=['pending', 'processing', 'completed'], default='processing',
    )
    order_source = serializers.ChoiceField(
        choices=Order.OrderSource.choices, required=False, allow_blank=True, default='',
    )


# ═════════════════════════════════════════════════════════════════════════════
# Status update
# ═════════════════════════════════════════════════════════════════════════════

class OrderStatusUpdateSerializer(serializers.Serializer):
    status        = serializers.ChoiceField(choices=Order.Status.choices, required=False)
    wc_status     = serializers.ChoiceField(
        choices=['pending', 'processing', 'completed', 'cancelled', 'refunded', 'failed', 'on-hold'],
        required=False,
    )
    delivery_status = serializers.ChoiceField(choices=Order.DeliveryStatus.choices, required=False)
    contact_status  = serializers.ChoiceField(choices=Order.ContactStatus.choices, required=False)
    outcome          = serializers.ChoiceField(choices=Order.Outcome.choices, required=False)
    return_exchange_status = serializers.ChoiceField(
        choices=Order.ReturnExchangeStatus.choices,
        required=False,
    )
    delay_date   = serializers.DateField(required=False, allow_null=True)
    delay_reason = serializers.CharField(required=False, allow_blank=True, default='')
    internal_note = serializers.CharField(required=False, allow_blank=True, default='')

    def validate(self, attrs):
        editable = {
            'status', 'wc_status', 'delivery_status', 'contact_status',
            'outcome', 'return_exchange_status', 'delay_date', 'delay_reason',
        }
        if not any(field in attrs for field in editable):
            raise serializers.ValidationError('At least one status field is required.')
        will_delay = (
            attrs.get('outcome') == Order.Outcome.DELAYED
            or attrs.get('contact_status') == Order.ContactStatus.DELAYED
        )
        if will_delay and not attrs.get('delay_date'):
            raise serializers.ValidationError({'delay_date': 'Delay date is required for delayed orders.'})
        return attrs


class OrderEditLockSerializer(serializers.Serializer):
    force = serializers.BooleanField(required=False, default=False)
    token = serializers.CharField(required=False, allow_blank=True, default='')


# ═════════════════════════════════════════════════════════════════════════════
# Order edit
# ═════════════════════════════════════════════════════════════════════════════

class OrderEditLineSerializer(serializers.Serializer):
    id           = serializers.IntegerField(required=False)
    product      = serializers.IntegerField(required=False, allow_null=True)
    product_name = serializers.CharField(required=False, allow_blank=False)
    barcode      = serializers.CharField(required=False, allow_blank=True, default='')
    quantity     = serializers.IntegerField(min_value=1)
    unit_price   = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal('0.00'),
    )


class OrderEditSerializer(serializers.Serializer):
    lines          = OrderEditLineSerializer(many=True, min_length=1)
    discount_type  = serializers.ChoiceField(choices=Order.DiscountType.choices, required=False)
    discount_value = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, min_value=Decimal('0.00'),
    )
    customer_note = serializers.CharField(required=False, allow_blank=True)
    internal_note = serializers.CharField(required=False, allow_blank=True)
    # Billing fields (editable)
    billing_first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    billing_last_name  = serializers.CharField(required=False, allow_blank=True, max_length=150)
    billing_company    = serializers.CharField(required=False, allow_blank=True, max_length=255)
    billing_email      = serializers.EmailField(required=False, allow_blank=True)
    billing_phone      = serializers.CharField(required=False, allow_blank=True, max_length=30)
    billing_address_1  = serializers.CharField(required=False, allow_blank=True, max_length=255)
    billing_address_2  = serializers.CharField(required=False, allow_blank=True, max_length=255)
    billing_city       = serializers.CharField(required=False, allow_blank=True, max_length=100)
    billing_state      = serializers.CharField(required=False, allow_blank=True, max_length=100)
    billing_postcode   = serializers.CharField(required=False, allow_blank=True, max_length=20)
    billing_country    = serializers.CharField(required=False, allow_blank=True, max_length=5)


# ═════════════════════════════════════════════════════════════════════════════
# Order outcome actions (Confirm / Delay / Cancel)
# ═════════════════════════════════════════════════════════════════════════════

class OrderConfirmSerializer(serializers.Serializer):
    """Mark order as confirmed by staff."""
    note = serializers.CharField(required=False, allow_blank=True, default='')


class OrderDelaySerializer(serializers.Serializer):
    """Mark order as delayed — requires date and reason."""
    delay_date   = serializers.DateField(
        help_text='Expected follow-up or reschedule date',
    )
    delay_reason = serializers.CharField(
        min_length=3, max_length=1000,
        help_text='Why the order is being delayed',
    )
    note = serializers.CharField(required=False, allow_blank=True, default='')


class OrderCancelOutcomeSerializer(serializers.Serializer):
    """
    Mark order outcome as cancelled — requires reason.
    Named differently from OrderStatusUpdateSerializer to avoid confusion:
    this sets outcome=CANCELLED, NOT status=CANCELLED.
    """
    cancellation_reason = serializers.CharField(
        min_length=3, max_length=1000,
        help_text='Why the order is being cancelled',
    )
    note = serializers.CharField(required=False, allow_blank=True, default='')


class ManualTransitionSerializer(serializers.Serializer):
    """Admin/manager-only backward override of the clean ``order_status``.

    ``target`` is one of the documented backward moves (re-validated by the
    lifecycle service against the current derived status). ``reason`` is
    mandatory and written to the MANUAL_STATUS_OVERRIDE audit log.
    """
    target = serializers.ChoiceField(choices=Order.OrderStatus.choices)
    reason = serializers.CharField(
        min_length=3, max_length=1000,
        help_text='Why the status is being manually rolled back (audited).',
    )


# ═════════════════════════════════════════════════════════════════════════════
# Delivery status update (from provider webhook or manual)
# ═════════════════════════════════════════════════════════════════════════════

class DeliveryStatusUpdateSerializer(serializers.Serializer):
    """Used by provider webhook callback or manual staff action."""
    delivery_status    = serializers.ChoiceField(choices=Order.DeliveryStatus.choices)
    delivery_reference = serializers.CharField(required=False, allow_blank=True)
    provider_response  = serializers.JSONField(required=False, default=dict)
    note               = serializers.CharField(required=False, allow_blank=True)


# ═════════════════════════════════════════════════════════════════════════════
# Order Sync Event
# ═════════════════════════════════════════════════════════════════════════════

class OrderSyncEventSerializer(serializers.ModelSerializer):
    sales_channel_name = serializers.CharField(source='sales_channel.name', read_only=True)
    triggered_by_name  = serializers.CharField(
        source='triggered_by.get_full_name', read_only=True, default=None,
    )
    duration_seconds   = serializers.FloatField(read_only=True)

    class Meta:
        model  = OrderSyncEvent
        fields = [
            'id', 'sales_channel', 'sales_channel_name', 'company',
            'triggered_by', 'triggered_by_name',
            'status', 'trigger_source',
            'sync_from', 'sync_to', 'wc_statuses_synced',
            'fetched_count', 'created_count', 'updated_count', 'error_count',
            'error_detail',
            'started_at', 'finished_at', 'duration_seconds',
        ]
        read_only_fields = fields


# ═════════════════════════════════════════════════════════════════════════════
# Audit log
# ═════════════════════════════════════════════════════════════════════════════

class OrderLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True, default=None)
    action_display = serializers.CharField(source='get_action_display', read_only=True)

    class Meta:
        model  = OrderLog
        fields = ['id', 'action', 'action_display', 'user', 'user_name', 'details', 'created_at']
