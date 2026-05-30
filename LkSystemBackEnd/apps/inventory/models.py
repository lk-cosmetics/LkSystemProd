"""
LkSystem Inventory App - Models
Multi-Channel Inventory Management with automatic stock calculation.
"""

from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator
from decimal import Decimal


class SalesChannelInventory(models.Model):
    """
    Inventory level for a specific product in a specific sales channel.
    This is the core model for multi-channel inventory tracking.
    """
    
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.CASCADE,
        related_name='inventories',
        verbose_name='Sales Channel'
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.CASCADE,
        related_name='sales_channel_inventories',
        verbose_name='Product'
    )
    
    # Stock Levels
    quantity = models.IntegerField(
        default=0,
        verbose_name='Quantity',
        help_text='Current stock quantity in this channel'
    )
    reserved_quantity = models.IntegerField(
        default=0,
        verbose_name='Reserved Quantity',
        help_text='Quantity reserved for pending orders'
    )
    minimum_quantity = models.IntegerField(
        default=0,
        verbose_name='Minimum Quantity',
        help_text='Reorder point - alert when quantity falls below this'
    )
    maximum_quantity = models.IntegerField(
        null=True,
        blank=True,
        verbose_name='Maximum Quantity',
        help_text='Maximum stock capacity for this channel'
    )
    
    # Location within channel
    bin_location = models.CharField(
        max_length=50,
        blank=True,
        default='',
        verbose_name='Bin Location',
        help_text='Shelf/bin location within the channel (e.g., A1-B2)'
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_counted_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Last Physical Count',
        help_text='Date of last physical inventory count'
    )
    
    class Meta:
        app_label = 'inventory'
        db_table = 'store_inventory'
        verbose_name = 'Sales Channel Inventory'
        verbose_name_plural = 'Sales Channel Inventories'
        unique_together = ['sales_channel', 'product']
        indexes = [
            models.Index(fields=['sales_channel', 'product']),
            models.Index(fields=['product']),
            models.Index(fields=['quantity']),
        ]
    
    def __str__(self):
        return f"{self.product.name} @ {self.sales_channel.name}: {self.quantity}"
    
    @property
    def available_quantity(self):
        """Quantity available for sale (total - reserved)."""
        return max(0, self.quantity - self.reserved_quantity)
    
    @property
    def is_low_stock(self):
        """Check if stock is below minimum threshold."""
        return self.quantity <= self.minimum_quantity
    
    @property
    def is_out_of_stock(self):
        """Check if completely out of stock."""
        return self.available_quantity <= 0


class InventoryMovement(models.Model):
    """
    Track all inventory movements (stock in, stock out, transfers, adjustments).
    This provides a complete audit trail of inventory changes.
    """
    
    class MovementType(models.TextChoices):
        """Type of inventory movement."""
        # Stock In
        PURCHASE = 'PURCHASE', 'Purchase/Receipt'
        RETURN_IN = 'RETURN_IN', 'Customer Return'
        TRANSFER_IN = 'TRANSFER_IN', 'Transfer In'
        ADJUSTMENT_IN = 'ADJUSTMENT_IN', 'Adjustment (Add)'
        INITIAL = 'INITIAL', 'Initial Stock'
        
        # Stock Out
        SALE = 'SALE', 'Sale'
        RETURN_OUT = 'RETURN_OUT', 'Return to Supplier'
        TRANSFER_OUT = 'TRANSFER_OUT', 'Transfer Out'
        ADJUSTMENT_OUT = 'ADJUSTMENT_OUT', 'Adjustment (Remove)'
        DAMAGE = 'DAMAGE', 'Damaged/Expired'
        SENT_TO_FACTORY = 'SENT_TO_FACTORY', 'Sent to Factory'
        PRODUCTION_IN = 'PRODUCTION_IN', 'Production Receipt'
        
    class MovementStatus(models.TextChoices):
        """Status of the movement."""
        PENDING = 'PENDING', 'Pending'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'
    
    # Reference Information
    reference_number = models.CharField(
        max_length=50,
        unique=True,
        verbose_name='Reference Number',
        help_text='Unique movement reference (auto-generated)'
    )
    
    # Sales Channel & Product
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.PROTECT,
        related_name='movements',
        verbose_name='Sales Channel'
    )
    product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='inventory_movements',
        verbose_name='Product'
    )
    
    # Movement Details
    movement_type = models.CharField(
        max_length=20,
        choices=MovementType.choices,
        verbose_name='Movement Type'
    )
    status = models.CharField(
        max_length=20,
        choices=MovementStatus.choices,
        default=MovementStatus.PENDING,
        verbose_name='Status'
    )
    
    # Quantities
    quantity = models.IntegerField(
        validators=[MinValueValidator(1)],
        verbose_name='Quantity',
        help_text='Quantity moved (always positive)'
    )
    quantity_before = models.IntegerField(
        verbose_name='Quantity Before',
        help_text='Stock level before this movement'
    )
    quantity_after = models.IntegerField(
        verbose_name='Quantity After',
        help_text='Stock level after this movement'
    )
    
    # Cost Information
    unit_cost = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name='Unit Cost',
        help_text='Cost per unit for this movement'
    )
    total_cost = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name='Total Cost',
        help_text='Total cost of this movement'
    )
    
    # Transfer Information (for inter-channel transfers)
    destination_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='incoming_transfers',
        verbose_name='Destination Channel',
        help_text='For transfers: destination channel'
    )
    related_movement = models.OneToOneField(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='paired_movement',
        verbose_name='Related Movement',
        help_text='The paired movement for transfers'
    )
    
    # External Reference (for sales, purchases)
    external_reference = models.CharField(
        max_length=100,
        blank=True,
        default='',
        verbose_name='External Reference',
        help_text='Order ID, Invoice Number, etc.'
    )
    
    # Notes
    notes = models.TextField(
        blank=True,
        default='',
        verbose_name='Notes',
        help_text='Additional notes about this movement'
    )
    
    # Audit Trail
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='inventory_movements_created',
        verbose_name='Created By'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Completed At'
    )
    
    class Meta:
        app_label = 'inventory'
        db_table = 'inventory_movement'
        verbose_name = 'Inventory Movement'
        verbose_name_plural = 'Inventory Movements'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['reference_number']),
            models.Index(fields=['sales_channel', 'product']),
            models.Index(fields=['movement_type']),
            models.Index(fields=['status']),
            models.Index(fields=['created_at']),
        ]
    
    def __str__(self):
        return f"{self.reference_number} - {self.get_movement_type_display()}"
    
    def save(self, *args, **kwargs):
        # Auto-generate reference number
        if not self.reference_number:
            from django.utils import timezone
            import random
            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            random_suffix = random.randint(1000, 9999)
            self.reference_number = f"MOV-{timestamp}-{random_suffix}"
        
        # Calculate total cost
        if self.unit_cost and self.quantity:
            self.total_cost = self.unit_cost * self.quantity
        
        super().save(*args, **kwargs)
    
    @property
    def is_stock_in(self):
        """Check if this is a stock-in movement."""
        return self.movement_type in [
            self.MovementType.PURCHASE,
            self.MovementType.RETURN_IN,
            self.MovementType.TRANSFER_IN,
            self.MovementType.ADJUSTMENT_IN,
            self.MovementType.INITIAL,
            self.MovementType.PRODUCTION_IN,
        ]
    
    @property
    def is_stock_out(self):
        """Check if this is a stock-out movement."""
        return self.movement_type in [
            self.MovementType.SALE,
            self.MovementType.RETURN_OUT,
            self.MovementType.TRANSFER_OUT,
            self.MovementType.ADJUSTMENT_OUT,
            self.MovementType.DAMAGE,
            self.MovementType.SENT_TO_FACTORY,
        ]


class BillOfMaterials(models.Model):
    """Normalized BOM header for a finished product."""

    finished_product = models.OneToOneField(
        'products.Product',
        on_delete=models.CASCADE,
        related_name='bill_of_materials',
        verbose_name='Finished Product',
    )
    name = models.CharField(max_length=255, blank=True, default='')
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True, db_index=True)
    notes = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='boms_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = 'inventory'
        db_table = 'bill_of_materials'
        verbose_name = 'Bill of Materials'
        verbose_name_plural = 'Bills of Materials'
        indexes = [
            models.Index(fields=['finished_product']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return self.name or f"BOM for {self.finished_product}"

    @property
    def company(self):
        return self.finished_product.company

    def clean(self):
        from django.core.exceptions import ValidationError
        from apps.products.models import Product

        super().clean()
        if self.finished_product and self.finished_product.is_pack:
            raise ValidationError({
                'finished_product': 'Pack products cannot also use a manufacturing BOM.'
            })
        if (
            self.finished_product_id
            and self.finished_product.product_type != Product.ProductType.RESELL_PRODUCT
        ):
            raise ValidationError({
                'finished_product': 'A BOM can only produce a resell_product (the sellable finished good).'
            })


class BillOfMaterialsItem(models.Model):
    """One component required to produce one unit of a finished product."""

    bom = models.ForeignKey(
        BillOfMaterials,
        on_delete=models.CASCADE,
        related_name='items',
    )
    component = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='used_in_bom_items',
        verbose_name='Component Product',
    )
    quantity_per_unit = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        verbose_name='Quantity Per Finished Unit',
        help_text='Use the component base unit, for example bottle=1, cap=1, fragrance_ml=50.',
    )
    waste_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Optional expected waste percentage added when sending to factory.',
    )
    notes = models.TextField(blank=True, default='')

    class Meta:
        app_label = 'inventory'
        db_table = 'bill_of_materials_item'
        verbose_name = 'Bill of Materials Item'
        verbose_name_plural = 'Bill of Materials Items'
        constraints = [
            models.UniqueConstraint(
                fields=['bom', 'component'],
                name='unique_component_per_bom',
            ),
            models.CheckConstraint(
                check=models.Q(quantity_per_unit__gt=0),
                name='bom_item_quantity_per_unit_gt_zero',
            ),
            models.CheckConstraint(
                check=models.Q(waste_percent__gte=0),
                name='bom_item_waste_percent_gte_zero',
            ),
        ]
        indexes = [
            models.Index(fields=['bom', 'component']),
            models.Index(fields=['component']),
        ]

    def __str__(self):
        return f"{self.component} x {self.quantity_per_unit}"

    @property
    def company(self):
        return self.bom.company

    def clean(self):
        from django.core.exceptions import ValidationError
        from apps.products.models import Product

        super().clean()
        if self.component_id and self.component.product_type != Product.ProductType.COMPONENT:
            raise ValidationError({
                'component': 'Only component-type products can be used in a Bill of Materials.'
            })
        if self.bom_id and self.component_id:
            if self.component_id == self.bom.finished_product_id:
                raise ValidationError({'component': 'A product cannot be a component of itself.'})
            bom_company = self.bom.company
            component_company = self.component.company
            if bom_company and component_company and bom_company.id != component_company.id:
                raise ValidationError({'component': 'Component must belong to the same company as the finished product.'})


class ProductionBatch(models.Model):
    """A manufacturing request sent to the factory for one finished product."""

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        SENT_TO_FACTORY = 'SENT_TO_FACTORY', 'Sent to Factory'
        PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED', 'Partially Received'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    batch_number = models.CharField(max_length=50, unique=True)
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.PROTECT,
        related_name='production_batches',
    )
    finished_product = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='production_batches',
    )
    bom = models.ForeignKey(
        BillOfMaterials,
        on_delete=models.PROTECT,
        related_name='production_batches',
    )
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    planned_quantity = models.PositiveIntegerField()
    received_quantity = models.PositiveIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='production_batches_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = 'inventory'
        db_table = 'production_batch'
        verbose_name = 'Production Batch'
        verbose_name_plural = 'Production Batches'
        constraints = [
            models.CheckConstraint(
                check=models.Q(planned_quantity__gt=0),
                name='production_batch_planned_quantity_gt_zero',
            ),
            models.CheckConstraint(
                check=models.Q(received_quantity__gte=0),
                name='production_batch_received_quantity_gte_zero',
            ),
            models.CheckConstraint(
                check=models.Q(received_quantity__lte=models.F('planned_quantity')),
                name='production_batch_received_lte_planned',
            ),
        ]
        indexes = [
            models.Index(fields=['sales_channel', 'finished_product']),
            models.Index(fields=['status']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return self.batch_number

    def save(self, *args, **kwargs):
        if not self.batch_number:
            from django.utils import timezone
            import random

            timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
            self.batch_number = f"PROD-{timestamp}-{random.randint(1000, 9999)}"
        super().save(*args, **kwargs)

    @property
    def company(self):
        return self.sales_channel.brand.company

    @property
    def in_factory_quantity(self):
        return max(0, self.planned_quantity - self.received_quantity)

    def clean(self):
        from django.core.exceptions import ValidationError

        super().clean()
        if self.sales_channel_id and self.finished_product_id:
            if self.finished_product.brand_id and self.sales_channel.brand_id != self.finished_product.brand_id:
                raise ValidationError({
                    'finished_product': 'Finished product must belong to the same brand as the sales channel.'
                })
        if self.bom_id and self.finished_product_id and self.bom.finished_product_id != self.finished_product_id:
            raise ValidationError({'bom': 'BOM must belong to the selected finished product.'})


class ProductionBatchComponent(models.Model):
    """Component quantities consumed and still tracked as in factory for a batch."""

    production_batch = models.ForeignKey(
        ProductionBatch,
        on_delete=models.CASCADE,
        related_name='components',
    )
    component = models.ForeignKey(
        'products.Product',
        on_delete=models.PROTECT,
        related_name='production_component_lines',
    )
    quantity_sent = models.PositiveIntegerField()
    quantity_consumed = models.PositiveIntegerField(default=0)
    sent_movement = models.OneToOneField(
        InventoryMovement,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='production_component_line',
    )

    class Meta:
        app_label = 'inventory'
        db_table = 'production_batch_component'
        verbose_name = 'Production Batch Component'
        verbose_name_plural = 'Production Batch Components'
        constraints = [
            models.UniqueConstraint(
                fields=['production_batch', 'component'],
                name='unique_component_per_production_batch',
            ),
            models.CheckConstraint(
                check=models.Q(quantity_sent__gt=0),
                name='production_component_quantity_sent_gt_zero',
            ),
            models.CheckConstraint(
                check=models.Q(quantity_consumed__gte=0),
                name='production_component_quantity_consumed_gte_zero',
            ),
            models.CheckConstraint(
                check=models.Q(quantity_consumed__lte=models.F('quantity_sent')),
                name='production_component_consumed_lte_sent',
            ),
        ]
        indexes = [
            models.Index(fields=['production_batch', 'component']),
            models.Index(fields=['component']),
        ]

    def __str__(self):
        return f"{self.production_batch} - {self.component}"

    @property
    def in_factory_quantity(self):
        return max(0, self.quantity_sent - self.quantity_consumed)
