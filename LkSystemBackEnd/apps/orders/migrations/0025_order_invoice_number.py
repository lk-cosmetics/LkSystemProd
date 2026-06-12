import re

from django.core.validators import RegexValidator
from django.db import migrations, models
from django.db.models import Q


def backfill_invoice_numbers(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    counters = {}
    orders = (
        Order.objects
        .all()
        .order_by('company_id', 'created_at', 'id')
        .only('id', 'company_id', 'created_at', 'invoice_number')
    )
    for order in orders.iterator():
        if order.invoice_number and re.fullmatch(r'\d{4}/\d+', order.invoice_number):
            year = int(order.invoice_number[:4])
            serial = int(order.invoice_number.split('/', 1)[1])
            counters[(order.company_id, year)] = max(
                counters.get((order.company_id, year), 0),
                serial,
            )
            continue

        year = order.created_at.year
        key = (order.company_id, year)
        counters[key] = counters.get(key, 0) + 1
        order.invoice_number = f'{year}/{counters[key]:03d}'
        order.save(update_fields=['invoice_number'])


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0024_backfill_wc_delivery_fee'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='invoice_number',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                help_text='Sequential invoice identifier in year/number format.',
                max_length=32,
                validators=[
                    RegexValidator(
                        regex=r'^\d{4}/\d+$',
                        message='Invoice number must use the format year/number, for example 2026/001.',
                    ),
                ],
            ),
        ),
        migrations.RunPython(backfill_invoice_numbers, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.UniqueConstraint(
                condition=~Q(invoice_number=''),
                fields=('company', 'invoice_number'),
                name='unique_invoice_number_per_company',
            ),
        ),
    ]
