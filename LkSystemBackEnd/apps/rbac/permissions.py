"""
LkSystem RBAC — DRF permission classes.

Usage in ViewSets
-----------------

**Option A — mixin (recommended for ViewSets):**

    class ProductViewSet(RBACMixin, ModelViewSet):
        rbac_permissions_map = {
            'list':     ['view_products'],
            'retrieve': ['view_products'],
            'create':   ['create_products'],
            'update':   ['edit_products'],
            'destroy':  ['delete_products'],
        }

**Option B — standalone class factory:**

    class ProductViewSet(ModelViewSet):
        permission_classes = [require_permission('edit_products')]

**Option C — decorator on custom actions:**

    @action(detail=False, permission_classes=[require_permission('export_data')])
    def export(self, request):
        ...
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from .services import PermissionService


# ── Class factory ───────────────────────────────────────────────────────

def require_permission(*codenames: str, require_all: bool = True):
    """
    Return a DRF permission class that enforces the given codenames.

    Example::

        permission_classes = [require_permission('edit_products')]
    """

    class _DynamicPermission(BasePermission):
        def has_permission(self, request, view):
            user = request.user
            if not user or not user.is_authenticated:
                return False
            if user.is_superuser:
                return True

            # Capability gate: does the user hold the permission anywhere within
            # their active company (company-wide, brand, or channel role)? Each
            # viewset scopes the data it returns to the user's visible
            # brands/channels, so a brand-scoped user (e.g. Brand Manager)
            # correctly passes here without gaining any cross-company access.
            perms = PermissionService.get_capability_permissions(
                user,
                company=getattr(user, 'current_company', None),
            )
            if require_all:
                return set(codenames) <= perms
            return bool(set(codenames) & perms)

    _DynamicPermission.__name__ = (
        f'RequireAll_{"_".join(codenames)}'
        if require_all
        else f'RequireAny_{"_".join(codenames)}'
    )
    _DynamicPermission.__qualname__ = _DynamicPermission.__name__
    return _DynamicPermission


# ── ViewSet mixin ───────────────────────────────────────────────────────

class RBACMixin:
    """
    Mixin that maps ViewSet actions → required permission codenames.

    Set ``rbac_permissions_map`` on the ViewSet::

        rbac_permissions_map = {
            'list':     ['view_products'],
            'create':   ['manage_products'],
            'my_action': ['view_reports', 'export_data'],
        }
    """

    rbac_permissions_map: dict[str, list[str]] = {}

    def get_permissions(self):
        action = getattr(self, 'action', None)
        codenames = self.rbac_permissions_map.get(action, [])

        if codenames:
            return [require_permission(*codenames)()]

        # Fall back to the default permission classes on the view
        return super().get_permissions()  # type: ignore[misc]


# ── Convenience classes (can be used directly) ──────────────────────────

class IsRBACAuthenticated(BasePermission):
    """Authenticated + has at least one RBAC role assigned."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return user.user_roles.exists()
