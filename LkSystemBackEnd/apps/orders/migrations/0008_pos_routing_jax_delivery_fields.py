import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0007_order_lifecycle_hardening'),
        ('sales_channels', '0007_delivery_api_key_text'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='pos_sales_channel',
            field=models.ForeignKey(
                blank=True,
                help_text='POS location selected to fulfill this confirmed order',
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='pos_routed_orders',
                to='sales_channels.saleschannel',
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='delivery_code',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Delivery provider parcel code, for example the JAX EAN/code',
                max_length=100,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='delivery_external_reference',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='External reference echoed by the delivery provider',
                max_length=100,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='delivery_status_id',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='delivery_order_id',
            field=models.PositiveBigIntegerField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='delivery_client_id',
            field=models.PositiveBigIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='delivery_cod_amount',
            field=models.DecimalField(blank=True, decimal_places=3, max_digits=14, null=True),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['company', 'pos_sales_channel'], name='order_pos_channel_idx'),
        ),
    ]
