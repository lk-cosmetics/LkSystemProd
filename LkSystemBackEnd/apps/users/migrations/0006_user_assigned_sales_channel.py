"""Add ``User.assigned_sales_channel`` and backfill it for existing operational
accounts (Employee / Cashier) where the sales point is unambiguous.

An operational account is confined to a single sales point. This column stores
that assignment; when set, the RBAC scope resolvers narrow every read to this
one channel (and its brand). Managers / admins keep it NULL and stay scoped by
brand / company as before.

The backfill only assigns a channel when it is unambiguous, so it can never
mis-scope an existing account:
  1. a single explicit channel on a channel-scoped role assignment, otherwise
  2. the single sales channel of the account's focused / allowed brand.
Ambiguous accounts are left NULL (no behaviour change).
"""

from django.db import migrations, models
import django.db.models.deletion


def backfill(apps, schema_editor):
    User = apps.get_model('users', 'User')
    UserRole = apps.get_model('rbac', 'UserRole')
    SalesChannel = apps.get_model('sales_channels', 'SalesChannel')

    for user in User.objects.filter(assigned_sales_channel__isnull=True):
        roles = list(UserRole.objects.filter(user=user).select_related('role'))
        if not roles:
            continue

        # Is any assigned role an operational, single-sales-point role? Derived
        # from scope + permissions (never role names): a channel-scoped role, or
        # a role that can neither switch brands nor manage users.
        needs = False
        explicit_channels = set()
        for ur in roles:
            if ur.sales_channel_id:
                explicit_channels.add(ur.sales_channel_id)
            role = ur.role
            if (role.scope_type or '').lower() == 'channel':
                needs = True
            else:
                codes = set(role.permissions.values_list('codename', flat=True))
                if 'switch_brands' not in codes and 'view_users' not in codes:
                    needs = True
        if not needs:
            continue

        # 1) a single explicit channel assignment wins.
        if len(explicit_channels) == 1:
            user.assigned_sales_channel_id = next(iter(explicit_channels))
            user.save(update_fields=['assigned_sales_channel'])
            continue

        # 2) else the single sales channel of the focused / allowed brand.
        brand_ids = set()
        if user.current_brand_id:
            brand_ids.add(user.current_brand_id)
        else:
            brand_ids |= set(user.allowed_brands.values_list('id', flat=True))
        if brand_ids:
            chans = list(
                SalesChannel.objects.filter(brand_id__in=brand_ids)
                .values_list('id', flat=True)
            )
            if len(chans) == 1:
                user.assigned_sales_channel_id = chans[0]
                user.save(update_fields=['assigned_sales_channel'])


def noop(apps, schema_editor):
    """Reverse is a no-op — the column is simply dropped by the AddField undo."""


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0005_user_current_brand'),
        ('sales_channels', '0009_rename_pos_expense_sales_c_ed7a85_idx_pos_expense_sales_c_b099de_idx_and_more'),
        ('rbac', '0010_dedupe_system_roles'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='assigned_sales_channel',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to='sales_channels.saleschannel',
                verbose_name='Assigned Sales Point',
                help_text='Operational accounts (Employee/Cashier) are locked to this '
                          'sales channel for all data they can see.',
            ),
        ),
        migrations.RunPython(backfill, noop),
    ]
