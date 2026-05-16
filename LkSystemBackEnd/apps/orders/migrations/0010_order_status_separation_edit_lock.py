from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('orders', '0009_pos_offline_ticket_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='contact_status',
            field=models.CharField(
                choices=[
                    ('NONE', 'Not Contacted'),
                    ('ANSWERED', 'Answered'),
                    ('NOT_ANSWERED', 'Not Answered'),
                    ('DELAYED', 'Delayed'),
                ],
                db_index=True,
                default='NONE',
                help_text='Customer contact result, separate from WooCommerce/order/delivery statuses.',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='return_exchange_status',
            field=models.CharField(
                choices=[
                    ('NONE', 'None'),
                    ('RETURNED', 'Returned'),
                    ('EXCHANGED', 'Exchanged'),
                ],
                db_index=True,
                default='NONE',
                help_text='Explicit return/exchange state used for reporting and counters.',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='edit_locked_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='locked_orders',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='edit_locked_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='edit_lock_heartbeat_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='edit_lock_expires_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='edit_lock_token',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'contact_status', 'delay_date'], name='order_contact_delay_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'return_exchange_status'], name='order_return_exchange_idx'),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'edit_lock_expires_at'], name='order_edit_lock_idx'),
        ),
    ]
