"""Heal WooCommerce-ingested orders whose delivery fee never reached the total.

Until now ingestion stored the WC courier fee on ``shipping_total`` but left
``delivery_fee`` at 0, and the total recompute only adds ``delivery_fee`` — so
every WooCommerce order's total was missing its shipping fee. Ingestion now
folds ``shipping_total`` into ``delivery_fee``; this backfill applies the same
rule to existing rows and adds the fee onto their stored totals.
"""
from decimal import Decimal

from django.db import migrations
from django.db.models import F


def backfill_delivery_fee(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    Order.objects.filter(
        delivery_fee=Decimal('0.00'),
        shipping_total__gt=Decimal('0.00'),
    ).update(
        delivery_fee=F('shipping_total'),
        total=F('total') + F('shipping_total'),
    )


def noop(apps, schema_editor):
    # The forward pass is additive bookkeeping; reversing would need to know
    # which rows it touched, so the reverse is intentionally a no-op.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0023_drop_legacy_lifecycle_fields'),
    ]

    operations = [
        migrations.RunPython(backfill_delivery_fee, noop),
    ]
