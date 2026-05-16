"""Add ``Promotion.group_id`` and backfill a UUID per existing row.

Wizard-created sibling promotions share a single ``group_id`` so the UI can
display one row per campaign. Legacy single-product promotions each become
their own one-member group via the data migration step.
"""

import uuid

from django.db import migrations, models


def assign_group_ids(apps, schema_editor):
    Promotion = apps.get_model('promotions', 'Promotion')
    # Each pre-existing row becomes its own group.
    rows = list(Promotion.objects.filter(group_id__isnull=True).only('id'))
    for row in rows:
        row.group_id = uuid.uuid4()
    if rows:
        Promotion.objects.bulk_update(rows, ['group_id'], batch_size=500)


def reverse_noop(apps, schema_editor):
    # Forward-only data migration. Reversal just drops the column below.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('promotions', '0004_promotion_end_date_nullable'),
    ]

    operations = [
        migrations.AddField(
            model_name='promotion',
            name='group_id',
            field=models.UUIDField(
                blank=True,
                db_index=True,
                default=uuid.uuid4,
                help_text='Shared identifier for promotions created together (campaign).',
                null=True,
                verbose_name='Group ID',
            ),
        ),
        migrations.RunPython(assign_group_ids, reverse_noop),
        migrations.AddIndex(
            model_name='promotion',
            index=models.Index(fields=['group_id'], name='promotions__group_id_idx'),
        ),
    ]
