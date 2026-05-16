"""
LkSystem RBAC — Permission checking service.

Central authority for answering "does user X have permission Y in scope Z?"
Permissions cascade downward:  Platform → Company → Brand → Channel.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from django.db.models import Q

from .models import AppPermission, UserRole

if TYPE_CHECKING:
    from apps.brands.models import Brand
    from apps.company.models import Company
    from apps.sales_channels.models import SalesChannel
    from django.contrib.auth import get_user_model

    User = get_user_model()


class PermissionService:
    """Stateless helper — every method is a ``@staticmethod``."""

    # ── Core queries ────────────────────────────────────────────────────

    @staticmethod
    def get_user_permissions(
        user,
        *,
        company=None,
        brand=None,
        sales_channel=None,
    ) -> set[str]:
        """
        Return the set of permission codenames a user holds
        at the given scope, including everything inherited from
        higher scopes.

        Passing no scope kwargs returns *all* permissions the user
        holds across every scope (union).
        """
        if not user.is_authenticated:
            return set()

        if user.is_superuser:
            return set(
                AppPermission.objects.values_list('codename', flat=True)
            )

        assignments = UserRole.objects.filter(user=user)

        # If a specific scope was requested, filter assignments
        # to only those that *cover* that scope (cascade logic).
        if sales_channel or brand or company:
            scope_q = Q(
                company__isnull=True,
                brand__isnull=True,
                sales_channel__isnull=True,
            )  # Platform-level always matches

            effective_company = company
            effective_brand = brand

            if sales_channel:
                scope_q |= Q(sales_channel=sales_channel)
                effective_brand = effective_brand or sales_channel.brand
                effective_company = (
                    effective_company
                    or getattr(effective_brand, 'company', None)
                )

            if effective_brand:
                scope_q |= Q(
                    brand=effective_brand,
                    sales_channel__isnull=True,
                )
                effective_company = (
                    effective_company or effective_brand.company
                )

            if effective_company:
                scope_q |= Q(
                    company=effective_company,
                    brand__isnull=True,
                    sales_channel__isnull=True,
                )

            assignments = assignments.filter(scope_q)

        return set(
            AppPermission.objects.filter(
                roles__assignments__in=assignments,
            )
            .values_list('codename', flat=True)
            .distinct()
        )

    # ── Convenience checks ──────────────────────────────────────────────

    @staticmethod
    def has_permission(user, codename: str, **scope_kwargs) -> bool:
        """Does the user hold a single permission (optionally scoped)?"""
        if user.is_superuser:
            return True
        return codename in PermissionService.get_user_permissions(
            user, **scope_kwargs
        )

    @staticmethod
    def has_any_permission(
        user, codenames: list[str], **scope_kwargs
    ) -> bool:
        if user.is_superuser:
            return True
        perms = PermissionService.get_user_permissions(user, **scope_kwargs)
        return bool(perms & set(codenames))

    @staticmethod
    def has_all_permissions(
        user, codenames: list[str], **scope_kwargs
    ) -> bool:
        if user.is_superuser:
            return True
        perms = PermissionService.get_user_permissions(user, **scope_kwargs)
        return set(codenames) <= perms

    # ── Role queries ────────────────────────────────────────────────────

    @staticmethod
    def get_user_role_names(user) -> list[str]:
        """Return the names of every role assigned to the user."""
        if not user.is_authenticated:
            return []
        return list(
            UserRole.objects.filter(user=user)
            .values_list('role__name', flat=True)
            .distinct()
        )

    @staticmethod
    def get_user_assignments(user):
        """Return all UserRole rows for the user (select-related)."""
        return (
            UserRole.objects.filter(user=user)
            .select_related('role', 'company', 'brand', 'sales_channel')
            .order_by('role__name')
        )
