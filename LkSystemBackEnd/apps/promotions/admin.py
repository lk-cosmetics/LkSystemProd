"""
LkSystem Promotions App - Django Admin Configuration
"""

from django.contrib import admin
from .models import Promotion, PromotionChannelRule


class PromotionChannelRuleInline(admin.TabularInline):
    """Inline admin for channel rules within Promotion."""
    model = PromotionChannelRule
    extra = 1
    fields = [
        'sales_channel',
        'discount_value',
        'is_enabled',
        'channel_priority',
        'channel_max_usage',
        'channel_current_usage',
    ]
    readonly_fields = ['channel_current_usage']
    autocomplete_fields = ['sales_channel']


@admin.register(Promotion)
class PromotionAdmin(admin.ModelAdmin):
    """Admin configuration for Promotion model."""
    
    list_display = [
        'name',
        'code',
        'product',
        'brand',
        'discount_type',
        'default_discount_value',
        'status',
        'is_active',
        'start_date',
        'end_date',
        'current_usage',
        'created_at',
    ]
    
    list_filter = [
        'status',
        'is_active',
        'discount_type',
        'brand',
        'is_stackable',
        'created_at',
    ]
    
    search_fields = [
        'name',
        'code',
        'description',
        'product__name',
    ]
    
    readonly_fields = [
        'current_usage',
        'created_at',
        'updated_at',
        'created_by',
        'updated_by',
    ]
    
    autocomplete_fields = [
        'product',
        'brand',
    ]
    
    fieldsets = (
        (None, {
            'fields': ('name', 'description', 'code')
        }),
        ('Product & Brand', {
            'fields': ('product', 'brand')
        }),
        ('Discount Configuration', {
            'fields': ('discount_type', 'default_discount_value')
        }),
        ('Schedule', {
            'fields': ('start_date', 'end_date')
        }),
        ('Status & Control', {
            'fields': ('status', 'is_active', 'priority', 'is_stackable')
        }),
        ('Usage Limits', {
            'fields': ('max_usage', 'current_usage')
        }),
        ('Audit', {
            'fields': ('created_by', 'updated_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    inlines = [PromotionChannelRuleInline]
    
    def save_model(self, request, obj, form, change):
        """Set created_by/updated_by on save."""
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(PromotionChannelRule)
class PromotionChannelRuleAdmin(admin.ModelAdmin):
    """Admin configuration for PromotionChannelRule model."""
    
    list_display = [
        'promotion',
        'sales_channel',
        'discount_value',
        'is_enabled',
        'channel_priority',
        'channel_max_usage',
        'channel_current_usage',
    ]
    
    list_filter = [
        'is_enabled',
        'promotion__status',
        'sales_channel',
    ]
    
    search_fields = [
        'promotion__name',
        'sales_channel__name',
    ]
    
    readonly_fields = [
        'channel_current_usage',
        'created_at',
        'updated_at',
    ]
    
    autocomplete_fields = [
        'promotion',
        'sales_channel',
    ]
