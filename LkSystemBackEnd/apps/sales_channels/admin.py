"""
LkSystem Sales Channels App - Admin Configuration
"""

from django.contrib import admin
from .models import CashMovement, CashSession, SalesChannel


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


@admin.register(CashSession)
class CashSessionAdmin(admin.ModelAdmin):
    list_display = [
        'business_date', 'sales_channel', 'status', 'opening_cash',
        'closing_cash_expected', 'closing_cash_actual', 'cash_difference',
        'opened_by', 'closed_by',
    ]
    list_filter = ['status', 'business_date', 'sales_channel__brand__company']
    search_fields = ['sales_channel__name', 'opened_by__email', 'closed_by__email']
    readonly_fields = [
        'company', 'sales_channel', 'business_date', 'opening_cash',
        'opening_cash_set', 'status', 'opened_at', 'opened_by',
        'closing_cash_expected', 'closing_cash_actual', 'cash_difference',
        'closing_note', 'closed_at', 'closed_by', 'created_at', 'updated_at',
    ]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(CashMovement)
class CashMovementAdmin(admin.ModelAdmin):
    list_display = [
        'occurred_at', 'sales_channel', 'movement_type', 'category', 'amount',
        'created_by', 'is_deleted',
    ]
    list_filter = ['movement_type', 'category', 'is_deleted', 'occurred_at']
    search_fields = ['sales_channel__name', 'note', 'created_by__email']
    readonly_fields = ['created_at', 'updated_at', 'deleted_at', 'deleted_by']
