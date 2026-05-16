from django.contrib import admin

from .models import DailyBrandChannelStats, DailyProductResaleStats


@admin.register(DailyBrandChannelStats)
class DailyBrandChannelStatsAdmin(admin.ModelAdmin):
    list_display = ('date', 'company', 'brand', 'sales_channel',
                    'revenue', 'orders_count', 'customers_count', 'updated_at')
    list_filter = ('company', 'brand', 'sales_channel', 'date')
    date_hierarchy = 'date'
    search_fields = ('company__name', 'brand__name', 'sales_channel__name')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(DailyProductResaleStats)
class DailyProductResaleStatsAdmin(admin.ModelAdmin):
    list_display = ('date', 'company', 'brand', 'resale_type',
                    'sales_count', 'quantity_sold', 'revenue', 'updated_at')
    list_filter = ('company', 'brand', 'resale_type', 'date')
    date_hierarchy = 'date'
    search_fields = ('company__name', 'brand__name')
    readonly_fields = ('created_at', 'updated_at')
