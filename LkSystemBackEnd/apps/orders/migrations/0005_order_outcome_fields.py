"""
Add order outcome fields: outcome status, confirm/delay/cancel metadata,
and new OrderLog action choices for outcome events.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('orders', '0004_delivery_sync_brand_fields'),
    ]

    operations = [
        # ── Outcome fields on Order ──────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='outcome',
            field=models.CharField(
                choices=[
                    ('NONE', 'No Outcome'),
                    ('CONFIRMED', 'Confirmed'),
                    ('DELAYED', 'Delayed'),
                    ('CANCELLED', 'Cancelled'),
                ],
                db_index=True,
                default='NONE',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='confirmed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='delay_date',
            field=models.DateField(
                blank=True,
                help_text='Expected follow-up or reschedule date when order is delayed',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='delay_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='order',
            name='cancellation_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='order',
            name='outcome_note',
            field=models.TextField(
                blank=True,
                default='',
                help_text='Free-text note attached to confirm / delay / cancel action',
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='outcome_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='outcome_changed_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='order_outcomes',
                to=settings.AUTH_USER_MODEL,
            ),
        ),

        # ── Index for outcome queries ────────────────────────────────────
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['outcome'], name='sales_order_outcome_idx'),
        ),

        # ── Extend OrderLog action choices ───────────────────────────────
        migrations.AlterField(
            model_name='orderlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('CREATED', 'Created'),
                    ('UPDATED', 'Updated'),
                    ('SOFT_DELETED', 'Soft Deleted'),
                    ('RESTORED', 'Restored'),
                    ('DISCOUNT_APPLIED', 'Discount Applied'),
                    ('STATUS_CHANGED', 'Status Changed'),
                    ('OUTCOME_CONFIRMED', 'Confirmed'),
                    ('OUTCOME_DELAYED', 'Delayed'),
                    ('OUTCOME_CANCELLED', 'Cancelled'),
                    ('SYNC_RECEIVED', 'Synced from WooCommerce'),
                    ('SYNC_FAILED', 'Sync Failed'),
                    ('DELIVERY_QUEUED', 'Queued for Delivery'),
                    ('DELIVERY_SUBMITTED', 'Submitted to Provider'),
                    ('DELIVERY_ACCEPTED', 'Accepted by Provider'),
                    ('DELIVERY_FAILED', 'Delivery Failed'),
                    ('DELIVERY_DELIVERED', 'Delivered'),
                    ('DELIVERY_RETURNED', 'Returned to Sender'),
                ],
                max_length=30,
            ),
        ),
    ]
