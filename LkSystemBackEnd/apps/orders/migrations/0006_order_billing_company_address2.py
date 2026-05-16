# Generated migration for adding billing_company and billing_address_2 fields

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0005_order_outcome_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='billing_company',
            field=models.CharField(
                blank=True,
                default='',
                max_length=255,
                verbose_name='Billing Company'
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='billing_address_2',
            field=models.CharField(
                blank=True,
                default='',
                max_length=255,
                verbose_name='Billing Address Line 2'
            ),
        ),
    ]
