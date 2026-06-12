"""Phase 1+2 of the single-lifecycle-field refactor.

Adds the audit columns, repoints ``status`` at the canonical 8-value
lifecycle, and maps every existing row from the legacy lifecycle fields
(order_status / workflow_status / outcome / contact_status / delivery_status /
packaging_status / return_exchange_status / final_outcome / legacy status)
into the new value. The legacy columns are intentionally still present —
they are dropped in the NEXT migration (phase 4), so this one is safe to
run while old code is still deployed.
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def _target_status(order) -> str:
    """Priority mapping (highest wins): canceled > returned > done >
    packaging > confirmed > not_answered > delayed > new."""
    # Canceled has the highest priority.
    if (
        order.order_status == 'canceled'
        or order.outcome == 'CANCELLED'
        or order.status == 'CANCELLED'
        or order.final_outcome in ('CANCELLED_BEFORE_DELIVERY', 'CANCELLED_AFTER_DELIVERY')
        or order.auto_cancelled_at is not None
    ):
        return 'canceled'
    # Returned (exchanges fold into returned — the goods came back; the
    # replacement lives in the stock-movement ledger).
    if (
        order.order_status == 'returned'
        or order.returned_at is not None
        or order.return_exchange_status in ('RETURNED', 'EXCHANGED')
        or order.final_outcome in ('RETURNED', 'EXCHANGED')
        or order.delivery_status == 'RETURNED'
        or order.status == 'REFUNDED'
    ):
        return 'returned'
    # Done.
    if (
        order.order_status == 'done'
        or order.packaging_status in ('PACKAGED', 'UPDATED')
        or order.pos_validated_at is not None
        or order.delivery_status == 'DELIVERED'
        or order.final_outcome == 'SUCCESSFUL_SALE'
    ):
        return 'done'
    # Packaging (in fulfilment).
    if (
        order.order_status in ('preparing', 'packaging')
        or order.workflow_status in ('packaging', 'sent_to_delivery')
        or order.delivery_status in ('QUEUED', 'SUBMITTED', 'ACCEPTED', 'IN_TRANSIT')
    ):
        return 'packaging'
    # Confirmed.
    if order.order_status == 'confirmed' or order.outcome == 'CONFIRMED':
        return 'confirmed'
    # Not answered.
    if order.order_status == 'not_answered' or order.contact_status == 'NOT_ANSWERED':
        return 'not_answered'
    # Delayed.
    if (
        order.order_status == 'delayed'
        or order.contact_status == 'DELAYED'
        or order.outcome == 'DELAYED'
    ):
        return 'delayed'
    return 'new'


def map_legacy_lifecycle(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    batch, BATCH_SIZE = [], 500
    qs = Order.objects.all().only(
        'id', 'status', 'order_status', 'workflow_status', 'outcome',
        'contact_status', 'delivery_status', 'packaging_status',
        'return_exchange_status', 'final_outcome', 'returned_at',
        'pos_validated_at', 'auto_cancelled_at',
    )
    for order in qs.iterator(chunk_size=BATCH_SIZE):
        order.status = _target_status(order)
        batch.append(order)
        if len(batch) >= BATCH_SIZE:
            Order.objects.bulk_update(batch, ['status'])
            batch = []
    if batch:
        Order.objects.bulk_update(batch, ['status'])


def noop_reverse(apps, schema_editor):
    # The legacy distinctions cannot be reconstructed once collapsed.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0021_canonical_order_status'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='order',
            name='status_changed_by',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='orders_status_changed',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='order',
            name='status',
            field=models.CharField(
                choices=[
                    ('new', 'New'),
                    ('confirmed', 'Confirmed'),
                    ('not_answered', 'Not Answered'),
                    ('delayed', 'Delayed'),
                    ('packaging', 'Packaging'),
                    ('done', 'Done'),
                    ('returned', 'Returned'),
                    ('canceled', 'Canceled'),
                ],
                db_index=True,
                default='new',
                max_length=24,
            ),
        ),
        migrations.RunPython(map_legacy_lifecycle, noop_reverse),
    ]
