"""
Management command: seed_rbac

Creates all AppPermission entries and system Role entries.
Safe to run multiple times — uses get_or_create.

Assigns the 'Super Admin' RBAC role to any superuser who
doesn't already have an RBAC role.

Usage::

    python manage.py seed_rbac
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.rbac.constants import SEED_PERMISSIONS, SYSTEM_ROLES
from apps.rbac.models import AppPermission, Role, UserRole

User = get_user_model()


class Command(BaseCommand):
    """
    Idempotent RBAC bootstrap.

    The seed runs on every deploy (it's invoked from ``entrypoint.sh``), so
    it must be **non-destructive** by default — admins who edit a system
    role's permissions through the API should not see their work wiped on
    the next image build.

    Behaviour:
      * Permission catalogue → upsert. New rows in ``SEED_PERMISSIONS`` get
        created; existing rows stay as-is (the catalogue is the floor, not
        the ceiling).
      * System roles → ``get_or_create`` only. New roles are created with
        their full permission set; existing roles are left alone so
        manual edits survive.
      * Pass ``--reset-system-roles`` to force the seeded permissions back
        onto existing system roles (use only for "fix my staging" cases).
    """

    help = 'Seed RBAC permissions and system roles (idempotent by default).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset-system-roles',
            action='store_true',
            help=(
                'Re-apply the seeded permission set to existing system roles. '
                'Destroys any manual edits — use sparingly.'
            ),
        )

    def handle(self, *args, **options):
        self._reset = bool(options.get('reset_system_roles'))
        self._seed_permissions()
        self._cleanup_legacy_permissions()
        self._seed_roles()
        self._provision_company_role_sets()
        self._sync_company_role_copies()
        self._ensure_superusers_have_rbac_role()

        self.stdout.write(self.style.SUCCESS('RBAC seed complete.'))

    # ── Permissions ─────────────────────────────────────────────────────

    def _seed_permissions(self):
        created_count = 0
        for codename, name, category, description in SEED_PERMISSIONS:
            _, created = AppPermission.objects.get_or_create(
                codename=codename,
                defaults={
                    'name': name,
                    'category': category,
                    'description': description,
                },
            )
            if created:
                created_count += 1

        self.stdout.write(
            f'  Permissions: {created_count} created, '
            f'{len(SEED_PERMISSIONS) - created_count} already existed.'
        )

    # ── Cleanup legacy permissions ─────────────────────────────────────

    def _cleanup_legacy_permissions(self):
        """Remove old manage_* permissions that have been split into CRUD."""
        valid_codenames = {code for code, *_ in SEED_PERMISSIONS}
        legacy_perms = AppPermission.objects.exclude(codename__in=valid_codenames)
        count = legacy_perms.count()
        if count:
            legacy_perms.delete()
            self.stdout.write(f'  Cleaned up {count} legacy permissions.')

    # ── System roles ────────────────────────────────────────────────────

    def _seed_roles(self):
        all_perms = {
            p.codename: p
            for p in AppPermission.objects.all()
        }

        for role_name, cfg in SYSTEM_ROLES.items():
            # Defensive get-or-create: if a duplicate system role with this name
            # somehow exists (legacy data), use the oldest one instead of
            # crashing the entire deploy with MultipleObjectsReturned. Migration
            # 0010_dedupe_system_roles merges and removes such duplicates; this
            # guard makes seeding resilient even if one ever reappears.
            role = (
                Role.objects.filter(name=role_name, company__isnull=True)
                .order_by('pk')
                .first()
            )
            if role is None:
                role = Role.objects.create(
                    name=role_name,
                    company=None,  # System roles are platform-wide
                    description=cfg['description'],
                    scope_type=cfg['scope_type'],
                    is_system=True,
                )
                created = True
            else:
                created = False

            # Seed behaviour for existing roles:
            #   * default     → UNION new perms in (additive). Admins keep
            #                  custom edits; newly-introduced permissions
            #                  (like ``view_manufacturing``) auto-appear
            #                  on the role after the next deploy.
            #   * --reset     → exact match. Wipes any custom edits and
            #                  forces the role back to the seeded set.
            # New roles always get the full set on creation.
            if cfg['permissions'] == '__all__':
                desired = list(all_perms.values())
            else:
                desired = [all_perms[code] for code in cfg['permissions'] if code in all_perms]

            if created or self._reset:
                role.permissions.set(desired)
                action = 'Created' if created else 'Reset'
                added = len(desired)
            else:
                existing_ids = set(role.permissions.values_list('id', flat=True))
                missing = [p for p in desired if p.id not in existing_ids]
                if missing:
                    role.permissions.add(*missing)
                    action = f'Added {len(missing)} missing perm(s)'
                else:
                    action = 'Up to date'
                added = role.permissions.count()

            self.stdout.write(
                f'  Role "{role_name}": {action} '
                f'(now has {role.permissions.count()} permissions)'
            )

    # ── Per-company role provisioning (create missing copies) ────────────

    def _provision_company_role_sets(self):
        """Ensure every company owns a copy of **every** business-role template.

        ``provision_company_roles`` normally runs once, at company creation. A
        template role introduced *later* (e.g. ``Employee`` was added after some
        tenants already existed) is therefore missing from every company that
        predates it — the company silently lacks that role, and it never appears
        on the Roles page. ``_sync_company_role_copies`` only tops up the
        permissions of copies that already exist; it does not create absent ones.

        Because ``provision_company_roles`` is idempotent (``get_or_create``),
        calling it here for every company creates only the *missing* copies and
        leaves existing roles untouched. With ``--reset-system-roles`` it also
        forces each copy's permissions back to its template.
        """
        from django.apps import apps

        from apps.rbac.models import AppPermission
        from apps.rbac.provisioning import provision_company_roles

        Company = apps.get_model('company', 'Company')
        # Build the permission map ONCE and reuse it across companies instead of
        # re-scanning the table per company. Only CREATE missing copies here;
        # ``_sync_company_role_copies`` (next step) owns permission flooring and
        # ``--reset``, so we never set a copy's permissions twice.
        perm_by_code = {p.codename: p for p in AppPermission.objects.all()}
        companies = 0
        created = 0
        for company in Company.objects.all():
            touched = provision_company_roles(company, perm_by_code=perm_by_code)
            created += len(touched)
            companies += 1

        self.stdout.write(
            f'  Company role sets: ensured {companies} compan(y/ies) own every '
            f'template role ({created} created).'
        )

    # ── Per-company role copies ─────────────────────────────────────────

    def _sync_company_role_copies(self):
        """Floor per-company role copies with their template's permissions.

        Per-company roles (``Role.company`` set) are editable copies of the
        business-role templates, created once by ``provision_company_roles`` and
        then frozen. A permission added to a template later (e.g.
        ``view_manufacturing``) therefore never reaches copies that already
        exist — so an older "Brand Manager" silently lacks access to a
        newly-added module. Mirror the system-role behaviour:

          * default  → UNION any missing template permissions onto each copy
                       (additive: custom edits/additions are preserved, nothing
                       is removed).
          * --reset  → force the copy back to the exact template set.

        Copies whose name does not match a template (CEO-created custom roles)
        are left untouched, so this never overrides bespoke roles.
        """
        all_perms = {p.codename: p for p in AppPermission.objects.all()}
        company_roles = Role.objects.filter(company__isnull=False)
        additive = 0
        reset = 0
        for role in company_roles:
            cfg = SYSTEM_ROLES.get(role.name)
            if not cfg:
                continue  # custom role with no template — leave alone
            if cfg['permissions'] == '__all__':
                desired = list(all_perms.values())
            else:
                desired = [all_perms[code] for code in cfg['permissions'] if code in all_perms]

            if self._reset:
                role.permissions.set(desired)
                reset += 1
            else:
                existing_ids = set(role.permissions.values_list('id', flat=True))
                missing = [p for p in desired if p.id not in existing_ids]
                if missing:
                    role.permissions.add(*missing)
                    additive += 1

        if self._reset:
            self.stdout.write(f'  Company role copies: reset {reset} to template.')
        else:
            self.stdout.write(
                f'  Company role copies: floored {additive} role(s) with missing template perm(s).'
            )

    # ── Ensure superusers have RBAC role ─────────────────────────────

    def _ensure_superusers_have_rbac_role(self):
        """Assign 'Super Admin' RBAC role to superusers without any role."""
        try:
            super_admin_role = Role.objects.get(name='Super Admin', company=None)
        except Role.DoesNotExist:
            return

        superusers_without_role = User.objects.filter(
            is_superuser=True,
        ).exclude(
            user_roles__isnull=False,
        )

        assigned = 0
        for user in superusers_without_role:
            _, created = UserRole.objects.get_or_create(
                user=user,
                role=super_admin_role,
                defaults={'assigned_by': None},
            )
            if created:
                assigned += 1

        if assigned:
            self.stdout.write(
                f'  Assigned Super Admin role to {assigned} superuser(s).'
            )
