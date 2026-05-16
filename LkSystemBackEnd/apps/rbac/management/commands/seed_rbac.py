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
    help = 'Seed RBAC permissions and system roles.'

    def handle(self, *args, **options):
        self._seed_permissions()
        self._cleanup_legacy_permissions()
        self._seed_roles()
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
            role, created = Role.objects.get_or_create(
                name=role_name,
                company=None,  # System roles are platform-wide
                defaults={
                    'description': cfg['description'],
                    'scope_type': cfg['scope_type'],
                    'is_system': True,
                },
            )

            # Always update permissions on existing system roles
            if cfg['permissions'] == '__all__':
                role.permissions.set(all_perms.values())
            else:
                perm_objects = [
                    all_perms[code]
                    for code in cfg['permissions']
                    if code in all_perms
                ]
                role.permissions.set(perm_objects)

            action = 'Created' if created else 'Updated'
            self.stdout.write(
                f'  Role "{role_name}": {action} '
                f'({role.permissions.count()} permissions)'
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
