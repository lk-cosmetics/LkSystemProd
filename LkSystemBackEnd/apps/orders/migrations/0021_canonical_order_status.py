from django.db import migrations, models
from django.db.models import Q


def collapse_to_canonical(apps, schema_editor):
    """Map the legacy 10-value ``order_status`` onto the canonical 6.

    * awaiting_confirmation → new        (one "needs a call" bucket)
    * preparing             → packaging  (rename: sent to fulfilment)
    * returned / exchanged  → done       (the order completed, then came back;
                                          the return/exchange overlay fields
                                          still mark it and exclude it from
                                          queues and success KPIs)
    * canceled              → done when fulfilment evidence exists
                              (packaged / POS-validated / delivered),
                              else new. The cancellation overlay
                              (status/outcome = CANCELLED) keeps the chip.
    """
    Order = apps.get_model('orders', 'Order')

    Order.objects.filter(order_status='awaiting_confirmation').update(order_status='new')
    Order.objects.filter(order_status='preparing').update(order_status='packaging')
    Order.objects.filter(order_status__in=['returned', 'exchanged']).update(order_status='done')

    fulfilled = (
        Q(packaging_status__in=['PACKAGED', 'UPDATED'])
        | Q(pos_validated_at__isnull=False)
        | Q(delivery_status='DELIVERED')
    )
    Order.objects.filter(order_status='canceled').filter(fulfilled).update(order_status='done')
    Order.objects.filter(order_status='canceled').update(order_status='new')


def noop_reverse(apps, schema_editor):
    # The legacy values cannot be reconstructed; the overlay fields still hold
    # the cancel/return information, so reversing is intentionally a no-op.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0020_order_shipping_phone'),
    ]

    operations = [
        migrations.AlterField(
            model_name='order',
            name='order_status',
            field=models.CharField(
                choices=[
                    ('new', 'New'),
                    ('confirmed', 'Confirmed'),
                    ('not_answered', 'Not Answered'),
                    ('delayed', 'Delayed'),
                    ('packaging', 'Packaging'),
                    ('done', 'Done'),
                ],
                default='new',
                help_text='Clean business-lifecycle status (the single status the UI shows).',
                max_length=24,
            ),
        ),
        migrations.RunPython(collapse_to_canonical, noop_reverse),
    ]
