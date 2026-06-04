"""
LkSystem Orders App - Models
═══════════════════════════════════════════════════════════════════════════════
Order, OrderLine, OrderLog, OrderSyncEvent entities.

Every query MUST be scoped by company (tenant_id) for multi-tenant isolation.

Changelog (v2):
  • Order – added wc_order_key, raw_wc_payload, wc_meta_data, synced_at
  • Order – added DeliveryStatus + delivery tracking fields
  • OrderLog – extended Action choices to cover sync & delivery events
  • OrderSyncEvent – new model; one row per sync run per channel
"""

import random
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.core.exceptions import ValidationError
from django.utils import timezone


# ─── managers ────────────────────────────────────────────────────────────────

class ActiveOrderManager(models.Manager):
    """Default manager that hides soft-deleted orders."""
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class ActiveOrderLineManager(models.Manager):
    """Default manager that hides soft-deleted order lines."""
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


# ═════════════════════════════════════════════════════════════════════════════
# ORDER
# ═════════════════════════════════════════════════════════════════════════════

class Order(models.Model):
    """
    Header-level representation of a sales order.

    Sources:
      • WOOCOMMERCE  – ingested via REST API poll or webhook
      • POS          – created by cashier in the POS UI
      • MANUAL       – entered manually by staff

    Delivery lifecycle (separate from order status):
      PENDING → QUEUED → SUBMITTED → ACCEPTED → IN_TRANSIT → DELIVERED
                                  └→ FAILED (retry possible)
                                  └→ CANCELLED
                                  └→ RETURNED
    """

    # ── Order Status ─────────────────────────────────────────────────────────
    class Status(models.TextChoices):
        PENDING    = 'PENDING',    'Pending'
        PROCESSING = 'PROCESSING', 'Processing'
        ON_HOLD    = 'ON_HOLD',    'On Hold'
        COMPLETED  = 'COMPLETED',  'Completed'
        CANCELLED  = 'CANCELLED',  'Cancelled'
        REFUNDED   = 'REFUNDED',   'Refunded'
        FAILED     = 'FAILED',     'Failed'

    # ── Source ───────────────────────────────────────────────────────────────
    class Source(models.TextChoices):
        WOOCOMMERCE = 'WOOCOMMERCE', 'WooCommerce'
        POS         = 'POS',         'Point of Sale'
        MANUAL      = 'MANUAL',      'Manual Entry'

    # ── Payment Status ───────────────────────────────────────────────────────
    class PaymentStatus(models.TextChoices):
        UNPAID   = 'UNPAID',   'Unpaid'
        PAID     = 'PAID',     'Paid'
        PARTIAL  = 'PARTIAL',  'Partially Paid'
        REFUNDED = 'REFUNDED', 'Refunded'

    # ── Discount Type ────────────────────────────────────────────────────────
    class DiscountType(models.TextChoices):
        NONE       = 'NONE',       'No Discount'
        FIXED      = 'FIXED',      'Fixed Amount'
        PERCENTAGE = 'PERCENTAGE', 'Percentage'

    # ── Order Outcome ─────────────────────────────────────────────────────────
    class Outcome(models.TextChoices):
        NONE      = 'NONE',      'No Outcome'
        CONFIRMED = 'CONFIRMED', 'Confirmed'
        DELAYED   = 'DELAYED',   'Delayed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    # ── Customer contact state ───────────────────────────────────────────────
    class ContactStatus(models.TextChoices):
        NONE         = 'NONE',         'Not Contacted'
        ANSWERED     = 'ANSWERED',     'Answered'
        NOT_ANSWERED = 'NOT_ANSWERED', 'Not Answered'
        DELAYED      = 'DELAYED',      'Delayed'

    # ── Delivery Status ──────────────────────────────────────────────────────
    class DeliveryStatus(models.TextChoices):
        NONE       = 'NONE',       'Not Applicable'
        PENDING    = 'PENDING',    'Pending Submission'
        QUEUED     = 'QUEUED',     'Queued for Delivery'
        SUBMITTED  = 'SUBMITTED',  'Submitted to Provider'
        ACCEPTED   = 'ACCEPTED',   'Accepted by Provider'
        IN_TRANSIT = 'IN_TRANSIT', 'In Transit'
        DELIVERED  = 'DELIVERED',  'Delivered'
        FAILED     = 'FAILED',     'Delivery Failed'
        CANCELLED  = 'CANCELLED',  'Delivery Cancelled'
        RETURNED   = 'RETURNED',   'Returned to Sender'

    # ── Return / exchange state ──────────────────────────────────────────────
    class ReturnExchangeStatus(models.TextChoices):
        NONE      = 'NONE',      'None'
        RETURNED  = 'RETURNED',  'Returned'
        EXCHANGED = 'EXCHANGED', 'Exchanged'

    # ── Packaging step (separate from POS validation) ────────────────────────
    class PackagingStatus(models.TextChoices):
        NOT_PACKAGED = 'NOT_PACKAGED', 'Not Packaged'
        PACKAGED     = 'PACKAGED',     'Packaged'
        UPDATED      = 'UPDATED',      'Packaging Updated'

    # ── Final terminal outcome (drives KPI counters) ─────────────────────────
    # `outcome` is the call/confirmation result; `final_outcome` is the
    # post-delivery sales result. These are intentionally distinct.
    class FinalOutcome(models.TextChoices):
        NONE                      = 'NONE',                      'Pending'
        SUCCESSFUL_SALE           = 'SUCCESSFUL_SALE',           'Successful Sale'
        RETURNED                  = 'RETURNED',                  'Returned'
        EXCHANGED                 = 'EXCHANGED',                 'Exchanged'
        CANCELLED_BEFORE_DELIVERY = 'CANCELLED_BEFORE_DELIVERY', 'Cancelled Before Delivery'
        CANCELLED_AFTER_DELIVERY  = 'CANCELLED_AFTER_DELIVERY',  'Cancelled After Delivery'
        FAILED_DELIVERY           = 'FAILED_DELIVERY',           'Failed Delivery'

    # ── Structured return classification ─────────────────────────────────────
    class ReturnType(models.TextChoices):
        NONE              = 'NONE',              'None'
        CANCELLED_REFUSED = 'CANCELLED_REFUSED', 'Cancelled / Refused at Door'
        RETURNED          = 'RETURNED',          'Returned'
        EXCHANGED         = 'EXCHANGED',         'Exchanged'
        DAMAGED           = 'DAMAGED',           'Damaged on Arrival'
        MISSING           = 'MISSING',           'Missing Product'
        OTHER             = 'OTHER',             'Other'

    # ── Unified workflow status (10-state derived field for the orders UI) ───
    # This is the single source of truth for the orders page tabs and the row
    # status badge. It is derived from the other status fields by the
    # lifecycle service — never written directly by API clients.
    class WorkflowStatus(models.TextChoices):
        PENDING          = 'pending',          'Pending'
        ANSWERED         = 'answered',         'Answered'
        NOT_ANSWERED     = 'not_answered',     'Not Answered'
        DELAYED          = 'delayed',          'Delayed'
        SENT_TO_DELIVERY = 'sent_to_delivery', 'Sent to Delivery'
        PACKAGING        = 'packaging',        'Packaging'
        DONE             = 'done',             'Done'
        RETOUR           = 'retour',           'Retour'
        CANCELLED        = 'cancelled',        'Cancelled'
        CHANGED          = 'changed',          'Changed'

    # ── NEW top-layer status enums (Phase B, additive) ───────────────────────
    # Back the clean public status fields the UI reads. Persisted-but-derived:
    # the lifecycle service is the only writer (see apps/orders/STATUS_MAP.md).
    class OrderStatus(models.TextChoices):
        NEW                   = 'new',                   'New'
        AWAITING_CONFIRMATION = 'awaiting_confirmation', 'Awaiting Confirmation'
        CONFIRMED             = 'confirmed',             'Confirmed'
        DELAYED               = 'delayed',               'Delayed'
        NOT_ANSWERED          = 'not_answered',          'Not Answered'
        CANCELED              = 'canceled',              'Canceled'
        PREPARING             = 'preparing',             'Preparing'
        DONE                  = 'done',                  'Done'
        RETURNED              = 'returned',              'Returned'
        EXCHANGED             = 'exchanged',             'Exchanged'

    class ConfirmationStatus(models.TextChoices):
        PENDING   = 'pending',   'Pending'
        ACCEPTED  = 'accepted',  'Accepted'
        DELAYED   = 'delayed',   'Delayed'
        CANCELED  = 'canceled',  'Canceled'
        NO_ANSWER = 'no_answer', 'No Answer'

    class DeliveryMethod(models.TextChoices):
        HOME_DELIVERY = 'home_delivery', 'Home Delivery'
        POS_PICKUP    = 'pos_pickup',    'POS Pickup'

    class StockStatus(models.TextChoices):
        IN_STOCK      = 'in_stock',      'In Stock'
        PARTIAL_STOCK = 'partial_stock', 'Partial Stock'
        OUT_OF_STOCK  = 'out_of_stock',  'Out of Stock'

    class PriorityLevel(models.TextChoices):
        HIGH   = 'high',   'High'
        MEDIUM = 'medium', 'Medium'
        LOW    = 'low',    'Low'

    # Push-sync state TO WooCommerce (distinct from OrderSyncEvent per-run history).
    class SyncStatus(models.TextChoices):
        IMPORTED     = 'imported',     'Imported'
        PENDING_SYNC = 'pending_sync', 'Pending Sync'
        SYNCING      = 'syncing',      'Syncing'
        SYNCED       = 'synced',       'Synced'
        SYNC_FAILED  = 'sync_failed',  'Sync Failed'

    # ── Tenant isolation ─────────────────────────────────────────────────────
    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='orders',
    )

    # ── Channel & Client ─────────────────────────────────────────────────────
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.PROTECT,
        related_name='orders',
    )
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='orders',
    )
    client = models.ForeignKey(
        'clients.Client',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders',
    )

    # ── Identity ─────────────────────────────────────────────────────────────
    order_number = models.CharField(max_length=50)
    ticket_id = models.CharField(
        max_length=80,
        blank=True,
        default='',
        help_text='Human-facing POS ticket identifier. Offline tickets can provide their own safe ID.',
        db_index=True,
    )
    client_ticket_uuid = models.CharField(
        max_length=64,
        blank=True,
        default='',
        help_text='Client-generated UUID used to idempotently sync offline POS tickets.',
        db_index=True,
    )
    external_order_id = models.CharField(
        max_length=100, blank=True, default='',
        help_text='WooCommerce numeric order ID',
    )
    wc_order_key = models.CharField(
        max_length=100, blank=True, default='',
        help_text='WooCommerce order_key (wc_xxxx…) — secondary idempotency check',
        db_index=True,
    )
    import_hash = models.CharField(
        max_length=64, blank=True, default='',
        help_text='Fallback idempotency hash for imports without an external ID',
        db_index=True,
    )

    # ── Status ───────────────────────────────────────────────────────────────
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING,
    )
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.MANUAL,
    )

    # ── Payment ──────────────────────────────────────────────────────────────
    payment_method = models.CharField(max_length=100, blank=True, default='')
    payment_status = models.CharField(
        max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID,
    )
    currency = models.CharField(max_length=5, default='TND')

    # ── Totals ───────────────────────────────────────────────────────────────
    subtotal       = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    tax_total      = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    shipping_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    discount_type  = models.CharField(
        max_length=20, choices=DiscountType.choices, default=DiscountType.NONE,
    )
    discount_value = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    discount_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total          = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    # ── Billing Address ───────────────────────────────────────────────────────
    billing_first_name = models.CharField(max_length=150, blank=True, default='')
    billing_last_name  = models.CharField(max_length=150, blank=True, default='')
    billing_company    = models.CharField(max_length=255, blank=True, default='')
    billing_email      = models.EmailField(blank=True, default='')
    billing_phone      = models.CharField(max_length=30, blank=True, default='')
    billing_address_1  = models.CharField(max_length=255, blank=True, default='')
    billing_address_2  = models.CharField(max_length=255, blank=True, default='')
    billing_city       = models.CharField(max_length=100, blank=True, default='')
    billing_state      = models.CharField(max_length=100, blank=True, default='')
    billing_postcode   = models.CharField(max_length=20, blank=True, default='')
    billing_country    = models.CharField(max_length=5, blank=True, default='TN')

    # ── Shipping Address ──────────────────────────────────────────────────────
    shipping_first_name = models.CharField(max_length=150, blank=True, default='')
    shipping_last_name  = models.CharField(max_length=150, blank=True, default='')
    shipping_address_1  = models.CharField(max_length=255, blank=True, default='')
    shipping_city       = models.CharField(max_length=100, blank=True, default='')
    shipping_state      = models.CharField(max_length=100, blank=True, default='')
    shipping_postcode   = models.CharField(max_length=20, blank=True, default='')
    shipping_country    = models.CharField(max_length=5, blank=True, default='TN')

    # ── Notes ─────────────────────────────────────────────────────────────────
    customer_note = models.TextField(blank=True, default='')
    internal_note = models.TextField(blank=True, default='')

    # ── WooCommerce metadata ──────────────────────────────────────────────────
    wc_date_created  = models.DateTimeField(null=True, blank=True)
    wc_date_modified = models.DateTimeField(null=True, blank=True)
    wc_status        = models.CharField(max_length=30, blank=True, default='',
                                        help_text='Raw WooCommerce status string')
    # Stores the WooCommerce meta_data array (includes _call_status, _call_delay,
    # _client_message, _delivery_status_log, and any custom plugin metadata)
    wc_meta_data = models.JSONField(
        default=dict, blank=True,
        help_text='Raw WooCommerce meta_data array, indexed by meta_key for fast lookup',
    )
    # Full raw payload from WooCommerce — enables replay and offline debugging
    raw_wc_payload = models.JSONField(
        null=True, blank=True,
        help_text='Raw JSON payload as received from WooCommerce REST API or webhook',
    )
    # Timestamp of the last successful sync from WooCommerce
    synced_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Last time this order was successfully synced from WooCommerce',
    )

    # ── Order Outcome (Confirmed / Delayed / Cancelled) ──────────────────────
    outcome = models.CharField(
        max_length=20,
        choices=Outcome.choices,
        default=Outcome.NONE,
        db_index=True,
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    delay_date   = models.DateField(
        null=True, blank=True,
        help_text='Expected follow-up or reschedule date when order is delayed',
    )
    delay_reason = models.TextField(blank=True, default='')
    cancellation_reason = models.TextField(blank=True, default='')
    outcome_note = models.TextField(
        blank=True, default='',
        help_text='Free-text note attached to confirm / delay / cancel action',
    )
    outcome_changed_at = models.DateTimeField(null=True, blank=True)
    outcome_changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='order_outcomes',
    )
    contact_status = models.CharField(
        max_length=20,
        choices=ContactStatus.choices,
        default=ContactStatus.NONE,
        db_index=True,
        help_text='Customer contact result, separate from WooCommerce/order/delivery statuses.',
    )

    # ── POS / pickup lifecycle ───────────────────────────────────────────────
    in_store_pickup = models.BooleanField(default=False, db_index=True)
    pos_sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='pos_routed_orders',
        help_text='POS location selected to fulfill this confirmed order',
    )
    sent_to_pos_at = models.DateTimeField(null=True, blank=True)
    sent_to_pos_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_sent_to_pos',
    )
    pos_validated_at = models.DateTimeField(null=True, blank=True)
    pos_validated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_pos_validated',
    )

    # ── Delivery tracking ─────────────────────────────────────────────────────
    delivery_status = models.CharField(
        max_length=20,
        choices=DeliveryStatus.choices,
        default=DeliveryStatus.NONE,
        db_index=True,
    )
    delivery_reference = models.CharField(
        max_length=100, blank=True, default='',
        help_text='External delivery provider reference number',
        db_index=True,
    )
    delivery_code = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Delivery provider parcel code, for example the JAX EAN/code',
        db_index=True,
    )
    delivery_external_reference = models.CharField(
        max_length=100, blank=True, default='',
        help_text='External reference echoed by the delivery provider',
        db_index=True,
    )
    delivery_status_id = models.PositiveIntegerField(null=True, blank=True)
    delivery_order_id = models.PositiveBigIntegerField(null=True, blank=True, db_index=True)
    delivery_client_id = models.PositiveBigIntegerField(null=True, blank=True)
    delivery_cod_amount = models.DecimalField(
        max_digits=14, decimal_places=3, null=True, blank=True,
    )
    delivery_submitted_at = models.DateTimeField(null=True, blank=True)
    delivery_submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_sent_to_delivery',
    )
    delivery_attempts     = models.PositiveSmallIntegerField(default=0)
    delivery_response     = models.JSONField(
        null=True, blank=True,
        help_text='Last response from the delivery provider API',
    )

    # ── Return / stock restoration lifecycle ─────────────────────────────────
    returned_at = models.DateTimeField(null=True, blank=True)
    returned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_marked_returned',
    )
    return_reason = models.TextField(blank=True, default='')
    stock_restored_at = models.DateTimeField(null=True, blank=True)
    stock_restored_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_stock_restored',
    )
    # True while this order holds a stock reservation (reserved at confirm for
    # online / manual-delivery orders, released at completion or cancellation).
    # Idempotency flag for OrderStockReservationService.reserve/release.
    stock_reserved = models.BooleanField(default=False, db_index=True)
    return_exchange_status = models.CharField(
        max_length=20,
        choices=ReturnExchangeStatus.choices,
        default=ReturnExchangeStatus.NONE,
        db_index=True,
        help_text='Explicit return/exchange state used for reporting and counters.',
    )
    return_type = models.CharField(
        max_length=24,
        choices=ReturnType.choices,
        default=ReturnType.NONE,
        help_text='Structured return classification, drives stock-restoration rules.',
    )

    # ── Packaging step ───────────────────────────────────────────────────────
    packaging_status = models.CharField(
        max_length=24,
        choices=PackagingStatus.choices,
        default=PackagingStatus.NOT_PACKAGED,
        db_index=True,
        help_text='Tracks the packaging operator step (separate from POS validation).',
    )
    packaged_at = models.DateTimeField(null=True, blank=True)
    packaged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_packaged',
    )

    # ── Final outcome (KPI source of truth) ──────────────────────────────────
    final_outcome = models.CharField(
        max_length=32,
        choices=FinalOutcome.choices,
        default=FinalOutcome.NONE,
        db_index=True,
        help_text='Terminal sales-result for KPIs. Derived from delivery/return state by lifecycle service.',
    )

    # ── Unified workflow status (UI source of truth) ─────────────────────────
    # Persisted-but-derived. Lifecycle service is the only writer.
    workflow_status = models.CharField(
        max_length=24,
        choices=WorkflowStatus.choices,
        default=WorkflowStatus.PENDING,
        db_index=True,
        help_text='10-state main workflow status used by the orders UI tabs and row badge.',
    )

    # ── Not-answered tracking for the auto-cancel scheduler ──────────────────
    not_answered_at = models.DateTimeField(
        null=True, blank=True, db_index=True,
        help_text='When contact_status first became NOT_ANSWERED (drives auto-cancel scheduler).',
    )
    not_answered_attempts = models.PositiveSmallIntegerField(
        default=0,
        help_text='Number of unanswered client call attempts for this order.',
    )
    auto_cancelled_at = models.DateTimeField(null=True, blank=True)
    auto_cancel_reason = models.CharField(
        max_length=120, blank=True, default='',
        help_text='Why the System auto-cancelled this order (e.g. not_answered_3d).',
    )

    # ── Loyalty points tracking ──────────────────────────────────────────────
    loyalty_points_granted = models.BooleanField(
        default=False,
        help_text='True once loyalty points have been credited to the client for this order.',
    )
    loyalty_points_granted_at = models.DateTimeField(null=True, blank=True)
    loyalty_points_amount = models.PositiveIntegerField(
        default=0,
        help_text='Points granted (saved so we can reverse the exact amount on return/cancel).',
    )

    # ── NEW top-layer status fields (Phase B, additive) ──────────────────────
    # Clean public status the UI/API read. Persisted-but-derived: written only
    # by the lifecycle service (Phase C). Defaults are safe placeholders so
    # existing saves and the test suite are unaffected. See STATUS_MAP.md.
    order_status = models.CharField(
        max_length=24, choices=OrderStatus.choices, default=OrderStatus.NEW,
        help_text='Clean business-lifecycle status (the single status the UI shows).',
    )
    confirmation_status = models.CharField(
        max_length=16, choices=ConfirmationStatus.choices,
        default=ConfirmationStatus.PENDING,
        help_text='Confirmation-team result, separate from order_status.',
    )
    delivery_method = models.CharField(
        max_length=16, choices=DeliveryMethod.choices,
        default=DeliveryMethod.HOME_DELIVERY,
    )
    stock_status = models.CharField(
        max_length=16, choices=StockStatus.choices, default=StockStatus.IN_STOCK,
        help_text='Derived per-order availability; recomputed by the service.',
    )
    priority_level = models.CharField(
        max_length=8, choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM,
        help_text='Derived handling priority; recomputed by the service.',
    )

    # WooCommerce push-sync state (distinct from OrderSyncEvent per-run history).
    sync_status = models.CharField(
        max_length=16, choices=SyncStatus.choices, default=SyncStatus.IMPORTED,
        help_text='State of pushing local changes TO WooCommerce.',
    )
    sync_error_message = models.TextField(
        blank=True, default='',
        help_text='Last WooCommerce push error (set when sync_status=sync_failed).',
    )
    last_sync_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Last successful push TO WooCommerce (distinct from synced_at, the last pull).',
    )

    # Delay holding-state details (decision 2). Independent of legacy delay_date.
    delay_until = models.DateTimeField(
        null=True, blank=True,
        help_text='When to follow up on a delayed order.',
    )
    delay_note = models.TextField(blank=True, default='')

    # "Confirmation activity has begun" signal for awaiting_confirmation (decision 9).
    confirmation_started_at = models.DateTimeField(null=True, blank=True)
    assigned_agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='assigned_orders',
        help_text='Confirmation agent assigned to this order.',
    )

    # ── Audit ─────────────────────────────────────────────────────────────────
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_created',
    )
    is_deleted  = models.BooleanField(default=False)
    deleted_at  = models.DateTimeField(null=True, blank=True)
    delete_reason = models.TextField(blank=True, default='')
    deleted_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='orders_deleted',
    )
    edit_locked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='locked_orders',
    )
    edit_locked_at = models.DateTimeField(null=True, blank=True)
    edit_lock_heartbeat_at = models.DateTimeField(null=True, blank=True)
    edit_lock_expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    edit_lock_token = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects     = ActiveOrderManager()
    all_objects = models.Manager()

    class Meta:
        app_label        = 'orders'
        db_table         = 'sales_order'
        verbose_name     = 'Order'
        verbose_name_plural = 'Orders'
        ordering = ['-created_at']
        constraints = [
            # Primary idempotency: one WC order ID per company
            models.UniqueConstraint(
                fields=['company', 'external_order_id'],
                condition=~models.Q(external_order_id=''),
                name='unique_external_order_per_company',
            ),
            models.UniqueConstraint(
                fields=['company', 'sales_channel', 'import_hash'],
                condition=~models.Q(import_hash=''),
                name='unique_order_import_hash_per_channel',
            ),
            models.UniqueConstraint(
                fields=['company', 'client_ticket_uuid'],
                condition=~models.Q(client_ticket_uuid=''),
                name='unique_order_client_ticket_uuid',
            ),
            models.UniqueConstraint(
                fields=['company', 'ticket_id'],
                condition=~models.Q(ticket_id=''),
                name='unique_order_ticket_id_per_company',
            ),
            models.CheckConstraint(
                check=models.Q(discount_value__gte=Decimal('0.00')),
                name='order_discount_value_gte_zero',
            ),
        ]
        indexes = [
            models.Index(fields=['company', 'is_deleted']),
            models.Index(fields=['company', 'status']),
            models.Index(fields=['company', 'external_order_id']),
            models.Index(fields=['company', 'ticket_id'], name='order_ticket_idx'),
            models.Index(fields=['company', 'client_ticket_uuid'], name='order_client_ticket_idx'),
            models.Index(fields=['sales_channel']),
            models.Index(fields=['order_number']),
            models.Index(fields=['is_deleted']),
            models.Index(fields=['synced_at']),
            models.Index(fields=['delivery_status']),
            models.Index(fields=['company', 'outcome', 'delivery_status'], name='order_lifecycle_priority_idx'),
            models.Index(fields=['company', 'contact_status', 'delay_date'], name='order_contact_delay_idx'),
            models.Index(fields=['company', 'return_exchange_status'], name='order_return_exchange_idx'),
            models.Index(fields=['company', 'final_outcome'], name='order_final_outcome_idx'),
            models.Index(fields=['company', 'packaging_status'], name='order_packaging_status_idx'),
            models.Index(fields=['company', 'workflow_status'], name='order_workflow_status_idx'),
            models.Index(fields=['company', 'order_status'], name='order_order_status_idx'),
            models.Index(fields=['company', 'sync_status'], name='order_sync_status_idx'),
            models.Index(fields=['company', 'priority_level'], name='order_priority_idx'),
            models.Index(fields=['company', 'contact_status', 'not_answered_at'], name='order_not_answered_at_idx'),
            models.Index(fields=['company', 'in_store_pickup'], name='order_pickup_idx'),
            models.Index(fields=['company', 'pos_sales_channel'], name='order_pos_channel_idx'),
            models.Index(fields=['company', 'stock_restored_at'], name='order_stock_restore_idx'),
            models.Index(fields=['company', 'edit_lock_expires_at'], name='order_edit_lock_idx'),
            models.Index(fields=['outcome'], name='sales_order_outcome_idx'),
            # Composite index for incremental sync queries
            models.Index(fields=['sales_channel', 'wc_date_modified']),
        ]

    def __str__(self):
        return f"Order {self.order_number} ({self.get_status_display()})"

    def save(self, *args, **kwargs):
        if not self.order_number:
            ts     = timezone.now().strftime('%Y%m%d%H%M%S')
            suffix = random.randint(1000, 9999)
            self.order_number = f"ORD-{ts}-{suffix}"
        if self.source == self.Source.POS and not self.ticket_id:
            ts = timezone.localdate().strftime('%d%m%Y')
            suffix = random.randint(1000, 9999)
            self.ticket_id = f"{ts}{suffix}"
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self):
        if self.discount_type == self.DiscountType.PERCENTAGE:
            if self.discount_value < Decimal('0.00') or self.discount_value > Decimal('100.00'):
                raise ValidationError(
                    {'discount_value': 'Percentage discount must be between 0 and 100.'}
                )

        if (
            self.outcome == self.Outcome.DELAYED
            or self.contact_status == self.ContactStatus.DELAYED
        ) and not self.delay_date:
            raise ValidationError({'delay_date': 'Delay date is required for delayed orders.'})

        if (self.client_id and self.company_id
                and self.client.company_id
                and self.client.company_id != self.company_id):
            raise ValidationError({'client': 'Client company must match order company.'})

        if self.sales_channel_id and self.company_id:
            if self.sales_channel.brand.company_id != self.company_id:
                raise ValidationError(
                    {'sales_channel': 'Sales channel company must match order company.'}
                )

        if self.pos_sales_channel_id:
            if self.pos_sales_channel.channel_type != 'POS':
                raise ValidationError({'pos_sales_channel': 'Selected POS location must be a POS sales channel.'})
            if self.sales_channel_id and self.pos_sales_channel.brand_id != self.sales_channel.brand_id:
                raise ValidationError({'pos_sales_channel': 'POS location must belong to the same brand as the order.'})

        if self.pk is None:
            return

        active_lines  = OrderLine.objects.filter(order=self)
        lines_total   = active_lines.aggregate(t=models.Sum('total'))['t'] or Decimal('0.00')
        if (active_lines.exists()
                and self.discount_type == self.DiscountType.FIXED
                and self.discount_value > lines_total):
            raise ValidationError(
                {'discount_value': 'Fixed discount cannot exceed order lines total.'}
            )

    def delete(self, *args, **kwargs):
        raise ValidationError('Direct hard deletion is blocked. Use soft_delete() instead.')

    def hard_delete(self, *, force: bool = False, user=None):
        if not force:
            raise ValidationError('Hard delete requires explicit force=True.')
        if user is not None and not getattr(user, 'is_superuser', False):
            raise ValidationError('Only superusers can hard delete orders.')
        if not settings.DEBUG and (user is None or not getattr(user, 'is_superuser', False)):
            raise ValidationError('Hard delete is blocked outside debug.')
        return super().delete()

    def soft_delete(self, user=None, reason: str = ''):
        if self.is_deleted:
            return
        self.is_deleted  = True
        self.deleted_at  = timezone.now()
        self.deleted_by  = user
        self.delete_reason = reason or ''
        self.save(update_fields=[
            'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason', 'updated_at',
        ])
        OrderLine.all_objects.filter(order=self, is_deleted=False).update(is_deleted=True)
        from .logging_service import OrderLoggingService
        OrderLoggingService.log(
            order=self, action=OrderLog.Action.SOFT_DELETED,
            user=user, details={'reason': reason},
        )

    def restore(self, user=None):
        if not self.is_deleted:
            return
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by = None
        self.delete_reason = ''
        self.save(update_fields=[
            'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason', 'updated_at',
        ])
        OrderLine.all_objects.filter(order=self, is_deleted=True).update(is_deleted=False)
        from .logging_service import OrderLoggingService
        OrderLoggingService.log(
            order=self, action=OrderLog.Action.RESTORED,
            user=user or getattr(self, '_actor', None), details={},
        )

    def recalculate_totals(self, *, save: bool = False):
        active_lines = OrderLine.objects.filter(order=self)
        agg = active_lines.aggregate(
            sub=models.Sum('subtotal'),
            tax=models.Sum('tax'),
            tot=models.Sum('total'),
        )
        subtotal    = agg['sub'] or Decimal('0.00')
        tax_total   = agg['tax'] or Decimal('0.00')
        lines_total = agg['tot'] or Decimal('0.00')

        discount_total = Decimal('0.00')
        if self.discount_type == self.DiscountType.FIXED:
            discount_total = max(Decimal('0.00'), self.discount_value)
        elif self.discount_type == self.DiscountType.PERCENTAGE:
            if not (Decimal('0.00') <= self.discount_value <= Decimal('100.00')):
                raise ValidationError('Percentage discount must be between 0 and 100.')
            discount_total = (lines_total * self.discount_value) / Decimal('100.00')

        discount_total = min(discount_total, lines_total)
        total          = max(Decimal('0.00'), lines_total - discount_total)

        self.subtotal       = subtotal
        self.tax_total      = tax_total
        self.discount_total = discount_total.quantize(Decimal('0.01'))
        self.total          = total.quantize(Decimal('0.01'))

        if save:
            self.save(update_fields=[
                'subtotal', 'tax_total', 'discount_total', 'total', 'updated_at',
            ])
        return {
            'subtotal': self.subtotal, 'tax_total': self.tax_total,
            'discount_total': self.discount_total, 'total': self.total,
        }

    # ── Delivery helpers ──────────────────────────────────────────────────────

    def get_wc_meta(self, key: str, default=None):
        """Look up a single WooCommerce meta value by key."""
        return self.wc_meta_data.get(key, default)

    @property
    def can_submit_delivery(self) -> bool:
        """True when this order is eligible to be sent to the delivery provider."""
        return (
            self.outcome == self.Outcome.CONFIRMED
            and self.delivery_status in (
                self.DeliveryStatus.NONE,
                self.DeliveryStatus.PENDING,
                self.DeliveryStatus.FAILED,
            )
            and self.return_exchange_status == self.ReturnExchangeStatus.NONE
            and not self.is_deleted
        )


# ═════════════════════════════════════════════════════════════════════════════
# ORDER LINE
# ═════════════════════════════════════════════════════════════════════════════

class OrderLine(models.Model):

    # ── Per-line return condition (drives stock movement during process_return) ─
    class ReturnCondition(models.TextChoices):
        NONE      = 'NONE',      'Not Returned'
        GOOD      = 'GOOD',      'Good Condition'
        DAMAGED   = 'DAMAGED',   'Damaged'
        MISSING   = 'MISSING',   'Missing'
        EXCHANGED = 'EXCHANGED', 'Exchanged'

    order = models.ForeignKey(
        Order, on_delete=models.CASCADE, related_name='lines',
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='order_lines',
    )

    # Snapshot at time of order
    external_line_id = models.CharField(
        max_length=100, blank=True, default='',
        help_text='WooCommerce line item ID or generated stable line key',
        db_index=True,
    )
    wc_product_id = models.PositiveIntegerField(null=True, blank=True)
    product_name  = models.CharField(max_length=255)
    barcode       = models.CharField(max_length=100, blank=True, default='')

    # Quantities & pricing
    quantity   = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    subtotal   = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    tax        = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    total      = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    is_deleted = models.BooleanField(default=False)

    # Return classification (per-line, set by process_return)
    return_condition = models.CharField(
        max_length=12,
        choices=ReturnCondition.choices,
        default=ReturnCondition.NONE,
    )
    replacement_product = models.ForeignKey(
        'products.Product',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='+',
        help_text='Replacement product when return_condition=EXCHANGED.',
    )

    # WooCommerce product linking flags (Phase 2)
    is_linked = models.BooleanField(
        default=True,
        help_text='False when a WC line could not be linked to a local Product. '
                  'Unlinked lines never trigger stock movements.',
    )
    unlinked_reason = models.CharField(
        max_length=40, blank=True, default='',
        help_text='no_wc_id | no_sku | name_ambiguous | no_match',
    )

    objects     = ActiveOrderLineManager()
    all_objects = models.Manager()

    class Meta:
        app_label  = 'orders'
        db_table   = 'order_line'
        constraints = [
            models.CheckConstraint(
                check=models.Q(quantity__gt=0), name='order_line_quantity_gt_zero',
            ),
            models.CheckConstraint(
                check=models.Q(unit_price__gte=Decimal('0.00')),
                name='order_line_unit_price_gte_zero',
            ),
            models.UniqueConstraint(
                fields=['order', 'external_line_id'],
                condition=~models.Q(external_line_id=''),
                name='unique_order_line_external_id',
            ),
        ]
        indexes = [
            models.Index(fields=['order', 'is_deleted']),
            models.Index(fields=['order', 'external_line_id'], name='order_line_ext_id_idx'),
            models.Index(fields=['is_deleted']),
        ]

    def __str__(self):
        return f"{self.product_name} x{self.quantity}"

    def clean(self):
        if self.quantity <= 0:
            raise ValidationError({'quantity': 'Quantity must be greater than zero.'})
        if self.unit_price < Decimal('0.00'):
            raise ValidationError({'unit_price': 'Unit price must be >= zero.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        if self.subtotal == Decimal('0.00'):
            self.subtotal = Decimal(self.quantity) * self.unit_price
        if self.total == Decimal('0.00'):
            self.total = self.subtotal + self.tax
        super().save(*args, **kwargs)


# ═════════════════════════════════════════════════════════════════════════════
# ORDER LOG  (audit trail)
# ═════════════════════════════════════════════════════════════════════════════

class OrderLog(models.Model):
    """Immutable audit log for all meaningful order mutations."""

    class Action(models.TextChoices):
        # Lifecycle
        CREATED          = 'CREATED',          'Created'
        UPDATED          = 'UPDATED',           'Updated'
        SOFT_DELETED     = 'SOFT_DELETED',      'Soft Deleted'
        RESTORED         = 'RESTORED',          'Restored'
        DISCOUNT_APPLIED = 'DISCOUNT_APPLIED',  'Discount Applied'
        STATUS_CHANGED   = 'STATUS_CHANGED',    'Status Changed'
        WOOCOMMERCE_STATUS_CHANGED = 'WOOCOMMERCE_STATUS_CHANGED', 'WooCommerce Status Changed'
        LOCAL_STATUS_CHANGED = 'LOCAL_STATUS_CHANGED', 'Local Status Changed'
        CONTACT_STATUS_CHANGED = 'CONTACT_STATUS_CHANGED', 'Contact Status Changed'
        DELAY_DATE_CHANGED = 'DELAY_DATE_CHANGED', 'Delay Date Changed'
        RETURN_EXCHANGE_CHANGED = 'RETURN_EXCHANGE_CHANGED', 'Return / Exchange Changed'
        EDIT_LOCK_ACQUIRED = 'EDIT_LOCK_ACQUIRED', 'Edit Lock Acquired'
        EDIT_LOCK_RELEASED = 'EDIT_LOCK_RELEASED', 'Edit Lock Released'
        EDIT_LOCK_TAKEN_OVER = 'EDIT_LOCK_TAKEN_OVER', 'Edit Lock Taken Over'
        # Order outcome events
        OUTCOME_CONFIRMED = 'OUTCOME_CONFIRMED', 'Confirmed'
        OUTCOME_DELAYED   = 'OUTCOME_DELAYED',   'Delayed'
        OUTCOME_CANCELLED = 'OUTCOME_CANCELLED', 'Cancelled'
        # Sync events
        SYNC_RECEIVED    = 'SYNC_RECEIVED',     'Synced from WooCommerce'
        SYNC_FAILED      = 'SYNC_FAILED',       'Sync Failed'
        # Delivery events
        DELIVERY_QUEUED    = 'DELIVERY_QUEUED',    'Queued for Delivery'
        DELIVERY_SUBMITTED = 'DELIVERY_SUBMITTED', 'Submitted to Provider'
        DELIVERY_ACCEPTED  = 'DELIVERY_ACCEPTED',  'Accepted by Provider'
        DELIVERY_FAILED    = 'DELIVERY_FAILED',    'Delivery Failed'
        DELIVERY_DELIVERED = 'DELIVERY_DELIVERED', 'Delivered'
        DELIVERY_RETURNED  = 'DELIVERY_RETURNED',  'Returned to Sender'
        SENT_TO_POS        = 'SENT_TO_POS',        'Sent to POS'
        POS_VALIDATED      = 'POS_VALIDATED',      'POS Validated'
        RETURN_PROCESSED   = 'RETURN_PROCESSED',   'Return Processed'
        STOCK_RESTORED     = 'STOCK_RESTORED',     'Stock Restored'
        # Packaging events
        PACKAGED            = 'PACKAGED',            'Packaged'
        PACKAGING_UPDATED   = 'PACKAGING_UPDATED',   'Packaging Updated'
        PACKAGING_REVERSED  = 'PACKAGING_REVERSED',  'Packaging Reversed'
        # Return classification & outcome events
        RETURN_TYPE_SET     = 'RETURN_TYPE_SET',     'Return Type Set'
        FINAL_OUTCOME_CHANGED = 'FINAL_OUTCOME_CHANGED', 'Final Outcome Changed'
        DAMAGED_STOCK_RECORDED = 'DAMAGED_STOCK_RECORDED', 'Damaged Stock Recorded'
        REPLACEMENT_DEDUCTED = 'REPLACEMENT_DEDUCTED', 'Replacement Product Deducted'
        # Phase 2 events: workflow transitions, auto-cancel, loyalty, WC linking
        WORKFLOW_STATUS_CHANGED = 'WORKFLOW_STATUS_CHANGED', 'Workflow Status Changed'
        AUTO_CANCELLED      = 'AUTO_CANCELLED',      'Auto Cancelled (System)'
        POINTS_GRANTED      = 'POINTS_GRANTED',      'Loyalty Points Granted'
        POINTS_REVERSED     = 'POINTS_REVERSED',     'Loyalty Points Reversed'
        WC_PRODUCT_LINKED   = 'WC_PRODUCT_LINKED',   'WC Product Linked'
        WC_PRODUCT_UNLINKED = 'WC_PRODUCT_UNLINKED', 'WC Product Unlinked'
        # Phase B: clean order_status lifecycle, manual override, WC push-sync
        ORDER_STATUS_CHANGED   = 'ORDER_STATUS_CHANGED',   'Order Status Changed'
        MANUAL_STATUS_OVERRIDE = 'MANUAL_STATUS_OVERRIDE', 'Manual Status Override'
        WC_CANCEL_SYNCED       = 'WC_CANCEL_SYNCED',       'WooCommerce Cancel Synced'
        WC_SYNC_RETRIED        = 'WC_SYNC_RETRIED',        'WooCommerce Sync Retried'

    order   = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='logs')
    action  = models.CharField(max_length=30, choices=Action.choices)
    user    = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='order_logs',
    )
    details    = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label  = 'orders'
        db_table   = 'order_log'
        ordering   = ['-created_at']
        indexes    = [
            models.Index(fields=['order', 'created_at']),
            models.Index(fields=['action']),
        ]

    def __str__(self):
        return f"{self.order.order_number} – {self.action}"


# ═════════════════════════════════════════════════════════════════════════════
# ORDER SYNC EVENT  (one row per sync run)
# ═════════════════════════════════════════════════════════════════════════════

class OrderSyncEvent(models.Model):
    """
    Records each WooCommerce ↔ Django sync operation.

    Used for:
      • Incremental sync cursor (query by last finished_at per channel)
      • Monitoring / alerting on failed syncs
      • React frontend sync history panel
    """

    class SyncStatus(models.TextChoices):
        RUNNING   = 'RUNNING',   'Running'
        COMPLETED = 'COMPLETED', 'Completed'
        PARTIAL   = 'PARTIAL',   'Partial (with errors)'
        FAILED    = 'FAILED',    'Failed'

    class TriggerSource(models.TextChoices):
        MANUAL  = 'MANUAL',  'Manual (API)'
        CELERY  = 'CELERY',  'Celery Beat'
        WEBHOOK = 'WEBHOOK', 'Webhook'

    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.CASCADE,
        related_name='sync_events',
    )
    company = models.ForeignKey(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='order_sync_events',
    )
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='order_sync_events',
    )

    status         = models.CharField(
        max_length=20, choices=SyncStatus.choices, default=SyncStatus.RUNNING,
    )
    trigger_source = models.CharField(
        max_length=20, choices=TriggerSource.choices, default=TriggerSource.MANUAL,
    )

    # Sync window — what date range was queried from WooCommerce
    sync_from = models.DateTimeField(
        null=True, blank=True,
        help_text='modified_after parameter sent to WooCommerce (NULL = full sync)',
    )
    sync_to   = models.DateTimeField(
        null=True, blank=True,
        help_text='Upper bound of the sync window',
    )
    # WooCommerce statuses that were included in this sync
    wc_statuses_synced = models.JSONField(
        default=list, blank=True,
        help_text='List of WC statuses included, e.g. ["processing", "completed"]',
    )

    # Counters
    fetched_count = models.IntegerField(default=0, help_text='Orders fetched from WC')
    created_count = models.IntegerField(default=0)
    updated_count = models.IntegerField(default=0)
    error_count   = models.IntegerField(default=0)

    # Error details (list of {wc_id, error} dicts)
    error_detail = models.JSONField(default=list, blank=True)

    started_at  = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label  = 'orders'
        db_table   = 'order_sync_event'
        ordering   = ['-started_at']
        indexes    = [
            models.Index(fields=['sales_channel', 'status']),
            models.Index(fields=['sales_channel', 'started_at']),
            models.Index(fields=['company', 'started_at']),
        ]

    def __str__(self):
        return (
            f"Sync {self.sales_channel} "
            f"[{self.status}] {self.started_at:%Y-%m-%d %H:%M}"
        )

    @property
    def duration_seconds(self) -> float | None:
        if self.finished_at and self.started_at:
            return (self.finished_at - self.started_at).total_seconds()
        return None

    def finish(self, *, created: int, updated: int, errors: int,
               error_detail: list | None = None,
               status: str | None = None) -> None:
        """Mark the event as finished and persist counters."""
        self.created_count = created
        self.updated_count = updated
        self.error_count   = errors
        self.error_detail  = error_detail or []
        self.finished_at   = timezone.now()
        if status:
            self.status = status
        elif errors and (created + updated) > 0:
            self.status = self.SyncStatus.PARTIAL
        elif errors:
            self.status = self.SyncStatus.FAILED
        else:
            self.status = self.SyncStatus.COMPLETED
        self.save(update_fields=[
            'status', 'created_count', 'updated_count',
            'error_count', 'error_detail', 'finished_at',
        ])


# ═════════════════════════════════════════════════════════════════════════════
# SYSTEM SETTING  (per-company order-management configuration)
# ═════════════════════════════════════════════════════════════════════════════

def default_wc_status_map() -> dict:
    """Default local ``order_status`` → WooCommerce status map (decision 13)."""
    return {
        'awaiting_confirmation': 'on-hold',
        'confirmed': 'processing',
        'preparing': 'processing',
        'done': 'completed',
        'canceled': 'cancelled',
        'returned': 'refunded',
        'exchanged': 'processing',
    }


class SystemSetting(models.Model):
    """
    Per-company tunables for order management (STATUS_MAP.md decisions 4, 5, 13).

    One row per company, created lazily with defaults via ``get_for_company``.
    Phase B only defines the model; the priority / fee / sync services read it
    in Phase C. Nothing here changes behaviour yet.
    """

    company = models.OneToOneField(
        'company.Company',
        on_delete=models.CASCADE,
        related_name='system_setting',
    )

    # Priority thresholds (decision 4), amounts in order currency.
    priority_high_min_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('299.00'),
        help_text='total >= this AND in_stock => HIGH priority.',
    )
    priority_medium_min_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('100.00'),
        help_text='total >= this (and below high) => at least MEDIUM priority.',
    )

    # No-answer policy (decisions 2, 9).
    no_answer_max_attempts = models.PositiveSmallIntegerField(
        default=3,
        help_text='Unanswered attempts before order_status becomes not_answered.',
    )

    # POS-pickup delivery fee (decision 5).
    pos_pickup_delivery_fee = models.DecimalField(
        max_digits=8, decimal_places=3, default=Decimal('7.000'),
        help_text='Fee kept on POS-pickup orders at/above the waive threshold.',
    )
    pos_pickup_fee_waive_below = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('299.00'),
        help_text='POS-pickup orders below this have the delivery fee removed.',
    )

    # local order_status -> WooCommerce status map (decision 13).
    wc_status_map = models.JSONField(
        default=default_wc_status_map, blank=True,
        help_text='Maps local order_status values to WooCommerce status strings.',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = 'orders'
        db_table = 'order_system_setting'
        verbose_name = 'System Setting'
        verbose_name_plural = 'System Settings'

    def __str__(self):
        return f"SystemSetting<company={self.company_id}>"

    @classmethod
    def get_for_company(cls, company):
        """Return the company's settings row, creating defaults if absent."""
        obj, _ = cls.objects.get_or_create(company=company)
        return obj
