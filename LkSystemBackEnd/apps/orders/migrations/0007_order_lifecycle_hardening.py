import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('orders', '0006_order_billing_company_address2'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='import_hash',
            field=models.CharField(blank=True, db_index=True, default='', help_text='Fallback idempotency hash for imports without an external ID', max_length=64),
        ),
        migrations.AddField(
            model_name='order',
            name='in_store_pickup',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='order',
            name='sent_to_pos_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='sent_to_pos_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='orders_sent_to_pos', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='order',
            name='pos_validated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='pos_validated_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='orders_pos_validated', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='order',
            name='delivery_submitted_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='orders_sent_to_delivery', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='order',
            name='returned_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='returned_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='orders_marked_returned', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='order',
            name='return_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='order',
            name='stock_restored_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='stock_restored_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='orders_stock_restored', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='order',
            name='delete_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='orderline',
            name='external_line_id',
            field=models.CharField(blank=True, db_index=True, default='', help_text='WooCommerce line item ID or generated stable line key', max_length=100),
        ),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.UniqueConstraint(condition=~models.Q(import_hash=''), fields=('company', 'sales_channel', 'import_hash'), name='unique_order_import_hash_per_channel'),
        ),
        migrations.AddConstraint(
            model_name='orderline',
            constraint=models.UniqueConstraint(condition=~models.Q(external_line_id=''), fields=('order', 'external_line_id'), name='unique_order_line_external_id'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'outcome', 'delivery_status'], name='order_lifecycle_priority_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'in_store_pickup'], name='order_pickup_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'stock_restored_at'], name='order_stock_restore_idx'),
        ),
        migrations.AddIndex(
            model_name='orderline',
            index=models.Index(fields=['order', 'external_line_id'], name='order_line_ext_id_idx'),
        ),
        migrations.AlterField(
            model_name='orderlog',
            name='action',
            field=models.CharField(choices=[
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
                ('SENT_TO_POS', 'Sent to POS'),
                ('POS_VALIDATED', 'POS Validated'),
                ('RETURN_PROCESSED', 'Return Processed'),
                ('STOCK_RESTORED', 'Stock Restored'),
            ], max_length=30),
        ),
    ]
