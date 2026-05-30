"""
Remove platform-only permissions from every non-platform role.

``create_company`` and ``delete_company`` create or delete a *tenant* and must
only ever belong to the platform Super Admin role. They were mistakenly part of
the CEO template, which let a CEO see the "Add New Company" button (and any
other UI gated on those codenames). This migration heals every existing
non-platform role (company / brand / channel scoped), including the global
business templates and each company's provisioned copies.

A CEO keeps ``view_company`` + ``edit_company`` so they can still manage their
own company's settings.
"""

from django.db import migrations

PLATFORM_ONLY = ['create_company', 'delete_company']


def forwards(apps, schema_editor):
    Role = apps.get_model('rbac', 'Role')
    AppPermission = apps.get_model('rbac', 'AppPermission')

    perms = list(AppPermission.objects.filter(codename__in=PLATFORM_ONLY))
    if not perms:
        return

    # Every role that is NOT platform-scoped loses these tenant-management
    # permissions. The platform Super Admin role keeps them.
    for role in Role.objects.exclude(scope_type='platform'):
        role.permissions.remove(*perms)


def reverse_noop(apps, schema_editor):
    return None


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0004_per_company_roles'),
    ]

    operations = [
        migrations.RunPython(forwards, reverse_noop),
    ]
