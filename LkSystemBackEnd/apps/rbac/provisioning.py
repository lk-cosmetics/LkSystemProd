"""
LkSystem RBAC — per-company role provisioning and privilege-ceiling helpers.

Design
------
The catalogue of *business* roles (CEO, Manager, Brand Manager, Employee,
Cashier) lives in ``SYSTEM_ROLES`` only as **templates**. The single global
``Super Admin`` role stays platform-wide and is the only role assigned at the
platform scope.

Every company owns its **own editable copies** of the business roles
(``Role.company`` set, ``is_system=False``). A CEO edits only their company's
copies, so a change to "Brand Manager" in company A never touches company B.

This module centralises:

* ``provision_company_roles`` — create a company's own role copies from the
  templates (idempotent, called on company creation and by a backfill
  migration / management command).
* ``permission_ceiling`` — the set of permission codenames an actor is allowed
  to grant. A non-platform actor can never grant a permission they do not hold,
  which prevents privilege escalation through role editing or assignment.
* ``assert_within_ceiling`` — raise ``PermissionDenied`` when a requested
  permission set exceeds the actor's ceiling.
"""

from __future__ import annotations

from .constants import SYSTEM_ROLES
from .models import AppPermission, Role
from .services import PermissionService

# The global Super Admin role is never cloned into a company; every other
# template becomes a per-company role.
COMPANY_ROLE_TEMPLATES: dict[str, dict] = {
    name: cfg for name, cfg in SYSTEM_ROLES.items() if name != 'Super Admin'
}


def _permissions_for_template(cfg: dict, perm_by_code: dict) -> list:
    codes = cfg['permissions']
    if codes == '__all__':
        return list(perm_by_code.values())
    return [perm_by_code[c] for c in codes if c in perm_by_code]


def provision_company_roles(company, *, created_by=None, reset: bool = False):
    """
    Ensure ``company`` owns its own copy of every business role.

    Idempotent: existing company roles are left untouched unless ``reset`` is
    ``True`` (in which case their permission set is forced back to the
    template). Returns the list of roles that were created or reset.
    """
    perm_by_code = {p.codename: p for p in AppPermission.objects.all()}
    touched: list = []

    for name, cfg in COMPANY_ROLE_TEMPLATES.items():
        role, created = Role.objects.get_or_create(
            name=name,
            company=company,
            defaults={
                'description': cfg['description'],
                'scope_type': cfg['scope_type'],
                'is_system': False,
                'created_by': created_by,
            },
        )
        if created or reset:
            role.permissions.set(_permissions_for_template(cfg, perm_by_code))
            touched.append(role)

    return touched


def permission_ceiling(user) -> set[str] | None:
    """
    Return the set of permission codenames ``user`` is allowed to grant.

    ``None`` means "no ceiling" (platform admin / Django superuser) — they may
    grant anything. Otherwise a non-platform actor can only grant permissions
    they themselves hold.
    """
    if PermissionService.is_platform_admin(user):
        return None
    return PermissionService.get_user_permissions(user)


def assert_within_ceiling(user, requested_codenames) -> None:
    """
    Raise ``rest_framework.exceptions.PermissionDenied`` when ``user`` tries to
    grant a permission outside their ceiling.
    """
    ceiling = permission_ceiling(user)
    if ceiling is None:
        return
    over = set(requested_codenames) - ceiling
    if over:
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied(
            'You cannot grant permissions you do not hold: '
            + ', '.join(sorted(over))
        )
