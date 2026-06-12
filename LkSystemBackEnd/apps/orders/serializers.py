"""
LkSystem Orders App - Serializers
"""

from decimal import Decimal
from rest_framework import serializers
from django.utils import timezone
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
    catalog_unit_price = serializers.DecimalField(
        source='product.sales_price',
        max_digits=12,
        decimal_places=2,
        read_only=True,
        allow_null=True,
        default=None,
    )
    product_type = serializers.CharField(source='product.product_type', read_only=True, default=None)
    product_status = serializers.CharField(source='product.get_status_display', read_only=True, default=None)
    is_pack = serializers.BooleanField(source='product.is_pack', read_only=True, default=False)
    pack_items_detail = serializers.SerializerMethodField()
    product_image = serializers.SerializerMethodField()

    class Meta:
        model = OrderLine
        fields = [
            'id', 'product', 'product_id', 'external_line_id', 'wc_product_id', 
            'product_name', 'product_name_from_api', 'product_type', 'product_status',
            'barcode', 'product_image', 'is_pack', 'pack_items_detail',
            'quantity', 'catalog_unit_price', 'unit_price', 'subtotal', 'tax', 'total',
            'return_condition', 'replacement_product',
            # Phase 2 — WC product linking flags
            'is_linked', 'unlinked_reason',
        ]

    def get_product_image(self, obj):
        """Get product image URL if product exists, otherwise return empty string."""
        if obj.product and hasattr(obj.product, 'image_url'):
            return obj.product.image_url
        return None

    def get_pack_items_detail(self, obj):
        """Expose the component snapshot needed to classify a pack return."""
        product = obj.product
        if not product or not product.is_pack or not product.pack_items:
            return None

        component_ids = []
        for item in product.pack_items:
            if not isinstance(item, dict):
                continue
            try:
                component_ids.append(int(item.get('product_id')))
            except (TypeError, ValueError):
                continue
        components = {
            component.id: component
            for component in Product.all_objects.filter(id__in=component_ids)
        }

        details = []
        for item in product.pack_items:
            if not isinstance(item, dict):
                continue
            try:
                component_id = int(item.get('product_id'))
                quantity = int(item.get('quantity'))
            except (TypeError, ValueError):
                continue
            component = components.get(component_id)
            details.append({
                'product_id': component_id,
                'quantity': quantity,
                'product_name': component.name if component else '(deleted product)',
                'product_image': component.image_url if component else '',
                'product_barcode': component.barcode if component else '',
            })
        return details


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
    client_email      = serializers.SerializerMethodField()
    client_phone      = serializers.SerializerMethodField()
    client_matricule_fiscale = serializers.CharField(
        source='client.matricule_fiscale', read_only=True, default='',
    )
    client_type       = serializers.CharField(
        source='client.client_type', read_only=True, default='PERSON',
    )
    client_name       = serializers.SerializerMethodField()
    # Delivery contact — who actually receives the parcel (shipping block first,
    # billing snapshot fallback; see the Order model properties). The orders
    # list displays and searches THESE, never the linked Client record, because
    # customers change the recipient name/phone/address per order.
    delivery_name     = serializers.ReadOnlyField()
    delivery_phone    = serializers.ReadOnlyField()
    delivery_address  = serializers.ReadOnlyField()
    client_points     = serializers.IntegerField(source='client.points', read_only=True, default=0)
    client_is_blocked = serializers.BooleanField(source='client.is_blocked', read_only=True, default=False)
    client_return_count = serializers.IntegerField(source='client.number_of_returns', read_only=True, default=0)
    client_order_count = serializers.IntegerField(source='client.number_of_orders', read_only=True, default=0)
    line_count        = serializers.SerializerMethodField()
    lifecycle_priority = serializers.SerializerMethodField()
    edit_locked_by_name = serializers.CharField(
        source='edit_locked_by.get_full_name', read_only=True, default=None,
    )
    packaged_by_name = serializers.CharField(
        source='packaged_by.get_full_name', read_only=True, default=None,
    )
    # THE canonical lifecycle status (read-only — written only through
    # OrderStatusService.transition()).
    status_display = serializers.CharField(
        source='get_status_display', read_only=True,
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
            'id', 'order_number', 'invoice_number', 'ticket_id', 'client_ticket_uuid',
            'invoice_date', 'invoice_client_name', 'invoice_client_type',
            'invoice_client_matricule_fiscale', 'invoice_client_phone',
            'invoice_client_email', 'invoice_client_address', 'invoice_client_city',
            'invoice_issued_at', 'invoice_issued_by',
            'external_order_id', 'wc_order_key',
            'company', 'company_name',
            'sales_channel', 'sales_channel_name',
            'brand', 'brand_name',
            'client', 'client_id', 'client_email', 'client_phone', 'client_name',
            'client_type', 'client_matricule_fiscale',
            'delivery_name', 'delivery_phone', 'delivery_address',
            'client_points', 'client_is_blocked', 'client_return_count',
            'client_order_count',
            # THE canonical lifecycle status + audit
            'status', 'status_display', 'status_changed_at', 'status_changed_by',
            'wc_status', 'source', 'order_source', 'order_source_display',
            'payment_status', 'payment_method',
            'return_type', 'packaged_at', 'packaged_by',
            'packaged_by_name',
            'not_answered_at', 'not_answered_attempts',
            'auto_cancelled_at', 'auto_cancel_reason',
            'loyalty_points_granted', 'loyalty_points_granted_at', 'loyalty_points_amount',
            'billing_phone',
            'currency', 'subtotal', 'tax_total', 'shipping_total', 'delivery_fee',
            'discount_type', 'discount_value', 'discount_total', 'total',
            'is_deleted', 'line_count',
            # Confirmation / delay / cancel metadata (audit only)
            'confirmed_at', 'delay_date', 'delay_reason',
            'cancellation_reason', 'outcome_note', 'outcome_changed_at',
            # Delivery fields (technical metadata — compact, no response body)
            'delivery_reference', 'delivery_submitted_at',
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
            # Derived informational fields (never lifecycle)
            'delivery_method', 'delivery_method_display',
            'stock_status', 'stock_status_display',
            'priority_level', 'priority_level_display',
            'sync_status', 'sync_status_display',
            'sync_error_message', 'last_sync_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            # The lifecycle status and derived fields must never be set through
            # the API — OrderStatusService / the lifecycle service own them.
            'status', 'status_changed_at', 'status_changed_by',
            'delivery_method', 'stock_status', 'priority_level', 'sync_status',
            'sync_error_message', 'last_sync_at',
        ]

    @staticmethod
    def get_client_name(obj):
        billing_name = f'{obj.billing_first_name} {obj.billing_last_name}'.strip()
        if billing_name:
            return billing_name
        if obj.client:
            return obj.client.full_name
        return None

    @staticmethod
    def get_client_email(obj):
        if obj.billing_email:
            return obj.billing_email
        return obj.client.email if obj.client else None

    @staticmethod
    def get_client_phone(obj):
        if obj.billing_phone:
            return obj.billing_phone
        return obj.client.phone if obj.client else None

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
            'shipping_first_name', 'shipping_last_name', 'shipping_phone',
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
            'phone':      obj.shipping_phone,
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


class InvoiceListSerializer(serializers.ModelSerializer):
    """Compact invoice registry row backed directly by the Order table."""

    company_name = serializers.CharField(source='company.name', read_only=True)
    brand = serializers.IntegerField(source='brand_id', read_only=True)
    brand_name = serializers.CharField(source='brand.name', read_only=True, default=None)
    client_id = serializers.IntegerField(read_only=True)
    client_name = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            'id', 'invoice_number', 'invoice_date', 'order_number',
            'company', 'company_name', 'brand', 'brand_name',
            'client_id', 'client_name', 'phone',
            'source', 'payment_status', 'currency', 'total',
            'invoice_issued_at', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    @staticmethod
    def get_client_name(obj):
        return (
            obj.invoice_client_name
            or 'Walk-in customer'
        )

    @staticmethod
    def get_phone(obj):
        return obj.invoice_client_phone


class InvoiceMutationSerializer(serializers.Serializer):
    invoice_number = serializers.RegexField(
        regex=r'^\d{4}/\d+$',
        max_length=32,
        required=False,
        help_text='Invoice number in year/number format, for example 2026/001.',
    )
    invoice_date = serializers.DateField(required=False)
    invoice_client_name = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
    )
    invoice_client_type = serializers.ChoiceField(
        choices=['PERSON', 'COMPANY'],
        required=False,
    )
    invoice_client_matricule_fiscale = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
    )
    invoice_client_phone = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
    )
    invoice_client_email = serializers.EmailField(required=False, allow_blank=True)
    invoice_client_address = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
    )
    invoice_client_city = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
    )

    def validate_invoice_number(self, value):
        year, serial = value.split('/', 1)
        if int(year) < 2000 or int(serial) < 1:
            raise serializers.ValidationError('Invoice year must be valid and the serial must be at least 1.')
        return f'{year}/{int(serial):03d}'

    def validate(self, attrs):
        order = self.context['order']
        invoice_date = attrs.get('invoice_date') or order.invoice_date or timezone.localdate()
        invoice_number = attrs.get('invoice_number') or order.invoice_number
        if invoice_number and int(invoice_number.split('/', 1)[0]) != invoice_date.year:
            raise serializers.ValidationError({
                'invoice_number': 'The invoice number year must match the invoice date year.',
            })
        return attrs


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


class ReturnComponentConditionSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)
    condition = serializers.ChoiceField(choices=[
        OrderLine.ReturnCondition.GOOD,
        OrderLine.ReturnCondition.DAMAGED,
        OrderLine.ReturnCondition.MISSING,
    ])


class ReturnLineConditionSerializer(serializers.Serializer):
    line_id = serializers.IntegerField(min_value=1)
    condition = serializers.ChoiceField(choices=OrderLine.ReturnCondition.choices)
    replacement_product_id = serializers.IntegerField(min_value=1, required=False)
    component_conditions = ReturnComponentConditionSerializer(
        many=True,
        required=False,
        default=list,
    )

    def validate(self, attrs):
        if (
            attrs.get('component_conditions')
            and attrs.get('condition') == OrderLine.ReturnCondition.EXCHANGED
        ):
            raise serializers.ValidationError({
                'component_conditions': (
                    'Component-level conditions are not supported for exchanges.'
                ),
            })
        return attrs


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
    delivery_fee   = serializers.DecimalField(
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

class OrderTransitionSerializer(serializers.Serializer):
    """POST /orders/{id}/transition/ — THE lifecycle move payload."""
    status = serializers.ChoiceField(choices=Order.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, default='')
    # delayed needs a follow-up date; canceled/returned accept a reason.
    delay_date = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True, default='')


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
    # Editable flat delivery fee (rolled into the order total on recalc). 0 = no
    # fee. Absent → left unchanged.
    delivery_fee   = serializers.DecimalField(
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
    # Shipping / delivery fields (editable) — where the order is delivered.
    shipping_first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    shipping_last_name  = serializers.CharField(required=False, allow_blank=True, max_length=150)
    shipping_phone      = serializers.CharField(required=False, allow_blank=True, max_length=30)
    shipping_address_1  = serializers.CharField(required=False, allow_blank=True, max_length=255)
    shipping_city       = serializers.CharField(required=False, allow_blank=True, max_length=100)
    shipping_state      = serializers.CharField(required=False, allow_blank=True, max_length=100)
    shipping_postcode   = serializers.CharField(required=False, allow_blank=True, max_length=20)
    shipping_country    = serializers.CharField(required=False, allow_blank=True, max_length=5)


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
    """Admin/manager-only backward override of the canonical ``status``.

    ``target`` is one of the documented backward moves (re-validated by the
    lifecycle service against the current derived status). ``reason`` is
    mandatory and written to the MANUAL_STATUS_OVERRIDE audit log.
    """
    target = serializers.ChoiceField(choices=Order.Status.choices)
    reason = serializers.CharField(
        min_length=3, max_length=1000,
        help_text='Why the status is being manually rolled back (audited).',
    )


# ═════════════════════════════════════════════════════════════════════════════
# Delivery status update (from provider webhook or manual)
# ═════════════════════════════════════════════════════════════════════════════

class DeliveryStatusUpdateSerializer(serializers.Serializer):
    """Used by provider webhook callback or manual staff action."""
    delivery_status    = serializers.CharField(max_length=40)
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
