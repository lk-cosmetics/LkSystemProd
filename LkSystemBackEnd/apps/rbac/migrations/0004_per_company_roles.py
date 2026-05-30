"""
Move the business roles from global rows to per-company copies.

Before: CEO / Manager / Brand Manager / Employee / Cashier were single global
rows (company=NULL) shared by every tenant, so a CEO could not edit them.

After: every company owns its own editable copy of each business role
(company set, is_system=False). The global rows are kept only as templates
(is_system=True, company=NULL) used for provisioning new companies. The global
``Super Admin`` role is untouched.

This migration is idempotent and data-preserving:

1. For every company, create its own copy of each business role (with the
   template's permission set) if it does not already exist.
2. Repoint every live ``UserRole`` that points at a global business role to
   the matching company copy, using the user's ``current_company`` (or the
   assignment's own company scope) to choose the tenant. Duplicate rows are
   collapsed to satisfy the uniqueness constraint.

The reverse step is a no-op (company copies are harmless to keep).
"""

from django.db import migrations


def forwards(apps, schema_editor):
    Company = apps.get_model('company', 'Company')
    Role = apps.get_model('rbac', 'Role')
    AppPermission = apps.get_model('rbac', 'AppPermission')
    UserRole = apps.get_model('rbac', 'UserRole')

    from apps.rbac.constants import SYSTEM_ROLES

    templates = {n: c for n, c in SYSTEM_ROLES.items() if n != 'Super Admin'}
    template_names = set(templates)
    perm_by_code = {p.codename: p for p in AppPermission.objects.all()}

    # 1. Provision per-company copies of every business role.
    company_role = {}  # (company_id, role_name) -> Role
    for company in Company.objects.all():
        for name, cfg in templates.items():
            role, created = Role.objects.get_or_create(
                name=name,
                company=company,
                defaults={
                    'description': cfg['description'],
                    'scope_type': cfg['scope_type'],
                    'is_system': False,
                },
            )
            if created:
                codes = cfg['permissions']
                if codes == '__all__':
                    desired = list(perm_by_code.values())
                else:
                    desired = [perm_by_code[c] for c in codes if c in perm_by_code]
                role.permissions.set(desired)
            company_role[(company.id, name)] = role

    # 2. Repoint live assignments from global business roles to company copies.
    global_business_ids = set(
        Role.objects.filter(
            company__isnull=True, name__in=template_names
        ).values_list('id', flat=True)
    )
    if not global_business_ids:
        return

    assignments = UserRole.objects.select_related('role', 'user').filter(
        role_id__in=global_business_ids
    )
    for ur in assignments:
        role_name = ur.role.name
        company_id = ur.company_id or getattr(ur.user, 'current_company_id', None)
        if not company_id:
            continue  # cannot resolve a tenant — leave as-is
        target = company_role.get((company_id, role_name))
        if target is None:
            continue

        duplicate = UserRole.objects.filter(
            user_id=ur.user_id,
            role=target,
            company_id=ur.company_id,
            brand_id=ur.brand_id,
            sales_channel_id=ur.sales_channel_id,
        ).exists()
        if duplicate:
            ur.delete()
        else:
            ur.role_id = target.id
            ur.save(update_fields=['role'])


def reverse_noop(apps, schema_editor):
    return None


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0003_role_realignment'),
        ('company', '0003_alter_company_abbreviation_alter_company_legal_name'),
    ]

    operations = [
        migrations.RunPython(forwards, reverse_noop),
    ]
