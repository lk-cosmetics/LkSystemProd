"""
LkSystem Categories App - Models
Category entity synchronized with WooCommerce.
"""

from django.db import models
from django.conf import settings


class Category(models.Model):
    """
    Category model synchronized with WooCommerce.
    
    This model serves as a local clone of WooCommerce categories,
    enabling offline access and faster queries while maintaining
    synchronization via REST API and Webhooks.
    """
    
    # WooCommerce Reference
    wc_category_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='WooCommerce Category ID',
        help_text='Identifier from WooCommerce (unique per sales channel). '
                  'NULL for categories created manually in-app.'
    )
    
    # Sales Channel Reference (for multi-store support)
    sales_channel = models.ForeignKey(
        'sales_channels.SalesChannel',
        on_delete=models.CASCADE,
        related_name='categories',
        verbose_name='Sales Channel',
        help_text='The WooCommerce store this category belongs to'
    )
    
    # Category Information
    name = models.CharField(
        max_length=255,
        verbose_name='Category Name'
    )
    slug = models.SlugField(
        max_length=255,
        verbose_name='URL Slug',
        help_text='URL-friendly version of the category name'
    )
    description = models.TextField(
        blank=True,
        default='',
        verbose_name='Description',
        help_text='Category description from WooCommerce'
    )
    
    # Hierarchical Structure
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
        verbose_name='Parent Category',
        help_text='Parent category for hierarchical structure'
    )
    # Category Image
    image_url = models.URLField(
        max_length=500,
        blank=True,
        default='',
        verbose_name='Image URL',
        help_text='Category image URL (from WooCommerce, or mirrored from an upload).'
    )
    image = models.ImageField(
        upload_to='categories/images/',
        blank=True,
        null=True,
        verbose_name='Image',
        help_text='Uploaded category image; its served URL is mirrored into image_url.'
    )
    
    # Display Order
    display_order = models.PositiveIntegerField(
        default=0,
        verbose_name='Display Order',
        help_text='Menu order from WooCommerce'
    )
    
    # Sync Metadata
    last_synced_at = models.DateTimeField(
        auto_now=True,
        verbose_name='Last Synced At',
        help_text='Timestamp of last synchronization with WooCommerce'
    )
    
    # Audit Trail
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='categories_created',
        verbose_name='Created By'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='categories_updated',
        verbose_name='Updated By'
    )
    
    class Meta:
        app_label = 'categories'
        db_table = 'category'
        verbose_name = 'Category'
        verbose_name_plural = 'Categories'
        ordering = ['display_order', 'name']
        unique_together = ['sales_channel', 'wc_category_id']
        indexes = [
            models.Index(fields=['wc_category_id']),
            models.Index(fields=['slug']),
            models.Index(fields=['sales_channel', 'name']),
        ]
    
    def __str__(self):
        return f"{self.name} (WC#{self.wc_category_id})"
    
    @property
    def brand(self):
        """Shortcut to get the parent brand through sales_channel."""
        return self.sales_channel.brand
    
    @property
    def company(self):
        """Shortcut to get the parent company through sales_channel."""
        return self.sales_channel.brand.company
