"""
LkSystem Company App - Admin Configuration
"""

from django.contrib import admin
from django.utils.html import format_html
from .models import Company


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    """Admin configuration for Company model."""
    
    list_display = [
        'name',
        'abbreviation',
        'legal_name',
        'city',
        'is_active',
        'logo_preview',
        'created_at'
    ]
    list_filter = ['is_active', 'city', 'created_at']
    search_fields = ['name', 'legal_name', 'abbreviation', 'email']
    readonly_fields = ['created_at', 'updated_at', 'logo_preview_large']
    ordering = ['name']
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('name', 'legal_name', 'abbreviation', 'logo', 'logo_preview_large')
        }),
        ('Legal & Tax', {
            'fields': ('matricule_fiscale', 'registre_commerce', 'activity_code'),
            'classes': ('collapse',)
        }),
        ('Banking', {
            'fields': ('bank_name', 'rib'),
            'classes': ('collapse',)
        }),
        ('Contact', {
            'fields': ('address', 'city', 'phone', 'email')
        }),
        ('Status', {
            'fields': ('is_active',)
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
