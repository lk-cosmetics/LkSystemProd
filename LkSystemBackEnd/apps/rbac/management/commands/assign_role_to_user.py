"""
Management command: ``assign_role_to_user <matricule> <role_name> [--brand-id N]``

Wires a user up to a SYSTEM role with proper tenant scoping. Idempotent —
calling it twice doesn't create duplicate UserRole rows.

The most common use case is rescuing a user who was created via the Users
UI *before* role assignment was part of the create payload. Symptoms:

* sidebar shows the role name
* but every protected endpoint returns 403
* ``rbac_doctor <matricule>`` shows zero permissions scoped to their company

Usage::

    docker compose exec backend python manage.py assign_role_to_user CEO_LINA CEO
    docker compose exec backend python manage.py assign_role_to_user MGR-0007 Manager --brand-id 3
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.rbac.models import Role, UserRole

User = get_user_model()


class Command(BaseCommand):
    help = 'Attach a SYSTEM RBAC role to a user, scoped to their current company.'

    def add_arguments(self, parser):
        parser.add_argument('matricule', type=str)
        parser.add_argument('role_name', type=str, help='e.g. "CEO", "Manager", "Cashier"')
        parser.add_argument(
            '--brand-id',
            type=int,
            default=None,
            help='Optional brand scope for brand-level roles (Manager / Stock Keeper).',
        )
        parser.add_argument(
            '--channel-id',
            type=int,
            default=None,
            help='Optional sales-channel scope for channel-level roles (Cashier / Sales Rep).',
        )
        parser.add_argument(
            '--remove-other-roles',
            action='store_true',
            help='Drop every other UserRole row for this user before adding the new one. '
                 'Use when a previous custom-role assignment is causing missing permissions.',
        )

    @transaction.atomic
    def handle(self, *args, **opts):
        matricule = opts['matricule'].strip().upper()
        role_name = opts['role_name'].strip()
        brand_id = opts.get('brand_id')
        channel_id = opts.get('channel_id')
        purge = opts.get('remove_other_roles', False)

        try:
            user = User.objects.get(matricule=matricule)
        except User.DoesNotExist:
            raise CommandError(f'No user with matricule {matricule!r}.')

        # Prefer the platform-level (``company=None``) system role; that's
        # the one ``seed_rbac`` populates with the canonical permissions.
        role = (
            Role.objects.filter(name=role_name, company__isnull=True)
            .order_by('-is_system')
            .first()
        )
        if not role:
            raise CommandError(
                f'No system role named {role_name!r} (company=None). '
                f'Run "python manage.py seed_rbac" first.'
            )
        perm_count = role.permissions.count()

        if purge:
            removed = UserRole.objects.filter(user=user).count()
            UserRole.objects.filter(user=user).delete()
            self.stdout.write(self.style.WARNING(f'  Removed {removed} existing UserRole row(s).'))

        # The UserRole is always scoped to the user's current_company so the
        # multi-tenant boundary is respected. brand/channel narrow it further
        # for brand-/channel-scoped roles.
        existing = UserRole.objects.filter(
            user=user,
            role=role,
            company=user.current_company,
            brand_id=brand_id,
            sales_channel_id=channel_id,
        ).first()
        if existing:
            self.stdout.write(self.style.SUCCESS(
                f'  Already assigned: {role.name!r} ({perm_count} perms) '
                f'company={user.current_company_id} brand={brand_id} channel={channel_id}'
            ))
            return

        UserRole.objects.create(
            user=user,
            role=role,
            company=user.current_company,
            brand_id=brand_id,
            sales_channel_id=channel_id,
            assigned_by=None,
        )
        self.stdout.write(self.style.SUCCESS(
            f'  Assigned {role.name!r} ({perm_count} perms) → {user.matricule} '
            f'(company={user.current_company_id}, brand={brand_id}, channel={channel_id}).'
        ))
