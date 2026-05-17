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
from apps.rbac.services import scope_kwargs_for_role

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

        # Build the scope columns from the role's own ``scope_type`` so
        # the resulting row matches the permission resolver's expectations.
        # ``--brand-id`` / ``--channel-id`` only apply when the role is
        # brand- or channel-scoped; for a CEO (company-scoped) the brand
        # is forced to NULL to avoid the very bug this command fixes.
        brands_list = []
        if brand_id is not None:
            from apps.brands.models import Brand
            brand = Brand.objects.filter(pk=brand_id).first()
            if brand is None:
                raise CommandError(f'No brand with id {brand_id}.')
            brands_list = [brand]
        sales_channel = None
        if channel_id is not None:
            from apps.sales_channels.models import SalesChannel
            sales_channel = SalesChannel.objects.filter(pk=channel_id).first()
            if sales_channel is None:
                raise CommandError(f'No sales channel with id {channel_id}.')

        scope = scope_kwargs_for_role(
            role,
            company=user.current_company,
            brands=brands_list,
            sales_channel=sales_channel,
        )

        # Warn if the caller's flags were narrower than the role's scope
        # would allow — keeps the operator from being surprised silently.
        if brand_id is not None and scope.get('brand') is None:
            self.stdout.write(self.style.WARNING(
                f'  Note: --brand-id ignored — {role.name!r} is {role.scope_type}-scoped, '
                'brand columns must be NULL for the resolver to match.'
            ))
        if channel_id is not None and scope.get('sales_channel') is None:
            self.stdout.write(self.style.WARNING(
                f'  Note: --channel-id ignored — {role.name!r} is {role.scope_type}-scoped.'
            ))

        existing = UserRole.objects.filter(
            user=user,
            role=role,
            **scope,
        ).first()
        if existing:
            self.stdout.write(self.style.SUCCESS(
                f'  Already assigned: {role.name!r} ({perm_count} perms) '
                f'company={scope.get("company") and scope["company"].id} '
                f'brand={scope.get("brand") and scope["brand"].id} '
                f'channel={scope.get("sales_channel") and scope["sales_channel"].id}'
            ))
            return

        UserRole.objects.create(
            user=user,
            role=role,
            assigned_by=None,
            **scope,
        )
        self.stdout.write(self.style.SUCCESS(
            f'  Assigned {role.name!r} ({perm_count} perms, {role.scope_type}-scoped) → {user.matricule} '
            f'(company={scope.get("company") and scope["company"].id}, '
            f'brand={scope.get("brand") and scope["brand"].id}, '
            f'channel={scope.get("sales_channel") and scope["sales_channel"].id}).'
        ))
