"""Add Order.stock_reserved — tracks whether an order currently holds a stock
reservation (reserved at confirm for online / manual-delivery orders, released
at completion or cancellation). Idempotency flag for the reservation service.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0016_backfill_order_status_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='stock_reserved',
            field=models.BooleanField(default=False, db_index=True),
        ),
    ]
