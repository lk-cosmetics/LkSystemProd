# Generated manually - Add store-related fields to SalesChannel

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales_channels', '0002_remove_config_field'),
    ]

    operations = [
        migrations.AddField(
            model_name='saleschannel',
            name='code',
            field=models.CharField(
                blank=True,
                default=None,
                help_text='Unique code for the channel (e.g., WH001, STR-TUN)',
                max_length=20,
                null=True,
                verbose_name='Channel Code',
            ),
        ),
        migrations.AddField(
            model_name='saleschannel',
            name='store_type',
            field=models.CharField(
                choices=[('WAREHOUSE', 'Warehouse'), ('RETAIL', 'Retail Store'), ('DISTRIBUTION', 'Distribution Center')],
                default='WAREHOUSE',
                max_length=20,
                verbose_name='Store Type',
            ),
        ),
        migrations.AddField(
            model_name='saleschannel',
            name='is_default',
            field=models.BooleanField(
                default=False,
                help_text='Default channel for new inventory',
                verbose_name='Default Channel',
            ),
        ),
        migrations.AddField(
            model_name='saleschannel',
            name='address',
            field=models.TextField(
                blank=True,
                default='',
                help_text='Full address of the channel (if applicable)',
                verbose_name='Address',
            ),
        ),
        migrations.AddField(
            model_name='saleschannel',
            name='city',
            field=models.CharField(
                blank=True,
                default='',
                max_length=100,
                verbose_name='City',
            ),
        ),
        migrations.AddField(
            model_name='saleschannel',
            name='phone',
            field=models.CharField(
                blank=True,
                default='',
                max_length=20,
                verbose_name='Phone Number',
            ),
        ),
        migrations.AddField(
            model_name='saleschannel',
            name='email',
            field=models.EmailField(
                blank=True,
                default='',
                max_length=254,
                verbose_name='Email',
            ),
        ),
        migrations.AlterUniqueTogether(
            name='saleschannel',
            unique_together={('brand', 'code')},
        ),
    ]
