# Migration 0004 — Add brand FK, delivery tracking fields, sync metadata,
# and OrderSyncEvent model.
#
# This migration covers all fields added during the v2 architecture rewrite
# that were missing from previous migrations:
#   • Order.brand            – FK to brands.Brand (nullable)
#   • Order.wc_order_key     – secondary WC idempotency key
#   • Order.wc_meta_data     – indexed WC meta_data dict
#   • Order.raw_wc_payload   – raw WC payload for replay / debug
#   • Order.synced_at        – last successful sync timestamp
#   • Order.delivery_status  – delivery lifecycle status
#   • Order.delivery_reference, delivery_submitted_at,
#          delivery_attempts, delivery_response
#   • OrderSyncEvent         – one row per sync operation (audit + cursor)

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0003_order_architecture_hardening'),
        ('brands', '0001_initial'),
        ('company', '0003_alter_company_abbreviation_alter_company_legal_name'),
        ('sales_channels', '0004_remove_saleschannel_woocommerce_config_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [

        # ── Order.brand ──────────────────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='brand',
            field=django.db.models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='orders',
                to='brands.brand',
            ),
        ),

        # ── Order.wc_order_key ───────────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='wc_order_key',
            field=models.CharField(
                blank=True,
                default='',
                help_text='WooCommerce order_key (wc_xxxx…) — secondary idempotency check',
                max_length=100,
            ),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['wc_order_key'], name='sales_order_wc_key_idx'),
        ),

        # ── Order.wc_meta_data ───────────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='wc_meta_data',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='WooCommerce meta_data indexed by meta_key for O(1) lookup',
            ),
        ),

        # ── Order.raw_wc_payload ─────────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='raw_wc_payload',
            field=models.JSONField(
                blank=True,
                null=True,
                help_text='Raw JSON payload from WooCommerce REST API or webhook',
            ),
        ),

        # ── Order.synced_at ──────────────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='synced_at',
            field=models.DateTimeField(
                blank=True,
                null=True,
                help_text='Last successful sync from WooCommerce',
            ),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['synced_at'], name='sales_order_synced_at_idx'),
        ),

        # ── Order.delivery_status ────────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='delivery_status',
            field=models.CharField(
                choices=[
                    ('NONE',       'Not Applicable'),
                    ('PENDING',    'Pending Submission'),
                    ('QUEUED',     'Queued for Delivery'),
                    ('SUBMITTED',  'Submitted to Provider'),
                    ('ACCEPTED',   'Accepted by Provider'),
                    ('IN_TRANSIT', 'In Transit'),
                    ('DELIVERED',  'Delivered'),
                    ('FAILED',     'Delivery Failed'),
                    ('CANCELLED',  'Delivery Cancelled'),
                    ('RETURNED',   'Returned to Sender'),
                ],
                default='NONE',
                max_length=20,
            ),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['delivery_status'], name='sales_order_dlv_status_idx'),
        ),

        # ── Order.delivery_reference ─────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='delivery_reference',
            field=models.CharField(
                blank=True,
                default='',
                help_text='External delivery provider reference number',
                max_length=100,
            ),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['delivery_reference'], name='sales_order_dlv_ref_idx'),
        ),

        # ── Order.delivery_submitted_at ──────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='delivery_submitted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),

        # ── Order.delivery_attempts ──────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='delivery_attempts',
            field=models.PositiveSmallIntegerField(default=0),
        ),

        # ── Order.delivery_response ──────────────────────────────────────────
        migrations.AddField(
            model_name='order',
            name='delivery_response',
            field=models.JSONField(
                blank=True,
                null=True,
                help_text='Last response body from the delivery provider API',
            ),
        ),

        # ── Composite index for incremental sync (modified_after queries) ────
        migrations.AddIndex(
            model_name='order',
            index=models.Index(
                fields=['sales_channel', 'wc_date_modified'],
                name='sales_order_channel_wc_mod_idx',
            ),
        ),

        # ── OrderSyncEvent model ─────────────────────────────────────────────
        migrations.CreateModel(
            name='OrderSyncEvent',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True, primary_key=True, serialize=False, verbose_name='ID',
                )),
                ('status', models.CharField(
                    choices=[
                        ('RUNNING',   'Running'),
                        ('COMPLETED', 'Completed'),
                        ('PARTIAL',   'Partial (with errors)'),
                        ('FAILED',    'Failed'),
                    ],
                    default='RUNNING',
                    max_length=20,
                )),
                ('trigger_source', models.CharField(
                    choices=[
                        ('MANUAL',  'Manual (API)'),
                        ('CELERY',  'Celery Beat'),
                        ('WEBHOOK', 'Webhook'),
                    ],
                    default='MANUAL',
                    max_length=20,
                )),
                ('sync_from', models.DateTimeField(
                    blank=True, null=True,
                    help_text='modified_after sent to WooCommerce (NULL = full sync)',
                )),
                ('sync_to', models.DateTimeField(
                    blank=True, null=True,
                    help_text='Upper bound of the sync window',
                )),
                ('wc_statuses_synced', models.JSONField(
                    blank=True, default=list,
                    help_text='WC statuses included, e.g. ["processing", "completed"]',
                )),
                ('fetched_count', models.IntegerField(default=0, help_text='Orders fetched from WC')),
                ('created_count', models.IntegerField(default=0)),
                ('updated_count', models.IntegerField(default=0)),
                ('error_count',   models.IntegerField(default=0)),
                ('error_detail',  models.JSONField(blank=True, default=list)),
                ('started_at',    models.DateTimeField(auto_now_add=True)),
                ('finished_at',   models.DateTimeField(blank=True, null=True)),
                ('company', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='order_sync_events',
                    to='company.company',
                )),
                ('sales_channel', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='sync_events',
                    to='sales_channels.saleschannel',
                )),
                ('triggered_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='order_sync_events',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Order Sync Event',
                'verbose_name_plural': 'Order Sync Events',
                'db_table': 'order_sync_event',
                'ordering': ['-started_at'],
            },
        ),
        migrations.AddIndex(
            model_name='ordersyncevent',
            index=models.Index(
                fields=['sales_channel', 'status'],
                name='order_sync_ch_status_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='ordersyncevent',
            index=models.Index(
                fields=['sales_channel', 'started_at'],
                name='order_sync_ch_started_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='ordersyncevent',
            index=models.Index(
                fields=['company', 'started_at'],
                name='order_sync_co_started_idx',
            ),
        ),
    ]
