from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0018_order_order_source'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='delivery_fee',
            field=models.DecimalField(
                decimal_places=2, default=Decimal('0.00'), max_digits=14,
            ),
        ),
    ]
