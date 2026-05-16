"""
LkSystem Sales Channels App - Admin Configuration
"""

from django.contrib import admin
from .models import SalesChannel


@admin.register(SalesChannel)
class SalesChannelAdmin(admin.ModelAdmin):
    """Admin configuration for SalesChannel model."""
    
    list_display = [
        'name',
        'code',
        'brand',
        'get_company',
        'channel_type',
        'store_type',
        'is_active',
        'is_default',
        'created_at'
    ]
    list_filter = ['channel_type', 'store_type', 'is_active', 'is_default', 'brand__company', 'created_at']
    search_fields = ['name', 'code', 'brand__name', 'brand__company__name', 'city']
    readonly_fields = ['created_at', 'updated_at']
    autocomplete_fields = ['brand']
    ordering = ['brand', 'name']
    
    fieldsets = (
        ('Channel Information', {
            'fields': ('brand', 'name', 'code', 'channel_type', 'store_type', 'is_active', 'is_default')
        }),
        ('Location Details', {
            'fields': ('address', 'city', 'phone', 'email'),
            'classes': ('collapse',)
        }),
        ('Configuration', {
            'fields': ('wc_store_url', 'wc_consumer_key', 'wc_consumer_secret', 'wc_webhook_token'),
            'description': 'JSON configuration for API keys, warehouse IDs, etc.'
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    def get_company(self, obj):
        """Display the parent company name."""
        return obj.brand.company.name
    get_company.short_description = 'Company'
    get_company.admin_order_field = 'brand__company__name'
