from django.db import migrations


PERMISSIONS = [
    (
        'view_invoices',
        'View Invoices',
        'invoices',
        'Access the generated invoice registry and invoice details',
    ),
    (
        'edit_invoice_numbers',
        'Edit Invoice Numbers',
        'invoices',
        'Manually edit invoice numbers and advance the automatic sequence',
    ),
]
ROLE_NAMES = ['Super Admin', 'CEO', 'Brand Manager']


def grant_invoice_permissions(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')
    created = []
    for codename, name, category, description in PERMISSIONS:
        permission, _ = AppPermission.objects.update_or_create(
            codename=codename,
            defaults={
                'name': name,
                'category': category,
                'description': description,
            },
        )
        created.append(permission)
    for role in Role.objects.filter(name__in=ROLE_NAMES):
        role.permissions.add(*created)


def revoke_invoice_permissions(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    AppPermission.objects.filter(
        codename__in=[item[0] for item in PERMISSIONS],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0010_dedupe_system_roles'),
    ]

    operations = [
        migrations.RunPython(grant_invoice_permissions, revoke_invoice_permissions),
    ]
