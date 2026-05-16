"""
LkSystem Categories App - Admin Configuration
"""

from django.contrib import admin
from .models import Category


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    """Admin configuration for Category model."""
    
    list_display = [
        'name',
        'wc_category_id',
        'sales_channel',
        'parent',
        'display_order',
        'last_synced_at',
    ]
    list_filter = [
        'sales_channel',
        'sales_channel__brand',
        'created_at',
    ]
    search_fields = [
        'name',
        'slug',
        'description',
        'wc_category_id',
    ]
    readonly_fields = [
        'wc_category_id',
        'last_synced_at',
        'created_at',
        'updated_at',
        'created_by',
        'updated_by',
    ]
    ordering = ['sales_channel', 'display_order', 'name']
    
    fieldsets = (
        ('WooCommerce Reference', {
            'fields': ('wc_category_id', 'sales_channel')
        }),
        ('Category Information', {
            'fields': ('name', 'slug', 'description', 'image_url')
        }),
        ('Hierarchy', {
            'fields': ('parent', 'display_order')
        }),
        ('Audit Trail', {
            'fields': ('created_at', 'updated_at', 'created_by', 'updated_by', 'last_synced_at'),
            'classes': ('collapse',)
        }),
    )
