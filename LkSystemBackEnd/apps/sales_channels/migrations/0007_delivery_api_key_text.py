from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales_channels', '0006_rename_delivery_api_to_key'),
    ]

    operations = [
        migrations.AlterField(
            model_name='saleschannel',
            name='delivery_api_key',
            field=models.TextField(
                blank=True,
                default='',
                help_text='API key for the third-party delivery service (WooCommerce channels)',
                verbose_name='Delivery API Key',
            ),
        ),
    ]
