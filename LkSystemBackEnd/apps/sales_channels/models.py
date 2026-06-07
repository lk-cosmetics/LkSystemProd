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
        default=False,
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
# CAISSE EXPENSES
# ─────────────────────────────────────────────────────────────────────────

from decimal import Decimal
from django.conf import settings


class Expense(models.Model):
    """Outgoing cash from a POS register (\"dépense\") — petty cash,
    operating costs, supplies, taxi runs, etc. Each row decreases the
    caisse net balance for the day it was booked.
    """

    class Category(models.TextChoices):
        SUPPLIES   = "SUPPLIES",   "Supplies / Fournitures"
        UTILITY    = "UTILITY",    "Utility / Facture"
        TRANSPORT  = "TRANSPORT",  "Transport / Livraison"
        SALARY     = "SALARY",     "Salary / Salaire"
        MAINTENANCE = "MAINTENANCE", "Maintenance / Réparation"
        REFUND     = "REFUND",     "Refund / Remboursement client"
        OTHER      = "OTHER",      "Other / Autre"

    company = models.ForeignKey(
        "company.Company", on_delete=models.CASCADE,
        related_name="expenses",
    )
    sales_channel = models.ForeignKey(
        "sales_channels.SalesChannel",
        on_delete=models.CASCADE,
        related_name="expenses",
        help_text="POS register the dépense was paid from.",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0.000"))
    category = models.CharField(max_length=24, choices=Category.choices, default=Category.OTHER)
    note = models.TextField(blank=True, default="")
    occurred_at = models.DateTimeField(db_index=True, help_text="When the cash left the till.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="expenses_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "sales_channels"
        db_table = "pos_expense"
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["sales_channel", "occurred_at"]),
            models.Index(fields=["company", "occurred_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(amount__gt=Decimal("0")),
                name="expense_amount_gt_zero",
            ),
        ]

    def __str__(self):
        return f"Dépense {self.amount} {self.get_category_display()} ({self.occurred_at.strftime('%Y-%m-%d')})"


class CashDeposit(models.Model):
    """Incoming cash into a POS register ("alimentation de caisse") — the opening
    float put in before work, or a top-up added during the day. Each row
    increases the caisse balance for the day it was booked. Mirrors ``Expense``
    (which is the cash-OUT side).
    """

    class Kind(models.TextChoices):
        OPENING = "OPENING", "Opening float / Fond de caisse"
        TOP_UP  = "TOP_UP",  "Cash added / Alimentation"
        OTHER   = "OTHER",   "Other / Autre"

    company = models.ForeignKey(
        "company.Company", on_delete=models.CASCADE,
        related_name="cash_deposits",
    )
    sales_channel = models.ForeignKey(
        "sales_channels.SalesChannel",
        on_delete=models.CASCADE,
        related_name="cash_deposits",
        help_text="POS register the cash was added to.",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0.000"))
    kind = models.CharField(max_length=24, choices=Kind.choices, default=Kind.TOP_UP)
    note = models.TextField(blank=True, default="")
    occurred_at = models.DateTimeField(db_index=True, help_text="When the cash went into the till.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cash_deposits_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "sales_channels"
        db_table = "pos_cash_deposit"
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["sales_channel", "occurred_at"]),
            models.Index(fields=["company", "occurred_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(amount__gt=Decimal("0")),
                name="cash_deposit_amount_gt_zero",
            ),
        ]

    def __str__(self):
        return f"Alimentation {self.amount} {self.get_kind_display()} ({self.occurred_at.strftime('%Y-%m-%d')})"