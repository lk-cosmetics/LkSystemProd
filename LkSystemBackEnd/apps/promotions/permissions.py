"""
LkSystem Promotions App - Permissions
Uses RBAC permissions for authorization checks.
"""

from rest_framework.permissions import BasePermission

from apps.rbac.services import PermissionService


class CanManagePromotions(BasePermission):
    """
    Combined permission using RBAC:
    - Read: requires 'view_promotions'
    - Write: requires 'create_promotions', 'edit_promotions', or 'delete_promotions'
    """
    message = "You don't have permission to manage promotions."

    SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser:
            return True

        perms = PermissionService.get_user_permissions(request.user)

        if request.method in self.SAFE_METHODS:
            return 'view_promotions' in perms

        return bool({'create_promotions', 'edit_promotions', 'delete_promotions'} & perms)

    def has_object_permission(self, request, view, obj):
        if not request.user.is_authenticated:
            return False

        if request.user.is_superuser:
            return True

        # Check brand access
        if obj.brand:
            allowed_brands = request.user.allowed_brands.all()
            if obj.brand not in allowed_brands:
                return False

        return True


class CanViewPromotionAnalytics(BasePermission):
    """Permission for viewing promotion analytics. Requires 'view_reports'."""
    message = "Analytics access restricted."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser:
            return True

        perms = PermissionService.get_user_permissions(request.user)
        return 'view_reports' in perms
