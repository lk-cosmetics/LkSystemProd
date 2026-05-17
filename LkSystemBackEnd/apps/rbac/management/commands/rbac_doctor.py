"""
Management command: ``rbac_doctor <matricule>``

Prints every relevant RBAC fact about a user — useful when their account
"should" work (right role in the sidebar) but every screen complains about
missing permissions. Reports the actual UserRole rows, the role they point
to, that role's permission count, the resolved permission set, and whether
the user would pass the most common DRF gates (BI dashboard, roles list,
view_company, view_products).

Usage::

    docker compose exec backend python manage.py rbac_doctor CEO_LINA
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.rbac.models import Role, UserRole
from apps.rbac.services import PermissionService

User = get_user_model()


class Command(BaseCommand):
    help = 'Diagnose a user\'s RBAC state.'

    def add_arguments(self, parser):
        parser.add_argument('matricule', type=str)

    def handle(self, *args, **options):
        matricule = options['matricule'].strip().upper()
        try:
            user = User.objects.get(matricule=matricule)
        except User.DoesNotExist:
            raise CommandError(f'No user with matricule {matricule!r}.')

        h = self.stdout.write
        line = '─' * 60
        h(line)
        h(self.style.SUCCESS(f'User · {user.matricule} · {user.get_full_name()}'))
        h(line)
        h(f'  email             {user.email}')
        h(f'  is_active         {user.is_active}')
        h(f'  is_staff          {user.is_staff}')
        h(f'  is_superuser      {user.is_superuser}')
        h(f'  current_company   {user.current_company_id} ({user.current_company.name if user.current_company else "—"})')
        h(f'  allowed_brands    {list(user.allowed_brands.values_list("name", flat=True))}')

        h('')
        h('UserRole rows:')
        rows = list(UserRole.objects.filter(user=user).select_related('role', 'company', 'brand', 'sales_channel'))
        if not rows:
            h(self.style.WARNING('  (none — this is why permissions are empty.)'))
        for ur in rows:
            perm_count = ur.role.permissions.count()
            scope = (
                f'company={ur.company_id}  brand={ur.brand_id}  channel={ur.sales_channel_id}'
                if any([ur.company_id, ur.brand_id, ur.sales_channel_id])
                else 'PLATFORM (all-null scope)'
            )
            h(f'  {ur.role.name!r:18}  id={ur.role_id}  scope={scope}  perms_on_role={perm_count}  role.scope_type={ur.role.scope_type}  role.company_id={ur.role.company_id}')

        # ── Permission resolution ──
        h('')
        h('Resolved permissions:')
        all_perms = PermissionService.get_user_permissions(user)
        scoped_perms = PermissionService.get_user_permissions(user, company=user.current_company)
        h(f'  total (no scope):       {len(all_perms)}')
        h(f'  scoped to own company:  {len(scoped_perms)}')

        for codename in ('view_bi_dashboard', 'view_roles', 'view_company', 'view_products', 'view_orders'):
            has_global = codename in all_perms
            has_scoped = codename in scoped_perms
            verdict = self.style.SUCCESS('OK') if has_scoped else self.style.ERROR('MISSING')
            h(f'  {codename:24}  scoped={has_scoped}  global={has_global}   [{verdict}]')

        # ── Hint duplicate roles ──
        duplicates = (
            Role.objects.filter(name__in=[ur.role.name for ur in rows])
            .values('name')
            .distinct()
        )
        if duplicates:
            h('')
            h('Roles with the same name on the platform (in case of dupes):')
            for d in duplicates:
                matches = Role.objects.filter(name=d['name'])
                for r in matches:
                    h(
                        f'  id={r.id:3}  name={r.name!r:18}  company={r.company_id}  '
                        f'is_system={r.is_system}  perms={r.permissions.count()}'
                    )

        h(line)
        # Detect the "scope mismatch" failure mode: the UserRole carries the
        # right role + perms but its scope columns are narrower than the
        # role's natural scope, so the resolver never matches it.
        narrowed_rows = [
            ur for ur in rows
            if ur.role.permissions.exists()
            and (
                (ur.role.scope_type == 'company' and (ur.brand_id or ur.sales_channel_id))
                or (ur.role.scope_type == 'platform' and (ur.company_id or ur.brand_id or ur.sales_channel_id))
            )
        ]
        if narrowed_rows:
            for ur in narrowed_rows:
                h(self.style.ERROR(
                    f'Diagnosis: {ur.role.name!r} is {ur.role.scope_type}-scoped but the '
                    f'UserRow has brand={ur.brand_id} / channel={ur.sales_channel_id} set, '
                    f'which narrows it below the role\'s natural scope. The permission '
                    f'resolver therefore returns 0 perms at company scope.'
                ))
            broken_role_name = narrowed_rows[0].role.name
            h(self.style.WARNING(
                f'Fix: python manage.py assign_role_to_user {user.matricule} {broken_role_name} --remove-other-roles'
            ))
        elif rows and len(scoped_perms) == 0:
            h(self.style.WARNING(
                'Diagnosis: this user has a UserRole, but the role itself carries no '
                'permissions in this scope. Either the role was hand-crafted via the UI '
                'without selecting permissions, or it was created in another tenant.'
            ))
            h(self.style.WARNING(
                f'Fix: assign the SYSTEM role with the right name, e.g.'
                f'  python manage.py assign_role_to_user {user.matricule} CEO'
            ))
        elif not rows:
            h(self.style.WARNING(
                'Diagnosis: no UserRole rows at all. The user-create endpoint used to '
                'skip role assignment — the new ``role_id`` field on the create payload '
                'fixes that for future users.'
            ))
            h(self.style.WARNING(
                f'Fix: python manage.py assign_role_to_user {user.matricule} <RoleName>'
            ))
        else:
            h(self.style.SUCCESS('All gates look reachable. If a screen still errors, '
                                 'check the network response in the browser DevTools.'))
