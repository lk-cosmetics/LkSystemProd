from django.contrib import admin

from .models import AppPermission, Role, UserRole


@admin.register(AppPermission)
class AppPermissionAdmin(admin.ModelAdmin):
    list_display = ('codename', 'name', 'category')
    list_filter = ('category',)
    search_fields = ('codename', 'name')
    ordering = ('category', 'codename')


class PermissionInline(admin.TabularInline):
    model = Role.permissions.through
    extra = 0


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'scope_type', 'company', 'is_system', 'created_at')
    list_filter = ('scope_type', 'is_system', 'company')
    search_fields = ('name',)
    filter_horizontal = ('permissions',)


@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'role', 'company', 'brand', 'sales_channel',
        'assigned_by', 'assigned_at',
    )
    list_filter = ('role', 'company')
    search_fields = ('user__matricule', 'user__email', 'role__name')
    raw_id_fields = ('user', 'assigned_by')
