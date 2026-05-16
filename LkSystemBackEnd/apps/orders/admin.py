from django.contrib import admin
from .models import Order, OrderLine


class OrderLineInline(admin.TabularInline):
    model = OrderLine
    extra = 0
    readonly_fields = ['product_name', 'barcode', 'quantity', 'unit_price', 'total']


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = [
        'order_number', 'company', 'sales_channel', 'client',
        'status', 'source', 'total', 'created_at',
    ]
    list_filter = ['company', 'status', 'source', 'payment_status']
    search_fields = ['order_number', 'external_order_id', 'client__email']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [OrderLineInline]
