"""
Signals — keep aggregated stats in sync when raw orders change.

We listen to Order and OrderLine post_save / post_delete. The recompute task
is enqueued via ``transaction.on_commit`` so the database state the worker
reads is the committed one.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.bi.tasks import recompute_for_bucket
from apps.orders.models import Order, OrderLine

logger = logging.getLogger(__name__)


def _bucket_for_order(order: Order):
    if not order:
        return None
    if not order.company_id or not order.brand_id or not order.created_at:
        return None
    created = order.created_at
    day = (timezone.localtime(created).date()
           if timezone.is_aware(created) else created.date())
    return order.company_id, order.brand_id, day.isoformat()


def _enqueue(order: Order) -> None:
    bucket = _bucket_for_order(order)
    if not bucket:
        return
    company_id, brand_id, day = bucket

    def _dispatch():
        try:
            recompute_for_bucket.delay(company_id, brand_id, day)
        except Exception as exc:  # pragma: no cover — broker may be down
            logger.warning('BI: enqueue failed, running inline: %s', exc)
            recompute_for_bucket(company_id, brand_id, day)

    transaction.on_commit(_dispatch)


@receiver(post_save, sender=Order)
def order_saved(sender, instance: Order, **kwargs):
    _enqueue(instance)


@receiver(post_delete, sender=Order)
def order_deleted(sender, instance: Order, **kwargs):
    _enqueue(instance)


@receiver(post_save, sender=OrderLine)
def order_line_saved(sender, instance: OrderLine, **kwargs):
    if instance.order_id:
        _enqueue(instance.order)


@receiver(post_delete, sender=OrderLine)
def order_line_deleted(sender, instance: OrderLine, **kwargs):
    if instance.order_id:
        try:
            _enqueue(instance.order)
        except Order.DoesNotExist:
            return
