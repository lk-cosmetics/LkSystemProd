"""
Migration: replace delivery_api (URLField) with delivery_api_key (CharField).
The previous migration (0005) added delivery_api as a URLField; this migration
corrects that to a plain API-key CharField and renames the column.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales_channels', '0005_web_channel_fields'),
    ]

    operations = [
        # Remove the old URLField column
        migrations.RemoveField(
            model_name='saleschannel',
            name='delivery_api',
        ),
        # Add the correct CharField for an API key
        migrations.AddField(
            model_name='saleschannel',
            name='delivery_api_key',
            field=models.CharField(
                blank=True,
                default='',
                max_length=255,
                verbose_name='Delivery API Key',
                help_text='API key for the third-party delivery service (WooCommerce channels)',
            ),
        ),
    ]
