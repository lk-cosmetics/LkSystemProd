"""Unify ``Expense`` (cash out) and ``CashDeposit`` (cash in) into a single
``CashMovement`` model discriminated by ``movement_type``.

Order matters: create the new table, COPY every row from both old tables, then
drop the old tables. The data copy runs while the historical ``Expense`` /
``CashDeposit`` models still exist (their DeleteModel ops come afterwards).
"""

import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


def copy_movements(apps, schema_editor):
    Expense = apps.get_model('sales_channels', 'Expense')
    CashDeposit = apps.get_model('sales_channels', 'CashDeposit')
    CashMovement = apps.get_model('sales_channels', 'CashMovement')

    # (instance, original created_at, original updated_at) — auto_now/auto_now_add
    # would otherwise stamp the migration time onto every copied row, losing the
    # real audit dates, so we restore them with a follow-up bulk_update.
    pending = []
    # Expenses → cash-out movements. Expenses had no soft-delete, so they all
    # come over as active (is_deleted=False).
    for e in Expense.objects.all().iterator():
        pending.append((CashMovement(
            company_id=e.company_id,
            sales_channel_id=e.sales_channel_id,
            movement_type='expense',
            amount=e.amount,
            category=e.category,
            note=e.note,
            occurred_at=e.occurred_at,
            created_by_id=e.created_by_id,
            is_deleted=False,
            deleted_at=None,
            deleted_by_id=None,
        ), e.created_at, e.updated_at))
    # Cash deposits → cash-in movements; carry the soft-delete state over.
    for d in CashDeposit.objects.all().iterator():
        pending.append((CashMovement(
            company_id=d.company_id,
            sales_channel_id=d.sales_channel_id,
            movement_type='deposit',
            amount=d.amount,
            category=d.kind,
            note=d.note,
            occurred_at=d.occurred_at,
            created_by_id=d.created_by_id,
            is_deleted=d.is_deleted,
            deleted_at=d.deleted_at,
            deleted_by_id=d.deleted_by_id,
        ), d.created_at, d.updated_at))

    if not pending:
        return
    objs = [m for m, _c, _u in pending]
    CashMovement.objects.bulk_create(objs, batch_size=500)
    # Restore the original created_at / updated_at (raw UPDATE — bypasses the
    # auto-now stamps applied during bulk_create).
    for m, created_at, updated_at in pending:
        m.created_at = created_at
        m.updated_at = updated_at
    CashMovement.objects.bulk_update(objs, ['created_at', 'updated_at'], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('company', '0004_company_invoice_footer'),
        ('sales_channels', '0013_cashdeposit_deleted_at_cashdeposit_deleted_by_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CashMovement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('movement_type', models.CharField(choices=[('expense', 'Dépense'), ('deposit', 'Alimentation')], db_index=True, help_text='expense = cash out, deposit = cash in.', max_length=10)),
                ('amount', models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=14)),
                ('category', models.CharField(default='OTHER', help_text='Sub-type; valid values depend on movement_type.', max_length=24)),
                ('note', models.TextField(blank=True, default='')),
                ('occurred_at', models.DateTimeField(db_index=True, help_text='When the cash moved.')),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('company', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='cash_movements', to='company.company')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='cash_movements_created', to=settings.AUTH_USER_MODEL)),
                ('deleted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='cash_movements_deleted', to=settings.AUTH_USER_MODEL)),
                ('sales_channel', models.ForeignKey(help_text='POS register the cash moved through.', on_delete=django.db.models.deletion.CASCADE, related_name='cash_movements', to='sales_channels.saleschannel')),
            ],
            options={
                'db_table': 'pos_cash_movement',
                'ordering': ['-occurred_at', '-id'],
            },
        ),
        migrations.AddIndex(
            model_name='cashmovement',
            index=models.Index(fields=['sales_channel', 'movement_type', 'occurred_at'], name='pos_cash_mo_sales_c_97f3c1_idx'),
        ),
        migrations.AddIndex(
            model_name='cashmovement',
            index=models.Index(fields=['company', 'occurred_at'], name='pos_cash_mo_company_6fb4d1_idx'),
        ),
        migrations.AddConstraint(
            model_name='cashmovement',
            constraint=models.CheckConstraint(condition=models.Q(('amount__gt', Decimal('0'))), name='cash_movement_amount_gt_zero'),
        ),
        # Copy data BEFORE dropping the old tables.
        migrations.RunPython(copy_movements, migrations.RunPython.noop),
        migrations.DeleteModel(name='CashDeposit'),
        migrations.DeleteModel(name='Expense'),
    ]
