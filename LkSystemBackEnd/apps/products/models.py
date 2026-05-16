"""
LkSystem Products App - Models
Product entity with soft delete and audit trail.
"""

from django.db import models
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from decimal import Decimal


class ProductManager(models.Manager):
    """Default manager that excludes soft-deleted products."""

    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class AllProductsManager(models.Manager):
    """Manager that includes soft-deleted products."""
    pass


class Product(models.Model):
    """
    Simplified Product model with soft delete support.

    Only essential fields are kept.  The audit trail lives in
    ``ProductAuditLog`` for full history tracking.
    """

    class ProductType(models.TextChoices):
        RESELL = 'resell', 'Resell Product'
        PACKAGING = 'packaging', 'Packaging / Emballage'
        FINISHED = 'finished', 'Finished Product'
        COMPONENT = 'component', 'Component'
        RAW_MATERIAL = 'raw_material', 'Raw Material'

    class ProductStatus(models.TextChoices):
        PUBLISH = 'publish', 'Published'
        DRAFT = 'draft', 'Draft'
        PENDING = 'pending', 'Pending Review'
        PRIVATE = 'private', 'Private'

    # ── WooCommerce Reference ────────────────────────────────────────────
    wc_product_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        default=None,
        verbose_name='WooCommerce Product ID',
        help_text='Unique identifier from WooCommerce (null for local-only products)',
    )

    # ── Core Fields ──────────────────────────────────────────────────────
    name = models.CharField(max_length=255, verbose_name='Product Name')
    image_url = models.CharField(
        max_length=500, blank=True, default='',
        verbose_name='Image URL',
    )
    product_link = models.URLField(
        max_length=500, blank=True, default='',
        verbose_name='Product Link',
        help_text='External link to the product page',
    )
    barcode = models.CharField(
        max_length=100, blank=True, default='',
        verbose_name='Barcode (SKU)',
    )
    product_type = models.CharField(
        max_length=20,
        choices=ProductType.choices,
        default=ProductType.RESELL,
        verbose_name='Product Type',
    )
    status = models.CharField(
        max_length=20,
        choices=ProductStatus.choices,
        default=ProductStatus.PUBLISH,
        verbose_name='Status',
    )

    # ── Pricing ──────────────────────────────────────────────────────────
    purchase_price = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0.00'),
        verbose_name='Purchase Price',
    )
    sales_price = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0.00'),
        verbose_name='Sales Price',
    )

    # ── Pack / Bundle ─────────────────────────────────────────────────────
    is_pack = models.BooleanField(
        default=False,
        verbose_name='Is Pack / Bundle',
        help_text='Whether this product is a pack composed of other products',
    )
    pack_items = models.JSONField(
        null=True, blank=True,
        verbose_name='Pack Items',
        help_text='JSON list: [{"product_id": int, "quantity": int}, ...]',
    )

    # ── Relationships ────────────────────────────────────────────────────
    brand = models.ForeignKey(
        'brands.Brand',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='products',
        verbose_name='Brand',
    )
    categories = models.ManyToManyField(
        'categories.Category',
        blank=True,
        related_name='products',
        verbose_name='Categories',
        help_text='Product categories synchronized from WooCommerce',
    )

    # ── Sync Metadata ────────────────────────────────────────────────────
    last_synced_at = models.DateTimeField(
        null=True, blank=True,
        verbose_name='Last Synced At',
    )
    wc_date_created = models.DateTimeField(
        null=True, blank=True,
        verbose_name='WC Date Created',
    )
    wc_date_modified = models.DateTimeField(
        null=True, blank=True,
        verbose_name='WC Date Modified',
    )

    # ── Timestamps ───────────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Soft Delete ──────────────────────────────────────────────────────
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='products_deleted',
    )

    # ── Managers ─────────────────────────────────────────────────────────
    objects = ProductManager()
    all_objects = AllProductsManager()

    class Meta:
        app_label = 'products'
        db_table = 'product'
        verbose_name = 'Product'
        verbose_name_plural = 'Products'
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['brand', 'wc_product_id'],
                condition=models.Q(wc_product_id__isnull=False),
                name='unique_wc_product_per_brand',
            ),
        ]
        indexes = [
            models.Index(fields=['wc_product_id']),
            models.Index(fields=['barcode']),
            models.Index(fields=['brand', 'name']),
            models.Index(fields=['product_type']),
            models.Index(fields=['is_deleted', 'created_at']),
        ]

    def __str__(self):
        return self.name

    @property
    def company(self):
        return self.brand.company if self.brand else None

    @property
    def profit_margin(self):
        """Profit margin percentage (None when purchase_price is 0)."""
        if self.purchase_price and self.purchase_price > 0:
            profit = self.sales_price - self.purchase_price
            return (profit / self.purchase_price) * 100
        return None

    # ── Pack Validation ──────────────────────────────────────────────────

    def clean(self):
        super().clean()
        if self.is_pack:
            self._validate_pack_items()
        elif self.pack_items:
            raise ValidationError({'pack_items': 'pack_items must be empty when is_pack is False.'})

    def _validate_pack_items(self):
        """Strict validation of pack_items structure and references."""
        items = self.pack_items
        if not items or not isinstance(items, list):
            raise ValidationError({'pack_items': 'A pack must have at least one item.'})

        seen_ids = set()
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValidationError({'pack_items': f'Item {i} must be an object.'})

            pid = item.get('product_id')
            qty = item.get('quantity')

            if not isinstance(pid, int) or pid <= 0:
                raise ValidationError({'pack_items': f'Item {i}: product_id must be a positive integer.'})
            if not isinstance(qty, int) or qty <= 0:
                raise ValidationError({'pack_items': f'Item {i}: quantity must be a positive integer.'})

            # Self-reference
            if self.pk and pid == self.pk:
                raise ValidationError({'pack_items': 'A pack cannot contain itself.'})

            # Duplicates
            if pid in seen_ids:
                raise ValidationError({'pack_items': f'Duplicate product_id {pid} in pack items.'})
            seen_ids.add(pid)

        # Validate all referenced products exist and are not deleted
        existing = set(
            Product.objects.filter(pk__in=seen_ids).values_list('pk', flat=True)
        )
        missing = seen_ids - existing
        if missing:
            raise ValidationError({'pack_items': f'Product IDs not found: {sorted(missing)}'})

        # Prevent circular references: none of the children should be packs
        # that contain this product (direct or transitive)
        if self.pk:
            self._check_circular(seen_ids)

    def _check_circular(self, child_ids):
        """Prevent circular pack references (BFS)."""
        visited = set()
        queue = list(child_ids)
        while queue:
            cid = queue.pop(0)
            if cid in visited:
                continue
            visited.add(cid)
            try:
                child = Product.objects.get(pk=cid)
            except Product.DoesNotExist:
                continue
            if child.is_pack and child.pack_items:
                for item in child.pack_items:
                    grandchild_id = item.get('product_id')
                    if grandchild_id == self.pk:
                        raise ValidationError({
                            'pack_items': f'Circular reference detected via product {cid}.'
                        })
                    if grandchild_id not in visited:
                        queue.append(grandchild_id)

    def get_pack_stock(self, sales_channel_id=None):
        """
        Compute available pack quantity per sales channel.

        Returns dict: {channel_id: available_qty, ...}
        For a specific channel, returns {channel_id: qty}.

        Formula: floor(min(child_available / child_required_qty))
        """
        if not self.is_pack or not self.pack_items:
            return {}

        from apps.inventory.models import SalesChannelInventory

        child_map = {item['product_id']: item['quantity'] for item in self.pack_items}
        child_ids = list(child_map.keys())

        inv_qs = SalesChannelInventory.objects.filter(product_id__in=child_ids)
        if sales_channel_id:
            inv_qs = inv_qs.filter(sales_channel_id=sales_channel_id)

        # Group inventory by channel
        channel_data = {}  # {channel_id: {product_id: available_qty}}
        for inv in inv_qs.select_related():
            ch = inv.sales_channel_id
            if ch not in channel_data:
                channel_data[ch] = {}
            channel_data[ch][inv.product_id] = inv.available_quantity

        result = {}
        for ch_id, stock_map in channel_data.items():
            min_sets = None
            for pid, required_qty in child_map.items():
                available = stock_map.get(pid, 0)
                sets = available // required_qty
                if min_sets is None or sets < min_sets:
                    min_sets = sets
            result[ch_id] = max(min_sets or 0, 0)

        return result

    # ── Soft Delete Methods ──────────────────────────────────────────────

    def soft_delete(self, user=None):
        """Mark product as deleted without physical removal."""
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.deleted_by = user
        self.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'updated_at'])

        ProductAuditLog.objects.create(
            product=self,
            user=user,
            action=ProductAuditLog.Action.DELETE,
        )

    def restore(self, user=None):
        """Restore a soft-deleted product."""
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by = None
        self.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'updated_at'])

        ProductAuditLog.objects.create(
            product=self,
            user=user,
            action=ProductAuditLog.Action.RESTORE,
        )


class ProductAuditLog(models.Model):
    """Immutable audit trail for product changes."""

    class Action(models.TextChoices):
        CREATE = 'create', 'Created'
        UPDATE = 'update', 'Updated'
        DELETE = 'delete', 'Soft Deleted'
        RESTORE = 'restore', 'Restored'

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='audit_logs',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    action = models.CharField(max_length=10, choices=Action.choices)
    changes = models.JSONField(
        null=True, blank=True,
        help_text='JSON dict of changed fields: {field: [old, new]}',
    )
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        app_label = 'products'
        db_table = 'product_audit_log'
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.get_action_display()} – {self.product.name} @ {self.timestamp:%Y-%m-%d %H:%M}"
