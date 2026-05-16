"""
BI dashboard permission classes.

The executive dashboard is restricted to Super Admin and CEO roles only.
Tenant scoping (CEO sees only their company) is enforced in each view's
querying logic via ``scope_request_to_user``.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from apps.rbac.services import PermissionService


BI_DASHBOARD_PERMISSION = 'view_bi_dashboard'


class IsBIUser(BasePermission):
    """Authenticated user with the ``view_bi_dashboard`` permission."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        perms = PermissionService.get_user_permissions(
            user,
            company=getattr(user, 'current_company', None),
        )
        return BI_DASHBOARD_PERMISSION in perms


def is_platform_admin(user) -> bool:
    """True if the user can see any company (Super Admin / Django superuser)."""

    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    # Platform-scoped role membership (e.g., "Super Admin")
    return user.user_roles.filter(role__scope_type='platform').exists()


def scope_request_to_user(user, requested_company_id, requested_brand_id):
    """
    Resolve effective (company_id, brand_id) for the request.

    - Platform admin: may pass any company/brand (None == aggregate all visible).
    - Company-scoped user: forced to their ``current_company``; brand must be
      one they are allowed to see (or any if they have ``switch_brands``).

    Returns (company_id, brand_id) where either may be None to mean "all".
    """

    if is_platform_admin(user):
        return (
            int(requested_company_id) if requested_company_id else None,
            int(requested_brand_id) if requested_brand_id else None,
        )

    # Company-scoped: lock company to user's current company
    company_id = getattr(user, 'current_company_id', None)
    if not company_id:
        return None, None

    allowed_brand_ids = set(
        user.allowed_brands.values_list('id', flat=True)
    ) if hasattr(user, 'allowed_brands') else set()

    brand_id = int(requested_brand_id) if requested_brand_id else None
    if brand_id and allowed_brand_ids and brand_id not in allowed_brand_ids:
        # Requested a brand the user can't see → fall back to first allowed
        brand_id = next(iter(allowed_brand_ids), None)

    return company_id, brand_id
