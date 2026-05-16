"""
LkSystem Users App - Admin Configuration
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html

from .models import User, Profile


class ProfileInline(admin.StackedInline):
    """Inline admin for Profile within User."""
    model = Profile
    can_delete = False
    verbose_name_plural = 'Profile'
    fk_name = 'user'
    
    fieldsets = (
        ('Identity', {
            'fields': ('cin_number', 'cin_front', 'cin_back', 'passport_number', 'passport_image')
        }),
        ('Personal Information', {
            'fields': ('birth_date', 'gender', 'nationality', 'avatar')
        }),
        ('Contact', {
            'fields': ('phone', 'emergency_phone', 'emergency_contact_name', 'address', 'city', 'postal_code')
        }),
        ('Education', {
            'fields': ('education_level', 'diploma_title', 'institution', 'graduation_year', 'diploma_file')
        }),
        ('Status', {
            'fields': ('is_complete',),
            'classes': ('collapse',)
        }),
    )
    readonly_fields = ['is_complete']


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Admin configuration for custom User model."""
    
    list_display = [
        'matricule',
        'email',
        'get_full_name',
        'current_company',
        'is_active',
        'can_switch',
        'date_joined'
    ]
    list_filter = ['is_active', 'is_staff', 'current_company', 'date_joined']
    search_fields = ['matricule', 'email', 'first_name', 'last_name']
    ordering = ['matricule']
    filter_horizontal = ['allowed_brands']
    readonly_fields = ['date_joined', 'last_login', 'updated_at']
    inlines = [ProfileInline]
    
    fieldsets = (
        ('Authentication', {
            'fields': ('matricule', 'email', 'password')
        }),
        ('Personal Information', {
            'fields': ('first_name', 'last_name')
        }),
        ('Organization', {
            'fields': ('current_company', 'allowed_brands')
        }),
        ('Permissions', {
            'fields': ('is_active', 'is_staff', 'is_superuser'),
            'classes': ('collapse',)
        }),
        ('Timestamps', {
            'fields': ('date_joined', 'last_login', 'updated_at'),
            'classes': ('collapse',)
        }),
    )

    add_fieldsets = (
        ('Authentication', {
            'classes': ('wide',),
            'fields': ('matricule', 'email', 'password1', 'password2'),
        }),
        ('Personal Information', {
            'fields': ('first_name', 'last_name')
        }),
        ('Organization', {
            'fields': ('current_company', 'allowed_brands')
        }),
    )
    
    def can_switch(self, obj):
        """Display if user can switch brands via RBAC."""
        from apps.rbac.services import PermissionService
        if 'switch_brands' in PermissionService.get_user_permissions(obj):
            return format_html('<span style="color: green;">✓</span>')
        return format_html('<span style="color: red;">✗</span>')
    can_switch.short_description = 'Can Switch Brands'


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    """Admin configuration for Profile model."""
    
    list_display = [
        'user',
        'cin_number',
        'phone',
        'city',
        'education_level',
        'is_complete',
        'completion_display'
    ]
    list_filter = ['is_complete', 'gender', 'education_level', 'city']
    search_fields = ['user__matricule', 'user__email', 'cin_number', 'phone']
    readonly_fields = ['is_complete', 'completion_percentage', 'created_at', 'updated_at']
    autocomplete_fields = ['user']
    
    fieldsets = (
        ('User', {
            'fields': ('user',)
        }),
        ('Identity Documents', {
            'fields': ('cin_number', 'cin_front', 'cin_back', 'passport_number', 'passport_image')
        }),
        ('Personal Information', {
            'fields': ('birth_date', 'gender', 'nationality', 'avatar')
        }),
        ('Contact Information', {
            'fields': ('phone', 'emergency_phone', 'emergency_contact_name', 'address', 'city', 'postal_code')
        }),
        ('Education', {
            'fields': ('education_level', 'diploma_title', 'institution', 'graduation_year', 'diploma_file')
        }),
        ('Status', {
            'fields': ('is_complete', 'completion_percentage'),
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    def completion_display(self, obj):
        """Display completion percentage with color coding."""
        percentage = obj.get_completion_percentage()
        if percentage >= 80:
            color = 'green'
        elif percentage >= 50:
            color = 'orange'
        else:
            color = 'red'
        return format_html(
            '<span style="color: {};">{}%</span>',
            color,
            int(percentage)
        )
    completion_display.short_description = 'Completion'
    
    def completion_percentage(self, obj):
        return f"{obj.get_completion_percentage()}%"
    completion_percentage.short_description = 'Profile Completion'
