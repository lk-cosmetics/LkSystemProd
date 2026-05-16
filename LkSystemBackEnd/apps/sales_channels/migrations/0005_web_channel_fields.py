"""
Migration: add WEB channel type, state and delivery_api fields to SalesChannel.
NOTE: delivery_api was later replaced by delivery_api_key in migration 0006.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales_channels', '0004_remove_saleschannel_woocommerce_config_and_more'),
    ]

    operations = [
        # 1. Add state / governorate field
        migrations.AddField(
            model_name='saleschannel',
            name='state',
            field=models.CharField(
                blank=True,
                default='',
                max_length=100,
                verbose_name='State / Governorate',
            ),
        ),
        # 2. Add delivery_api URL field (replaced by delivery_api_key in 0006)
        migrations.AddField(
            model_name='saleschannel',
            name='delivery_api',
            field=models.URLField(
                blank=True,
                default='',
                max_length=500,
                verbose_name='Delivery API URL',
            ),
        ),
        # 3. Extend channel_type choices to include WEB
        migrations.AlterField(
            model_name='saleschannel',
            name='channel_type',
            field=models.CharField(
                choices=[
                    ('WOOCOMMERCE', 'WooCommerce'),
                    ('POS', 'Point of Sale'),
                    ('WEB', 'Web'),
                ],
                max_length=20,
                verbose_name='Channel Type',
            ),
        ),
    ]
