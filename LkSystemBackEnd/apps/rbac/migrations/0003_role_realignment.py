"""
Realign the RBAC system roles to the six-role business model and add the
three separately-protected permissions (financial reports, invitations,
role assignment).

What this migration does, idempotently and without losing data:

1. Creates any missing ``AppPermission`` rows from the seed catalogue
   (so the new ``can_view_financial_reports`` / ``can_invite_users`` /
   ``can_assign_roles`` codenames exist).
2. Creates / realigns the six system roles (Super Admin, CEO, Manager,
   Brand Manager, Employee, Cashier) with their seeded scope and
   permission set. ``Manager`` is widened from brand- to company-scope.
3. Remaps existing assignments of the retired roles:
       Stock Keeper -> Brand Manager
       Sales Rep    -> Employee
   then deletes those two system roles.
4. Demotes ``Viewer`` from a system role to a normal (non-system) custom
   role so existing read-only users keep their access but the role is no
   longer part of the seeded set.

The forward step is safe to re-run. The reverse step is a no-op because
deleted roles cannot be faithfully reconstructed.
"""

from django.db import migrations


def realign_roles(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')
    UserRole = apps.get_model('rbac', 'UserRole')

    # Import the seed catalogue lazily so there is a single source of truth.
    from apps.rbac.constants import (
        SEED_PERMISSIONS,
        SYSTEM_ROLES,
        LEGACY_ROLE_REMAP,
        LEGACY_ROLE_DEMOTE,
    )

    # 1. Ensure every seeded permission exists (adds the three new ones).
    for codename, name, category, description in SEED_PERMISSIONS:
        AppPermission.objects.get_or_create(
            codename=codename,
            defaults={
                'name': name,
                'category': category,
                'description': description,
            },
        )

    perm_by_code = {p.codename: p for p in AppPermission.objects.all()}

    # 2. Create / realign the six system roles (platform-owned: company=None).
    for role_name, cfg in SYSTEM_ROLES.items():
        role, _ = Role.objects.get_or_create(
            name=role_name,
            company=None,
            defaults={
                'description': cfg['description'],
                'scope_type': cfg['scope_type'],
                'is_system': True,
            },
        )
        # Keep scope / description / system flag aligned with the seed.
        role.description = cfg['description']
        role.scope_type = cfg['scope_type']
        role.is_system = True
        role.save()

        if cfg['permissions'] == '__all__':
            desired = list(perm_by_code.values())
        else:
            desired = [
                perm_by_code[c]
                for c in cfg['permissions']
                if c in perm_by_code
            ]
        role.permissions.set(desired)

    # 3. Remap assignments of retired roles, then delete the old roles.
    for old_name, new_name in LEGACY_ROLE_REMAP.items():
        old_role = Role.objects.filter(name=old_name, company=None).first()
        if not old_role:
            continue
        new_role = Role.objects.filter(name=new_name, company=None).first()
        if not new_role:
            continue

        for assignment in UserRole.objects.filter(role=old_role):
            duplicate = UserRole.objects.filter(
                user_id=assignment.user_id,
                role=new_role,
                company_id=assignment.company_id,
                brand_id=assignment.brand_id,
                sales_channel_id=assignment.sales_channel_id,
            ).exists()
            if duplicate:
                assignment.delete()
            else:
                assignment.role = new_role
                assignment.save(update_fields=['role'])

        old_role.delete()

    # 4. Demote retired read-only roles to non-system custom roles.
    for name in LEGACY_ROLE_DEMOTE:
        Role.objects.filter(
            name=name, company=None, is_system=True
        ).update(is_system=False)


def reverse_noop(apps, schema_editor):
    """Irreversible: deleted system roles cannot be reconstructed safely."""
    return None


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0002_order_lifecycle_permissions'),
    ]

    operations = [
        migrations.RunPython(realign_roles, reverse_noop),
    ]
