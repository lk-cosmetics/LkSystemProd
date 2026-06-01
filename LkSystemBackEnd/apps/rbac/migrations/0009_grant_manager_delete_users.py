"""Grant ``delete_users`` to the ``Manager`` role.

Company-level Managers can now delete / deactivate regular staff (employees,
cashiers, brand managers). The privilege guard in ``UserViewSet`` still prevents
a Manager from deleting a more-privileged user — the CEO or a platform Super
Admin — so deletion is permission- AND privilege-bounded, never blanket.

Granted by role name so the platform system ``Manager`` role AND every
per-company copy are covered. The reverse un-grants from Manager only; the
permission row itself is never touched.
"""

from django.db import migrations

ROLE_NAMES = ['Manager']
CODENAME = 'delete_users'


def grant_to_manager(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')
    try:
        perm = AppPermission.objects.get(codename=CODENAME)
    except AppPermission.DoesNotExist:
        return
    for role in Role.objects.filter(name__in=ROLE_NAMES):
        if not role.permissions.filter(pk=perm.pk).exists():
            role.permissions.add(perm)


def revoke_from_manager(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')
    try:
        perm = AppPermission.objects.get(codename=CODENAME)
    except AppPermission.DoesNotExist:
        return
    for role in Role.objects.filter(name__in=ROLE_NAMES):
        role.permissions.remove(perm)


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0008_revoke_manager_financial_reports'),
    ]

    operations = [
        migrations.RunPython(grant_to_manager, revoke_from_manager),
    ]
