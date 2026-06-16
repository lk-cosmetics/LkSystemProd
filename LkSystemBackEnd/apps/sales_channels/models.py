"""
LkSystem Sales Channels App - Models
SalesChannel entity for managing different sales points.
"""

import secrets
from django.db import models


class SalesChannel(models.Model):
    """
    Sales channel for a Brand.
    Supports different channel types like WooCommerce and POS.
    Configuration is stored flexibly in a JSONField.
    """
    
    class ChannelType(models.TextChoices):
        WOOCOMMERCE = 'WOOCOMMERCE', 'WooCommerce'
        POS = 'POS', 'Point of Sale'
        WEB = 'WEB', 'Web'

    class StoreType(models.TextChoices):
        """Physical store type when a channel represents a location."""
        WAREHOUSE = 'WAREHOUSE', 'Warehouse'
        RETAIL = 'RETAIL', 'Retail Store'
        DISTRIBUTION = 'DISTRIBUTION', 'Distribution Center'
    
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.CASCADE,
        related_name='sales_channels',
        verbose_name='Brand'
    )
    name = models.CharField(
        max_length=255,
        verbose_name='Channel Name'
    )
    code = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        default=None,
        verbose_name='Channel Code',
        help_text='Unique code for the channel (e.g., WH001, STR-TUN)'
    )
    channel_type = models.CharField(
        max_length=20,
        choices=ChannelType.choices,
        verbose_name='Channel Type'
    )
    store_type = models.CharField(
        max_length=20,
        choices=StoreType.choices,
        default=StoreType.WAREHOUSE,
        verbose_name='Store Type'
    )
    is_active = models.BooleanField(
        default=True,
        verbose_name='Active',
        help_text='Designates whether this sales channel is active'
    )
    is_default = models.BooleanField(
        default=False,
        verbose_name='Default Channel',
        help_text='Default channel for new inventory'
    )

    address = models.TextField(
        blank=True,
        default='',
        verbose_name='Address',
        help_text='Full address of the channel (if applicable)'
    )
    city = models.CharField(
        max_length=100,
        blank=True,
        default='',
        verbose_name='City'
    )
    state = models.CharField(
        max_length=100,
        blank=True,
        default='',
        verbose_name='State / Governorate'
    )
    phone = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Phone Number'
    )
    email = models.EmailField(
        blank=True,
        default='',
        verbose_name='Email'
    )
    
    # WooCommerce configuration (flat columns instead of JSON)
    wc_store_url = models.URLField(
        max_length=500, blank=True, default='',
        verbose_name='WooCommerce Store URL',
        help_text='e.g. https://example.com'
    )
    wc_consumer_key = models.CharField(
        max_length=255, blank=True, default='',
        verbose_name='Consumer Key',
        help_text='WooCommerce REST API consumer key'
    )
    wc_consumer_secret = models.CharField(
        max_length=255, blank=True, default='',
        verbose_name='Consumer Secret',
        help_text='WooCommerce REST API consumer secret'
    )
    delivery_api_key = models.TextField(
        blank=True, default='',
        verbose_name='Delivery API Key',
        help_text='API key for the third-party delivery service (WooCommerce channels)'
    )
    wc_webhook_token = models.CharField(
        max_length=100, blank=True, default='',
        verbose_name='Webhook Token',
        help_text='Token for authenticating incoming webhooks'
    )
    wc_push_status_enabled = models.BooleanField(
        default=True,
        verbose_name='Push order status to WooCommerce',
        help_text=(
            'When enabled, completing an order in the system (e.g. after '
            'packaging) pushes the mapped status (completed / cancelled / …) '
            'back to this WooCommerce store. A failed push never changes the '
            'local status — it is recorded for a retry.'
        ),
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        app_label = 'sales_channels'
        db_table = 'sales_channel'
        verbose_name = 'Sales Channel'
        verbose_name_plural = 'Sales Channels'
        ordering = ['brand', 'name']
        unique_together = ['brand', 'code']
    
    def __str__(self):
        return f"{self.name} ({self.get_channel_type_display()})"
    
    @property
    def company(self):
        """Shortcut to get the parent company through brand."""
        return self.brand.company
    
    def generate_webhook_token(self):
        """
        Generate a new webhook token for WooCommerce to authenticate with this system.
        User must provide their own consumer_key and consumer_secret from WooCommerce.
        Returns the generated webhook token.
        """
        webhook_token = f"whk_{secrets.token_urlsafe(32)}"
        self.wc_webhook_token = webhook_token
        self.save(update_fields=['wc_webhook_token', 'updated_at'])
        
        return webhook_token
    
    def save(self, *args, **kwargs):
        # Ensure only one default channel per company
        if self.is_default:
            SalesChannel.objects.filter(
                brand__company=self.brand.company,
                is_default=True
            ).exclude(pk=self.pk).update(is_default=False)

        # Auto-generate webhook_token on first save if channel type is WOOCOMMERCE
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        # Generate webhook_token for WooCommerce channels if not present
        if is_new and self.channel_type == self.ChannelType.WOOCOMMERCE:
            if not self.wc_webhook_token:
                self.generate_webhook_token()


# ─────────────────────────────────────────────────────────────────────────
# CAISSE — CASH MOVEMENTS (unified expenses + alimentations)
# ─────────────────────────────────────────────────────────────────────────

from decimal import Decimal
from django.conf import settings


# Sub-categories, scoped by movement type. ``OTHER`` is shared. The model keeps
# ``category`` as a plain CharField (valid values depend on ``movement_type``),
# so validation + display labels live in code rather than a single DB enum.
EXPENSE_CATEGORIES: dict[str, str] = {
    "SUPPLIES":    "Supplies / Fournitures",
    "UTILITY":     "Utility / Facture",
    "TRANSPORT":   "Transport / Livraison",
    "SALARY":      "Salary / Salaire",
    "MAINTENANCE": "Maintenance / Réparation",
    "REFUND":      "Refund / Remboursement client",
    "OTHER":       "Other / Autre",
}
DEPOSIT_CATEGORIES: dict[str, str] = {
    "OPENING": "Opening float / Fond de caisse",
    "TOP_UP":  "Cash added / Alimentation",
    "OTHER":   "Other / Autre",
}
CATEGORY_LABELS: dict[str, str] = {**EXPENSE_CATEGORIES, **DEPOSIT_CATEGORIES}


class CashMovement(models.Model):
    """A single cash movement at a POS register — one unified model for both
    sides of the till:

    * ``DEPOSIT`` (alimentation de caisse) — cash IN: the opening float or a
      top-up. Increases the balance.
    * ``EXPENSE`` (dépense) — cash OUT: petty cash, supplies, refunds, etc.
      Decreases the balance.

    ``amount`` is always stored positive; the direction is derived from
    ``movement_type``. ``category`` holds the sub-type (see EXPENSE_CATEGORIES /
    DEPOSIT_CATEGORIES). Removing a movement is a soft delete so the caisse
    history can show both the original entry and its reversal.
    """

    class Type(models.TextChoices):
        EXPENSE = "expense", "Dépense"
        DEPOSIT = "deposit", "Alimentation"

    company = models.ForeignKey(
        "company.Company", on_delete=models.CASCADE,
        related_name="cash_movements",
    )
    sales_channel = models.ForeignKey(
        "sales_channels.SalesChannel",
        on_delete=models.CASCADE,
        related_name="cash_movements",
        help_text="POS register the cash moved through.",
    )
    movement_type = models.CharField(
        max_length=10, choices=Type.choices, db_index=True,
        help_text="expense = cash out, deposit = cash in.",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0.000"))
    category = models.CharField(
        max_length=24, default="OTHER",
        help_text="Sub-type; valid values depend on movement_type.",
    )
    note = models.TextField(blank=True, default="")
    occurred_at = models.DateTimeField(db_index=True, help_text="When the cash moved.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cash_movements_created",
    )
    # Soft delete: a removed movement is kept so the caisse history can show
    # both the original entry and its later reversal. It no longer counts
    # toward the till balance once deleted.
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cash_movements_deleted",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "sales_channels"
        db_table = "pos_cash_movement"
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["sales_channel", "movement_type", "occurred_at"]),
            models.Index(fields=["company", "occurred_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(amount__gt=Decimal("0")),
                name="cash_movement_amount_gt_zero",
            ),
        ]

    def __str__(self):
        return f"{self.get_movement_type_display()} {self.amount} {self.category_display} ({self.occurred_at.strftime('%Y-%m-%d')})"

    @property
    def is_deposit(self) -> bool:
        return self.movement_type == self.Type.DEPOSIT

    @property
    def is_expense(self) -> bool:
        return self.movement_type == self.Type.EXPENSE

    @property
    def category_display(self) -> str:
        return CATEGORY_LABELS.get(self.category, self.category)