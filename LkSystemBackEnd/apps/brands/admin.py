"""
LkSystem Brands App - Admin Configuration
"""

from django.contrib import admin
from django.utils.html import format_html
from .models import Brand


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    """Admin configuration for Brand model."""
    
    list_display = ['name', 'company', 'logo_preview', 'channels_count', 'created_at']
    list_filter = ['company', 'created_at']
    search_fields = ['name', 'company__name', 'company__abbreviation']
    readonly_fields = ['created_at', 'updated_at', 'logo_preview_large']
    autocomplete_fields = ['company']
    ordering = ['company', 'name']
    
    fieldsets = (
        ('Brand Information', {
            'fields': ('company', 'name', 'logo', 'logo_preview_large')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    def logo_preview(self, obj):
        """Display a small logo thumbnail in list view."""
        if obj.logo:
            return format_html(
                '<img src="{}" style="max-height: 30px; max-width: 50px;" />',
                obj.logo.url
            )
        return '-'
    logo_preview.short_description = 'Logo'
    
    def logo_preview_large(self, obj):
        """Display a larger logo preview in detail view."""
        if obj.logo:
            return format_html(
                '<img src="{}" style="max-height: 100px; max-width: 200px;" />',
                obj.logo.url
            )
        return 'No logo uploaded'
    logo_preview_large.short_description = 'Current Logo'
    
    def channels_count(self, obj):
        """Display count of sales channels for this brand."""
        return obj.sales_channels.count()
    channels_count.short_description = 'Channels'
