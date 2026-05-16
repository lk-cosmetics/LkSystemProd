"""
LkSystem Inventory App - Admin Configuration
Django admin interface for inventory management.
"""

from django.contrib import admin
from django.utils.html import format_html
from apps.inventory.models import (
    BillOfMaterials,
    BillOfMaterialsItem,
    InventoryMovement,
    ProductionBatch,
    ProductionBatchComponent,
    SalesChannelInventory,
)


@admin.register(SalesChannelInventory)
class SalesChannelInventoryAdmin(admin.ModelAdmin):
    list_display = [
        'product', 'sales_channel', 'quantity', 'reserved_quantity',
        'available_quantity_display', 'minimum_quantity', 
        'stock_status', 'bin_location', 'updated_at'
    ]
    list_filter = ['sales_channel', 'sales_channel__brand__company']
    search_fields = ['product__name', 'product__barcode', 'sales_channel__name', 'bin_location']
    raw_id_fields = ['product', 'sales_channel']
    ordering = ['sales_channel', 'product__name']
    
    fieldsets = (
        ('Location', {
            'fields': ('sales_channel', 'product', 'bin_location')
        }),
        ('Stock Levels', {
            'fields': ('quantity', 'reserved_quantity', 'minimum_quantity', 'maximum_quantity')
        }),
        ('Audit', {
            'fields': ('last_counted_at',),
            'classes': ('collapse',)
        }),
    )
    
    @admin.display(description='Available')
    def available_quantity_display(self, obj):
        return obj.available_quantity
    
    @admin.display(description='Status')
    def stock_status(self, obj):
        if obj.is_out_of_stock:
            return format_html('<span style="color: red; font-weight: bold;">Out of Stock</span>')
        elif obj.is_low_stock:
            return format_html('<span style="color: orange; font-weight: bold;">Low Stock</span>')
        return format_html('<span style="color: green;">In Stock</span>')


@admin.register(InventoryMovement)
class InventoryMovementAdmin(admin.ModelAdmin):
    list_display = [
        'reference_number', 'movement_type', 'product', 'sales_channel',
        'quantity', 'status', 'created_by', 'created_at'
    ]
    list_filter = ['movement_type', 'status', 'sales_channel', 'created_at']
    search_fields = [
        'reference_number', 'product__name', 'product__barcode',
        'external_reference', 'notes'
    ]
    raw_id_fields = ['product', 'sales_channel', 'destination_channel', 'created_by']
    readonly_fields = [
        'reference_number', 'quantity_before', 'quantity_after',
        'total_cost', 'completed_at', 'related_movement'
    ]
    ordering = ['-created_at']
    date_hierarchy = 'created_at'
    
    fieldsets = (
        ('Reference', {
            'fields': ('reference_number', 'external_reference', 'status')
        }),
        ('Movement Details', {
            'fields': ('sales_channel', 'product', 'movement_type', 'quantity')
        }),
        ('Stock Levels', {
            'fields': ('quantity_before', 'quantity_after'),
            'classes': ('collapse',)
        }),
        ('Cost', {
            'fields': ('unit_cost', 'total_cost'),
            'classes': ('collapse',)
        }),
        ('Transfer', {
            'fields': ('destination_channel', 'related_movement'),
            'classes': ('collapse',)
        }),
        ('Notes', {
            'fields': ('notes',),
            'classes': ('collapse',)
        }),
        ('Audit', {
            'fields': ('created_by', 'completed_at'),
            'classes': ('collapse',)
        }),
    )
    
    def has_change_permission(self, request, obj=None):
        # Completed movements should not be modified
        if obj and obj.status == InventoryMovement.MovementStatus.COMPLETED:
            return False
        return super().has_change_permission(request, obj)


class BillOfMaterialsItemInline(admin.TabularInline):
    model = BillOfMaterialsItem
    extra = 1
    raw_id_fields = ['component']


@admin.register(BillOfMaterials)
class BillOfMaterialsAdmin(admin.ModelAdmin):
    list_display = ['finished_product', 'name', 'version', 'is_active', 'updated_at']
    list_filter = ['is_active', 'finished_product__brand__company']
    search_fields = ['name', 'finished_product__name', 'finished_product__barcode']
    raw_id_fields = ['finished_product', 'created_by']
    inlines = [BillOfMaterialsItemInline]
    ordering = ['-updated_at']


class ProductionBatchComponentInline(admin.TabularInline):
    model = ProductionBatchComponent
    extra = 0
    raw_id_fields = ['component', 'sent_movement']
    readonly_fields = ['quantity_sent', 'quantity_consumed', 'sent_movement']
    can_delete = False


@admin.register(ProductionBatch)
class ProductionBatchAdmin(admin.ModelAdmin):
    list_display = [
        'batch_number', 'finished_product', 'sales_channel', 'status',
        'planned_quantity', 'received_quantity', 'created_at',
    ]
    list_filter = ['status', 'sales_channel', 'sales_channel__brand__company']
    search_fields = ['batch_number', 'finished_product__name', 'notes']
    raw_id_fields = ['sales_channel', 'finished_product', 'bom', 'created_by']
    readonly_fields = ['batch_number', 'sent_at', 'completed_at']
    inlines = [ProductionBatchComponentInline]
    ordering = ['-created_at']
