"""
LkSystem Promotions App - Models
Multi-Channel Promotion Engine with Dynamic Discounts.

Key Design:
- A Promotion has a base configuration (name, dates, status)
- PromotionChannelRule (Through Model) stores channel-specific discount rates
- A single product can have different discounts per sales channel
"""

import uuid

from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from decimal import Decimal


# =============================================================================
# CHOICES (Module-level for easy imports)
# =============================================================================

class PromotionStatus(models.TextChoices):
    """Promotion status choices."""
    DRAFT = 'draft', 'Draft'
    SCHEDULED = 'scheduled', 'Scheduled'
    ACTIVE = 'active', 'Active'
    PAUSED = 'paused', 'Paused'
    EXPIRED = 'expired', 'Expired'
    CANCELLED = 'cancelled', 'Cancelled'


class DiscountType(models.TextChoices):
    """Type of discount calculation."""
    PERCENTAGE = 'percentage', 'Percentage'
    FIXED_AMOUNT = 'fixed', 'Fixed Amount'


class Promotion(models.Model):
    """
    Promotion entity for multi-channel discount management.
    
    A promotion defines the base configuration and is linked to:
    - A product (what is being promoted)
    - Multiple sales channels via PromotionChannelRule (through model)
    
    Each channel can have a different discount percentage.
    """
    
    # ==========================================================================
    # Basic Information
    # ==========================================================================
    name = models.CharField(
        max_length=255,
        verbose_name='Promotion Name',
        help_text='Internal name for the promotion'
    )
    description = models.TextField(
        blank=True,
        default='',
        verbose_name='Description',
        help_text='Detailed description of the promotion'
    )
    code = models.CharField(
        max_length=50,
        blank=True,
        default='',
        verbose_name='Promotion Code',
        help_text='Optional coupon/promo code (e.g., SUMMER20)'
    )

    # ==========================================================================
    # Group — siblings created together share the same UUID and are surfaced
    # as a single "campaign" in the UI. Always set (defaults to a fresh UUID
    # for legacy single-product promotions so every row belongs to a group).
    # ==========================================================================
    group_id = models.UUIDField(
        default=uuid.uuid4,
        null=True,
        blank=True,
        db_index=True,
        verbose_name='Group ID',
        help_text='Shared identifier for promotions created together (campaign).',
    )

    # ==========================================================================
    # Product Association
    # ==========================================================================
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.CASCADE,
        related_name='promotions',
        verbose_name='Product',
        help_text='The product this promotion applies to'
    )
    
    # ==========================================================================
    # Brand Scope (Brand is already linked to Company)
    # ==========================================================================
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.CASCADE,
        related_name='promotions',
        verbose_name='Brand',
        null=True,
        blank=True,
        help_text='Brand for this promotion (linked to company via brand)'
    )
    
    # ==========================================================================
    # Discount Configuration (Default values, can be overridden per channel)
    # ==========================================================================
    discount_type = models.CharField(
        max_length=20,
        choices=DiscountType.choices,
        default=DiscountType.PERCENTAGE,
        verbose_name='Default Discount Type'
    )
    default_discount_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0'))],
        verbose_name='Default Discount Value',
        help_text='Default discount (can be overridden per channel)'
    )
    
    # ==========================================================================
    # Schedule
    # ==========================================================================
    start_date = models.DateTimeField(
        verbose_name='Start Date',
        help_text='When the promotion becomes active'
    )
    end_date = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='End Date',
        help_text='When the promotion expires. Leave empty to run indefinitely until manually deactivated.'
    )
    
    # ==========================================================================
    # Status
    # ==========================================================================
    status = models.CharField(
        max_length=20,
        choices=PromotionStatus.choices,
        default=PromotionStatus.DRAFT,
        verbose_name='Status'
    )
    is_active = models.BooleanField(
        default=True,
        verbose_name='Is Active',
        help_text='Master switch for this promotion'
    )
    
    # ==========================================================================
    # Usage Limits
    # ==========================================================================
    max_usage = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='Maximum Usage',
        help_text='Maximum number of times this promotion can be used (null = unlimited)'
    )
    current_usage = models.PositiveIntegerField(
        default=0,
        verbose_name='Current Usage',
        help_text='Number of times this promotion has been used'
    )
    
    # ==========================================================================
    # Priority (for stacking)
    # ==========================================================================
    priority = models.PositiveIntegerField(
        default=0,
        verbose_name='Priority',
        help_text='Higher priority promotions are applied first (0 = lowest)'
    )
    is_stackable = models.BooleanField(
        default=False,
        verbose_name='Is Stackable',
        help_text='Can this promotion be combined with others?'
    )
    
    # ==========================================================================
    # Audit Fields
    # ==========================================================================
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_promotions',
        verbose_name='Created By'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_promotions',
        verbose_name='Updated By'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # ==========================================================================
    # Many-to-Many through PromotionChannelRule
    # ==========================================================================
    sales_channels = models.ManyToManyField(
        'sales_channels.SalesChannel',
        through='PromotionChannelRule',
        related_name='promotions',
        verbose_name='Sales Channels',
        help_text='Channels where this promotion is active (with specific discount rates)'
    )
    
    class Meta:
        app_label = 'promotions'
        db_table = 'promotions_promotion'
        verbose_name = 'Promotion'
        verbose_name_plural = 'Promotions'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'is_active']),
            models.Index(fields=['start_date', 'end_date']),
            models.Index(fields=['product']),
            models.Index(fields=['brand']),
            models.Index(fields=['group_id']),
        ]
    
    def __str__(self):
        return f"{self.name} - {self.product.name}"
    
    @property
    def is_currently_active(self):
        """Check if promotion is currently active based on dates and status.

        An empty ``end_date`` means the promotion runs indefinitely until
        manually deactivated (``is_active=False`` or non-ACTIVE status).
        """
        from django.utils import timezone
        now = timezone.now()
        if not (self.is_active and self.status == PromotionStatus.ACTIVE):
            return False
        if self.start_date > now:
            return False
        if self.end_date is not None and self.end_date < now:
            return False
        return True
    
    @property
    def is_within_usage_limit(self):
        """Check if promotion hasn't exceeded usage limits."""
        if self.max_usage is None:
            return True
        return self.current_usage < self.max_usage
    
    def get_discount_for_channel(self, sales_channel_id):
        """
        Get the specific discount for a sales channel.
        Falls back to default_discount_value if no enabled rule exists.
        """
        try:
            rule = self.channel_rules.get(sales_channel_id=sales_channel_id, is_enabled=True)
            return rule.discount_value
        except PromotionChannelRule.DoesNotExist:
            return self.default_discount_value
    
    def calculate_discounted_price(self, original_price, sales_channel_id):
        """
        Calculate the discounted price for a specific sales channel.
        
        Args:
            original_price: Original product price
            sales_channel_id: ID of the sales channel
            
        Returns:
            Decimal: Discounted price
        """
        discount = self.get_discount_for_channel(sales_channel_id)
        original = Decimal(str(original_price))
        
        if self.discount_type == DiscountType.PERCENTAGE:
            discount_amount = original * (discount / Decimal('100'))
        else:  # Fixed amount
            discount_amount = discount
        
        return max(original - discount_amount, Decimal('0'))


class PromotionChannelRule(models.Model):
    """
    Through model for Promotion-SalesChannel relationship.
    
    This model stores the channel-specific discount rates.
    A single product can have different discounts per sales channel.
    
    Example:
    - Product X in "Boutique A": 5% discount
    - Product X in "Boutique B": 10% discount
    """
    
    promotion = models.ForeignKey(
        Promotion,
        on_delete=models.CASCADE,
        related_name='channel_rules',
        verbose_name='Promotion'
    )
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.CASCADE,
        related_name='promotion_rules',
        verbose_name='Sales Channel'
    )
    
    # ==========================================================================
    # Channel-Specific Discount
    # ==========================================================================
    discount_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[
            MinValueValidator(Decimal('0')),
        ],
        verbose_name='Discount Value',
        help_text='Channel-specific discount (percentage or fixed amount)'
    )
    
    # ==========================================================================
    # Channel-Specific Overrides
    # ==========================================================================
    is_enabled = models.BooleanField(
        default=True,
        verbose_name='Enabled',
        help_text='Is this promotion active for this channel?'
    )
    
    # Optional: Different priority per channel
    channel_priority = models.PositiveIntegerField(
        default=0,
        verbose_name='Channel Priority',
        help_text='Priority for this channel (overrides promotion priority)'
    )
    
    # Optional: Channel-specific usage limits
    channel_max_usage = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='Channel Max Usage',
        help_text='Max usage for this specific channel (null = use promotion limit)'
    )
    channel_current_usage = models.PositiveIntegerField(
        default=0,
        verbose_name='Channel Current Usage'
    )
    
    # ==========================================================================
    # Audit
    # ==========================================================================
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        app_label = 'promotions'
        db_table = 'promotions_channel_rule'
        verbose_name = 'Promotion Channel Rule'
        verbose_name_plural = 'Promotion Channel Rules'
        unique_together = [['promotion', 'sales_channel']]
        ordering = ['sales_channel__name']
    
    def __str__(self):
        return f"{self.promotion.name} - {self.sales_channel.name}: {self.discount_value}%"
    
    @property
    def is_within_channel_limit(self):
        """Check if this channel hasn't exceeded its usage limit."""
        if self.channel_max_usage is None:
            return True
        return self.channel_current_usage < self.channel_max_usage
