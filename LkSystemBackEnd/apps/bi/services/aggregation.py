"""
Aggregation service — rebuilds per-day rollup rows from raw orders.

Strategy: for a given (company, brand, date) we delete the existing stats
rows and re-insert fresh aggregates computed from raw ``Order`` and
``OrderLine``. This is "incremental at the day-bucket level": only the
affected day is touched, never the full history.

That is simpler and more reliable than delta math and cheap because
``orders.created_at`` is indexed and the per-day row count is small.
"""

from __future__ import annotations

import logging
from datetime import date as date_cls, datetime, timedelta
from decimal import Decimal
from typing import Iterable

from django.db import transaction
from django.db.models import Count, F, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.bi.models import DailyBrandChannelStats, DailyProductResaleStats

logger = logging.getLogger(__name__)


EXCLUDED_ORDER_STATUSES = ('CANCELLED', 'REFUNDED', 'FAILED')


def _to_date(value) -> date_cls:
    if isinstance(value, date_cls) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        if timezone.is_naive(value):
            value = timezone.make_aware(value, timezone.get_current_timezone())
        return timezone.localtime(value).date()
    if isinstance(value, str):
        return datetime.strptime(value, '%Y-%m-%d').date()
    raise ValueError(f'Cannot coerce to date: {value!r}')


def recompute_for_company_brand_date(company_id: int, brand_id: int, day) -> None:
    """Rebuild both rollup tables for one (company, brand, date) bucket."""

    from apps.orders.models import Order, OrderLine

    if not company_id or not brand_id:
        return

    day = _to_date(day)

    base_orders = Order.objects.filter(
        company_id=company_id,
        brand_id=brand_id,
        is_deleted=False,
        created_at__date=day,
    ).exclude(status__in=EXCLUDED_ORDER_STATUSES)

    with transaction.atomic():
        # ── 1. Per-channel daily stats ──────────────────────────────────
        DailyBrandChannelStats.objects.filter(
            company_id=company_id,
            brand_id=brand_id,
            date=day,
        ).delete()

        # Revenue per channel — sum over (qty * unit_price) of active lines
        revenue_by_channel = {
            row['sales_channel_id']: row['revenue']
            for row in (
                OrderLine.objects.filter(
                    order__in=base_orders,
                    is_deleted=False,
                )
                .values('order__sales_channel_id')
                .annotate(
                    sales_channel_id=F('order__sales_channel_id'),
                    revenue=Coalesce(Sum(F('quantity') * F('unit_price')), Value(Decimal('0'))),
                )
                .values('sales_channel_id', 'revenue')
            )
        }

        per_channel = (
            base_orders
            .values('sales_channel_id')
            .annotate(
                orders_count=Count('id', distinct=True),
                customers_count=Count('client_id', distinct=True),
            )
        )

        rows_to_create = []
        for entry in per_channel:
            ch_id = entry['sales_channel_id']
            if not ch_id:
                continue
            rows_to_create.append(
                DailyBrandChannelStats(
                    company_id=company_id,
                    brand_id=brand_id,
                    date=day,
                    sales_channel_id=ch_id,
                    revenue=revenue_by_channel.get(ch_id, Decimal('0')),
                    orders_count=entry['orders_count'] or 0,
                    customers_count=entry['customers_count'] or 0,
                )
            )
        if rows_to_create:
            DailyBrandChannelStats.objects.bulk_create(rows_to_create)

        # ── 2. Per-resale-type daily stats ──────────────────────────────
        DailyProductResaleStats.objects.filter(
            company_id=company_id,
            brand_id=brand_id,
            date=day,
        ).delete()

        per_resale = (
            OrderLine.objects.filter(
                order__in=base_orders,
                is_deleted=False,
                product__isnull=False,
            )
            .values('product__product_type')
            .annotate(
                sales_count=Count('order_id', distinct=True),
                quantity_sold=Coalesce(Sum('quantity'), Value(0)),
                revenue=Coalesce(Sum(F('quantity') * F('unit_price')), Value(Decimal('0'))),
            )
        )

        resale_rows = []
        for entry in per_resale:
            resale_type = entry['product__product_type']
            if not resale_type:
                continue
            resale_rows.append(
                DailyProductResaleStats(
                    company_id=company_id,
                    brand_id=brand_id,
                    date=day,
                    resale_type=resale_type,
                    sales_count=entry['sales_count'] or 0,
                    quantity_sold=entry['quantity_sold'] or 0,
                    revenue=entry['revenue'] or Decimal('0'),
                )
            )
        if resale_rows:
            DailyProductResaleStats.objects.bulk_create(resale_rows)


def recompute_for_order(order) -> None:
    """Rebuild stats for the order's (company, brand, date) bucket."""

    if not order:
        return
    company_id = getattr(order, 'company_id', None)
    brand_id = getattr(order, 'brand_id', None)
    created_at = getattr(order, 'created_at', None)
    if not company_id or not brand_id or not created_at:
        return
    day = timezone.localtime(created_at).date() if timezone.is_aware(created_at) else created_at.date()
    recompute_for_company_brand_date(company_id, brand_id, day)


def recompute_range(
    company_id: int,
    brand_id: int,
    start: date_cls,
    end: date_cls,
) -> int:
    """Rebuild every day in ``[start, end]``. Returns the day count processed."""

    start = _to_date(start)
    end = _to_date(end)
    if end < start:
        return 0
    count = 0
    cursor = start
    while cursor <= end:
        recompute_for_company_brand_date(company_id, brand_id, cursor)
        cursor += timedelta(days=1)
        count += 1
    return count


def affected_buckets_for_order(order) -> Iterable[tuple[int, int, date_cls]]:
    """Yield the (company, brand, date) buckets this order touches."""

    company_id = getattr(order, 'company_id', None)
    brand_id = getattr(order, 'brand_id', None)
    created_at = getattr(order, 'created_at', None)
    if not company_id or not brand_id or not created_at:
        return []
    day = timezone.localtime(created_at).date() if timezone.is_aware(created_at) else created_at.date()
    return [(company_id, brand_id, day)]
