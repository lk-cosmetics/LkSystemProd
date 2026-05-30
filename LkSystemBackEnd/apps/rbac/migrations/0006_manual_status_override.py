"""Add the ``manual_status_override`` permission and grant it to the
admin / manager roles (CEO, Manager, Brand Manager) plus Super Admin.

Additive and idempotent: the permission row is upserted and granted by role
*name* (so per-company copies of the system roles are covered too). Nothing is
dropped. Mirrors the behaviour of ``seed_rbac`` so a migrate-only deploy ends up
in the same state as a ``python manage.py seed_rbac`` run.

Manual status override is the audited, reason-required backward rollback of an
order's clean ``order_status`` (e.g. returned → done). It is deliberately limited
to admin / manager roles and is denied by default for everyone else.
"""

from django.db import migrations


PERMISSION = (
    'manual_status_override',
    'Manual Status Override',
    'orders',
    'Manually roll an order back to an earlier status (admin/manager only, reason required)',
)

# Roles that may perform a manual override. Granted by name so both the
# platform system roles and any per-company copies are covered.
GRANT_TO_ROLE_NAMES = ['Super Admin', 'CEO', 'Manager', 'Brand Manager']


def seed_manual_status_override(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')

    codename, name, category, description = PERMISSION
    permission, _ = AppPermission.objects.update_or_create(
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


def unseed_manual_status_override(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    AppPermission.objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0005_strip_platform_only_perms'),
    ]

    operations = [
        migrations.RunPython(seed_manual_status_override, unseed_manual_status_override),
    ]
