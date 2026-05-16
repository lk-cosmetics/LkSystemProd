from django.contrib import admin
from .models import Client


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ['email', 'first_name', 'last_name', 'company', 'brand', 'source', 'created_at']
    list_filter = ['company', 'brand', 'source', 'is_active', 'is_blocked']
    search_fields = ['email', 'first_name', 'last_name', 'phone']
    readonly_fields = ['created_at', 'updated_at']
