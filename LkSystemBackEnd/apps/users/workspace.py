"""
LkSystem — Workspace switching service.

A *workspace* is the pair (active company, active brand). The set of companies
a user may switch into is **derived from their RBAC role assignments** — there
is no separate membership table, so it can never drift from the permission
model. A platform admin (Django superuser or holder of a platform-scoped role)
can switch into any company.

Switching is the only place ``User.current_company`` / ``User.current_brand``
are mutated, and every switch is validated server-side. The frontend is pure
UX; this service is the authority.
"""

from __future__ import annotations

from django.db import transaction

from apps.rbac.services import PermissionService


class WorkspaceError(Exception):
    """Raised when a requested workspace is outside the user's reach."""


class WorkspaceService:
    """Stateless helper — every method is a ``@staticmethod``."""

    # ── Switchable companies ────────────────────────────────────────────

    @staticmethod
    def switchable_company_ids(user) -> set[int] | None:
        """
        Company ids the user may switch into.

        ``None`` means "every company" (platform admin / superuser). Otherwise
        a concrete set derived from the user's role assignments, always
        including their home ``current_company``.
        """
        if not user or not user.is_authenticated:
            return set()
        if PermissionService.is_platform_admin(user):
            return None

        ids: set[int] = set()
        assignments = user.user_roles.select_related(
            'company', 'brand', 'sales_channel', 'brand__company',
            'sales_channel__brand', 'sales_channel__brand__company',
        )
        for ur in assignments:
            if ur.company_id:
                ids.add(ur.company_id)
            elif ur.brand_id:
                ids.add(ur.brand.company_id)
            elif ur.sales_channel_id:
                ids.add(ur.sales_channel.brand.company_id)
        if user.current_company_id:
            ids.add(user.current_company_id)
        return ids

    @staticmethod
    def switchable_companies(user):
        """Return the active companies the user may switch into (queryset)."""
        from apps.company.models import Company

        ids = WorkspaceService.switchable_company_ids(user)
        qs = Company.objects.filter(is_active=True)
        if ids is None:
            return qs
        return qs.filter(id__in=ids)

    # ── Switchable brands within a company ──────────────────────────────

    @staticmethod
    def switchable_brand_ids(user, company_id) -> set[int]:
        """Brand ids of ``company_id`` the user may focus on."""
        from apps.brands.models import Brand

        if not user or not user.is_authenticated or not company_id:
            return set()

        company_brand_ids = set(
            Brand.objects.filter(company_id=company_id)
            .values_list('id', flat=True)
        )

        # Platform admin, or a user holding a company-scoped role in this
        # company, may focus any brand of the company.
        if PermissionService.is_platform_admin(user):
            return company_brand_ids
        has_company_role = user.user_roles.filter(
            role__scope_type='company', company_id=company_id
        ).exists()
        if has_company_role:
            return company_brand_ids

        # Otherwise: the brands explicitly granted to the user that belong to
        # this company, plus any brand they hold a brand/channel role in.
        allowed = set(user.allowed_brands.values_list('id', flat=True))
        role_brand_ids = set(
            user.user_roles.filter(brand__company_id=company_id)
            .values_list('brand_id', flat=True)
        )
        role_brand_ids |= set(
            user.user_roles.filter(sales_channel__brand__company_id=company_id)
            .values_list('sales_channel__brand_id', flat=True)
        )
        return (allowed | role_brand_ids) & company_brand_ids

    @staticmethod
    def switchable_brands(user, company_id):
        # NOTE: the Brand model has no ``is_active`` flag, so we never filter
        # on it here (doing so raises a FieldError and 500s the workspaces
        # endpoint, which silently breaks the switcher).
        from apps.brands.models import Brand

        ids = WorkspaceService.switchable_brand_ids(user, company_id)
        return Brand.objects.filter(id__in=ids)

    # ── Validation + mutation ───────────────────────────────────────────

    @staticmethod
    def can_access_company(user, company_id) -> bool:
        ids = WorkspaceService.switchable_company_ids(user)
        return ids is None or int(company_id) in ids

    @staticmethod
    def can_access_brand(user, company_id, brand_id) -> bool:
        if brand_id in (None, '', 0):
            return True  # no brand focus = whole company
        return int(brand_id) in WorkspaceService.switchable_brand_ids(
            user, company_id
        )

    @staticmethod
    @transaction.atomic
    def switch(user, *, company_id=None, brand_id=None):
        """
        Validate and apply a workspace switch. Returns the refreshed user.

        - ``company_id`` defaults to the user's current company when omitted.
        - ``brand_id`` of ``None`` clears the brand focus (whole company).
        Raises ``WorkspaceError`` when the target is outside the user's reach.
        """
        target_company_id = company_id or user.current_company_id
        if not target_company_id:
            raise WorkspaceError('No company to switch to.')

        if not WorkspaceService.can_access_company(user, target_company_id):
            raise WorkspaceError('You do not have access to this company.')

        if not WorkspaceService.can_access_brand(
            user, target_company_id, brand_id
        ):
            raise WorkspaceError('You do not have access to this brand.')

        user.current_company_id = target_company_id
        user.current_brand_id = brand_id or None
        user.save(update_fields=['current_company', 'current_brand'])
        return user
