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


def scope_kwargs_for_role(role, *, company=None, brands=None, sales_channel=None):
    """
    Produce the scope kwargs for a ``UserRole`` row so its ``company`` /
    ``brand`` / ``sales_channel`` columns line up with ``role.scope_type``.

    The permission resolver in ``PermissionService.get_user_permissions``
    matches assignments at scope X with these rules:

        * platform-level assignment   (all-null)            → always matches
        * company-level assignment    (company set, rest null) → matches when
                                                                asked about
                                                                that company
        * brand-level assignment      (brand set)             → matches when
                                                                asked about
                                                                that brand
        * channel-level assignment    (sales_channel set)     → matches when
                                                                asked about
                                                                that channel

    The naive thing — "if the invitee has a single allowed brand, attach
    ``brand=that_brand``" — silently narrows a CEO's scope below the role's
    natural one, so the perms never resolve at company scope. This helper
    centralises the right answer:

        ``scope_type='platform'``  → all-null
        ``scope_type='company'``   → company only
        ``scope_type='brand'``     → company + single-brand
        ``scope_type='channel'``   → company + single-brand + channel
    """
    scope = (role.scope_type or '').lower()
    if scope == 'platform':
        return {'company': None, 'brand': None, 'sales_channel': None}

    if scope == 'company':
        return {'company': company, 'brand': None, 'sales_channel': None}

    # For brand-/channel-scoped roles a single allowed brand narrows the
    # assignment; multiple brands → leave brand null so the role applies
    # across every brand the user has permission to touch.
    single_brand = brands[0] if brands and len(brands) == 1 else None

    if scope == 'brand':
        return {'company': company, 'brand': single_brand, 'sales_channel': None}

    if scope == 'channel':
        return {
            'company': company,
            'brand': single_brand,
            'sales_channel': sales_channel,
        }

    # Unknown scope type — fall back to company scope (safe default).
    return {'company': company, 'brand': None, 'sales_channel': None}


def visible_brand_ids(user):
    """
    Return the set of brand ids ``user`` is allowed to see, or ``None`` to
    mean "no restriction" (superuser / platform-scoped role).

    The previous implementation in several viewsets filtered solely on
    ``user.allowed_brands`` — fine for Manager / Stock Keeper, but it
    over-narrowed a CEO whose ``allowed_brands`` typically contains the
    single brand they were invited under. The fix: a CEO (or any user
    with a company-scoped RBAC role) gets every brand belonging to their
    ``current_company`` in addition to whatever's in ``allowed_brands``.

    Returns:
        * ``None`` — the user can see everything (no filter).
        * ``set[int]`` — restrict to these brand ids (may be empty,
          meaning the user gets nothing).
    """
    if not user or not user.is_authenticated:
        return set()

    # Active-brand focus narrows EVERYONE, including platform admins. The
    # workspace-switch endpoint validates that current_brand is reachable, so
    # the value is trusted here. NULL means "whole company" (no narrowing).
    if getattr(user, 'current_brand_id', None):
        return {user.current_brand_id}

    # Platform admin (superuser or platform-scoped role): scoped to the
    # actively-selected company when one is set (workspace context), otherwise
    # global reach (None = every company). This makes a Super Admin who picks
    # Company A in the switcher see ONLY Company A data on company pages.
    if user.is_superuser or user.user_roles.filter(
        role__scope_type='platform'
    ).exists():
        if user.current_company_id:
            from apps.brands.models import Brand
            return set(
                Brand.objects.filter(company_id=user.current_company_id)
                .values_list('id', flat=True)
            )
        return None

    ids = set(user.allowed_brands.values_list('id', flat=True))

    # Company-scoped users (CEO, Viewer) see every brand of their company,
    # not just the brand(s) marked on their allowed_brands M2M.
    has_company_role = user.user_roles.filter(role__scope_type='company').exists()
    if has_company_role and user.current_company_id:
        from apps.brands.models import Brand
        ids |= set(
            Brand.objects.filter(company_id=user.current_company_id)
            .values_list('id', flat=True)
        )
    return ids


def visible_sales_channel_ids(user):
    """
    Return the set of sales-channel ids ``user`` may see, or ``None`` for
    "no restriction". Derived from ``visible_brand_ids`` plus any
    channel-level RBAC assignments the user happens to hold.
    """
    if not user or not user.is_authenticated:
        return set()

    # Active-brand focus narrows channels to that brand for everyone.
    if getattr(user, 'current_brand_id', None):
        from apps.sales_channels.models import SalesChannel
        return set(
            SalesChannel.objects.filter(brand_id=user.current_brand_id)
            .values_list('id', flat=True)
        )

    # Platform admin: scoped to the selected company's channels when a company
    # is active, otherwise global (None = every channel).
    if user.is_superuser or user.user_roles.filter(
        role__scope_type='platform'
    ).exists():
        if user.current_company_id:
            from apps.sales_channels.models import SalesChannel
            return set(
                SalesChannel.objects.filter(
                    brand__company_id=user.current_company_id
                ).values_list('id', flat=True)
            )
        return None

    # Channel-level RBAC assignments grant direct access to those channels.
    channel_ids = set(
        user.user_roles.filter(sales_channel__isnull=False)
        .values_list('sales_channel_id', flat=True)
    )

    brand_ids = visible_brand_ids(user)
    if brand_ids is None:
        return None  # company-wide / platform-wide reach
    if brand_ids:
        from apps.sales_channels.models import SalesChannel
        channel_ids |= set(
            SalesChannel.objects.filter(brand_id__in=brand_ids)
            .values_list('id', flat=True)
        )
    return channel_ids

if TYPE_CHECKING:
    from apps.brands.models import Brand
    from apps.company.models import Company
    from apps.sales_channels.models import SalesChannel
    from django.contrib.auth import get_user_model

    User = get_user_model()


class PermissionService:
    """Stateless helper — every method is a ``@staticmethod``."""

    # ── Scope helpers ───────────────────────────────────────────────────

    @staticmethod
    def is_platform_admin(user) -> bool:
        """
        True when the user can act across every company: a Django superuser
        or the holder of any platform-scoped RBAC role (e.g. Super Admin).
        """
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True
        return user.user_roles.filter(role__scope_type='platform').exists()

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
