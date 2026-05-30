"""
Phase B data migration: backfill the new top-layer status fields from the
existing status fields, per apps/orders/STATUS_MAP.md sections 5 and 11.

Additive and safe: it only populates the new columns added in 0015. It never
drops or rewrites existing columns. On an empty table (e.g. the test database)
it is a no-op, and it reverses as a no-op.
"""

from django.db import migrations


_IN_FLIGHT_DELIVERY = ('QUEUED', 'SUBMITTED', 'ACCEPTED', 'IN_TRANSIT')
# SystemSetting default, frozen here so the migration never imports live code.
_NO_ANSWER_MAX_ATTEMPTS = 3


def _derive_order_status(o):
    """Highest match wins — mirrors STATUS_MAP.md section 5.1."""
    if (o.return_exchange_status == 'EXCHANGED'
            or o.return_type == 'EXCHANGED'
            or o.final_outcome == 'EXCHANGED'):
        return 'exchanged'
    if (o.returned_at is not None
            or o.delivery_status == 'RETURNED'
            or o.final_outcome == 'RETURNED'):
        return 'returned'
    if o.status == 'CANCELLED' or o.outcome == 'CANCELLED':
        return 'canceled'
    if (o.packaging_status in ('PACKAGED', 'UPDATED')
            or o.pos_validated_at is not None
            or o.delivery_status == 'DELIVERED'
            or o.final_outcome == 'SUCCESSFUL_SALE'):
        return 'done'
    if o.outcome == 'CONFIRMED' and (
            o.sent_to_pos_at is not None
            or bool(o.delivery_reference)
            or o.delivery_status in _IN_FLIGHT_DELIVERY):
        return 'preparing'
    if o.outcome == 'CONFIRMED':
        return 'confirmed'
    if o.outcome == 'DELAYED' or o.contact_status == 'DELAYED':
        return 'delayed'
    if (o.contact_status == 'NOT_ANSWERED'
            and (o.not_answered_attempts or 0) >= _NO_ANSWER_MAX_ATTEMPTS):
        return 'not_answered'
    if (o.contact_status not in ('NONE', '')
            or (o.not_answered_attempts or 0) >= 1
            or o.outcome_changed_at is not None):
        return 'awaiting_confirmation'
    return 'new'


def _derive_confirmation_status(o):
    """Mirrors STATUS_MAP.md section 5.2."""
    if o.outcome == 'CANCELLED':
        return 'canceled'
    if o.outcome == 'CONFIRMED':
        return 'accepted'
    if o.outcome == 'DELAYED' or o.contact_status == 'DELAYED':
        return 'delayed'
    if o.contact_status == 'NOT_ANSWERED':
        return 'no_answer'
    return 'pending'


def _derive_delivery_method(o):
    """Mirrors STATUS_MAP.md section 5.3."""
    if o.in_store_pickup or o.pos_sales_channel_id is not None or o.source == 'POS':
        return 'pos_pickup'
    return 'home_delivery'


def backfill(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    fields = ['order_status', 'confirmation_status', 'delivery_method', 'last_sync_at']
    batch = []
    # Plain historical manager => iterates ALL rows, including soft-deleted.
    for o in Order.objects.all().iterator(chunk_size=500):
        o.order_status = _derive_order_status(o)
        o.confirmation_status = _derive_confirmation_status(o)
        o.delivery_method = _derive_delivery_method(o)
        o.last_sync_at = o.synced_at
        # sync_status stays 'imported' (the default) for all existing rows.
        batch.append(o)
        if len(batch) >= 500:
            Order.objects.bulk_update(batch, fields)
            batch.clear()
    if batch:
        Order.objects.bulk_update(batch, fields)


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0015_order_status_fields'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
