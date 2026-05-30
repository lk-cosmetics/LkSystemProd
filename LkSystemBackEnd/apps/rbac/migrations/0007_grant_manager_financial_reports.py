"""Grant the existing ``can_view_financial_reports`` permission to the
``Manager`` role so company-level managers can see revenue / financial
aggregates (alongside Super Admin and CEO, who already hold it).

Additive and idempotent: the permission row is upserted (it already ships in
``SEED_PERMISSIONS``) and granted by role *name*, so both the platform system
``Manager`` role (company=None) and every per-company copy are covered. Nothing
is dropped — this mirrors a ``python manage.py seed_rbac`` run for the Manager
template, which on its own only unions the perm onto the system role and never
reaches the per-company copies real managers actually hold.

The reverse un-grants from the Manager roles ONLY; it never deletes the
permission itself, which CEO / Super Admin still rely on.
"""

from django.db import migrations


PERMISSION = (
    'can_view_financial_reports',
    'View Financial Reports',
    'reports',
    'View revenue, margins and other sensitive financial numbers',
)

# Granted by name so the platform system role AND per-company copies are covered.
GRANT_TO_ROLE_NAMES = ['Manager']


def grant_financial_reports_to_manager(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')

    codename, name, category, description = PERMISSION
    permission, _ = AppPermission.objects.get_or_create(
        codename=codename,
        defaults={
            'name': name,
            'category': category,
            'description': description,
        },
    )

    for role in Role.objects.filter(name__in=GRANT_TO_ROLE_NAMES):
        # additive — never removes existing permissions
        if not role.permissions.filter(pk=permission.pk).exists():
            role.permissions.add(permission)


def revoke_financial_reports_from_manager(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')

    try:
        permission = AppPermission.objects.get(codename=PERMISSION[0])
    except AppPermission.DoesNotExist:
        return

    # Only un-grant from Manager — the permission itself stays (CEO / Super
    # Admin still hold it).
    for role in Role.objects.filter(name__in=GRANT_TO_ROLE_NAMES):
        role.permissions.remove(permission)


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0006_manual_status_override'),
    ]

    operations = [
        migrations.RunPython(
            grant_financial_reports_to_manager,
            revoke_financial_reports_from_manager,
        ),
    ]
