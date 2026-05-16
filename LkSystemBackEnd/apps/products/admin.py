"""
LkSystem Products App - Admin Configuration
"""

from django.contrib import admin
from .models import Product, ProductAuditLog


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'barcode', 'brand', 'product_type', 'status',
        'purchase_price', 'sales_price', 'is_deleted', 'created_at',
    ]
    list_filter = ['brand', 'product_type', 'status', 'is_deleted', 'created_at']
    search_fields = ['name', 'barcode', 'wc_product_id']
    readonly_fields = [
        'wc_product_id', 'last_synced_at', 'wc_date_created', 'wc_date_modified',
        'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by',
    ]
    ordering = ['-created_at']

    def get_queryset(self, request):
        return Product.all_objects.select_related('brand')

    fieldsets = (
        ('Core', {
            'fields': ('name', 'barcode', 'image_url', 'product_link', 'product_type', 'status', 'brand'),
        }),
        ('Pricing', {
            'fields': ('purchase_price', 'sales_price'),
        }),
        ('Sync Metadata', {
            'fields': ('wc_product_id', 'last_synced_at', 'wc_date_created', 'wc_date_modified'),
            'classes': ('collapse',),
        }),
        ('Soft Delete', {
            'fields': ('is_deleted', 'deleted_at', 'deleted_by'),
            'classes': ('collapse',),
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )


@admin.register(ProductAuditLog)
class ProductAuditLogAdmin(admin.ModelAdmin):
    list_display = ['product', 'action', 'user', 'timestamp']
    list_filter = ['action', 'timestamp']
    search_fields = ['product__name']
    readonly_fields = ['product', 'user', 'action', 'changes', 'timestamp']
    ordering = ['-timestamp']
