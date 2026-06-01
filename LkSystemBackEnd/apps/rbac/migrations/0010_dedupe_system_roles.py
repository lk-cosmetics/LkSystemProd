"""De-duplicate platform system roles (``company IS NULL``).

Legacy data left more than one system role with the same name (e.g. two
"Brand Manager" rows), which makes ``seed_rbac`` blow up with
``Role.MultipleObjectsReturned`` and crash-loops the backend on deploy.

For each duplicated system-role name we keep the oldest row (lowest pk) as the
canonical one, move every ``UserRole`` assignment from the duplicates onto it
(dropping a moved assignment if it would collide with an identical existing one),
union the duplicates' permissions onto the canonical role, then delete the
extras. Per-company role copies (``company`` set) are never touched.
"""

from collections import defaultdict

from django.db import migrations


def dedupe_system_roles(apps, schema_editor):
    Role = apps.get_model('rbac', 'Role')
    UserRole = apps.get_model('rbac', 'UserRole')

    groups = defaultdict(list)
    for role in Role.objects.filter(company__isnull=True).order_by('pk'):
        groups[role.name].append(role)

    for name, roles in groups.items():
        if len(roles) < 2:
            continue
        canonical = roles[0]
        for dupe in roles[1:]:
            for ur in UserRole.objects.filter(role=dupe):
                clash = (
                    UserRole.objects
                    .filter(
                        user_id=ur.user_id,
                        role=canonical,
                        company_id=ur.company_id,
                        brand_id=ur.brand_id,
                        sales_channel_id=ur.sales_channel_id,
                    )
                    .exclude(pk=ur.pk)
                    .exists()
                )
                if clash:
                    ur.delete()
                else:
                    ur.role = canonical
                    ur.save(update_fields=['role'])
            # Preserve any permissions the duplicate carried.
            canonical.permissions.add(*dupe.permissions.all())
            dupe.delete()


def noop(apps, schema_editor):
    """Irreversible by design — merged duplicates cannot be split back apart."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0009_grant_manager_delete_users'),
    ]

    operations = [
        migrations.RunPython(dedupe_system_roles, noop),
    ]
