"""Revoke ``can_view_financial_reports`` from the ``Manager`` role.

Company-level Managers must NOT see revenue / financial aggregates (the order
``/summary`` endpoint gates its revenue numbers on this permission). Migration
0007 had granted it to Manager; this reverses that for every role named
``Manager`` — the platform system role AND each per-company copy that real
managers actually hold — because the additive ``seed_rbac`` never removes a
permission on its own.

CEO and Super Admin keep ``can_view_financial_reports``; only Manager loses it,
and the permission row itself is never deleted.
"""

from django.db import migrations

ROLE_NAMES = ['Manager']
CODENAME = 'can_view_financial_reports'


def revoke_from_manager(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')
    try:
        perm = AppPermission.objects.get(codename=CODENAME)
    except AppPermission.DoesNotExist:
        return
    for role in Role.objects.filter(name__in=ROLE_NAMES):
        role.permissions.remove(perm)


def regrant_to_manager(apps, schema_editor):
    """Reverse: re-grant (mirrors migration 0007) so the migration is reversible."""
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')
    try:
        perm = AppPermission.objects.get(codename=CODENAME)
    except AppPermission.DoesNotExist:
        return
    for role in Role.objects.filter(name__in=ROLE_NAMES):
        role.permissions.add(perm)


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0007_grant_manager_financial_reports'),
    ]

    operations = [
        migrations.RunPython(revoke_from_manager, regrant_to_manager),
    ]
