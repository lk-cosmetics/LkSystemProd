from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0028_alter_orderautoassignmentsetting_id_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='cash_amount',
            field=models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=14),
        ),
        migrations.AddField(
            model_name='order',
            name='card_amount',
            field=models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=14),
        ),
        migrations.AddField(
            model_name='order',
            name='amount_received',
            field=models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=14),
        ),
        migrations.AddField(
            model_name='order',
            name='change_returned',
            field=models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=14),
        ),
    ]
