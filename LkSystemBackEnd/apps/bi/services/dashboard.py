"""
Dashboard read service.

Reads from the aggregated rollup tables (cheap to query) and combines the
result with one targeted raw-table query for ``customers_count`` (so the
COUNT DISTINCT semantic across the whole period stays correct).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_cls, datetime, timedelta
from decimal import Decimal
from typing import Optional

from django.db.models import Count, F, Sum, Value
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from apps.bi.models import DailyBrandChannelStats, DailyProductResaleStats


PERIOD_CHOICES = ('7d', '30d', '3m', 'ytd', 'custom')

# Hard upper bound on a user-supplied custom window. 2 years is well past
# any reporting use case and keeps a single dashboard request cheap even
# with the daily-rollup tables.
MAX_CUSTOM_RANGE_DAYS = 730


# ── Channel bucket mapping ──────────────────────────────────────────────
WEBSITE_CHANNEL_TYPES = ('WOOCOMMERCE', 'WEB')
POS_CHANNEL_TYPES = ('POS',)


def _channel_bucket(channel_type: Optional[str]) -> str:
    if not channel_type:
        return 'Other'
    if channel_type in WEBSITE_CHANNEL_TYPES:
        return 'Website'
    if channel_type in POS_CHANNEL_TYPES:
        return 'POS'
    return 'Other'


# ── Period helpers ──────────────────────────────────────────────────────

@dataclass(frozen=True)
class PeriodRange:
    start: date_cls
    end: date_cls  # inclusive

    @property
    def length_days(self) -> int:
        return (self.end - self.start).days + 1


def _parse_date(raw) -> Optional[date_cls]:
    if not raw:
        return None
    if isinstance(raw, date_cls):
        return raw
    try:
        return datetime.strptime(str(raw)[:10], '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def period_range(
    period: str,
    today: Optional[date_cls] = None,
    *,
    start_date=None,
    end_date=None,
) -> PeriodRange:
    """
    Resolve a (start, end) inclusive date window.

    For predefined periods (7d / 30d / 3m / ytd) the window is rolled off
    ``today``. For ``period='custom'`` we honour the explicit ``start_date``
    / ``end_date`` (capped at ``MAX_CUSTOM_RANGE_DAYS`` so the rollup
    queries stay cheap). An invalid custom range falls back to 30d.
    """
    today = today or timezone.localtime(timezone.now()).date()
    period = (period or '30d').lower()

    if period == 'custom':
        start = _parse_date(start_date)
        end = _parse_date(end_date)
        if start and end and end >= start:
            length = (end - start).days + 1
            if length > MAX_CUSTOM_RANGE_DAYS:
                start = end - timedelta(days=MAX_CUSTOM_RANGE_DAYS - 1)
            return PeriodRange(start, end)
        # Malformed custom window — fall through to default 30d below.

    if period == '7d':
        return PeriodRange(today - timedelta(days=6), today)
    if period == '3m':
        return PeriodRange(today - timedelta(days=89), today)
    if period == 'ytd':
        return PeriodRange(date_cls(today.year, 1, 1), today)
    # Default 30d
    return PeriodRange(today - timedelta(days=29), today)


def _previous_range(current: PeriodRange) -> PeriodRange:
    length = current.length_days
    prev_end = current.start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)
    return PeriodRange(prev_start, prev_end)


def _safe_div(numerator, denominator):
    try:
        if not denominator:
            return Decimal('0')
        return Decimal(numerator) / Decimal(denominator)
    except (TypeError, ZeroDivisionError):
        return Decimal('0')


def _growth_rate(current, previous) -> Decimal:
    """((current - previous) / previous) * 100, with /0 safety."""

    current = Decimal(current or 0)
    previous = Decimal(previous or 0)
    if previous == 0:
        if current == 0:
            return Decimal('0')
        return Decimal('100')
    return ((current - previous) / previous) * Decimal('100')


# ── Base queryset filters ────────────────────────────────────────────────

def _filter_stats(qs, *, company_id, brand_id, start, end):
    qs = qs.filter(date__gte=start, date__lte=end)
    if company_id:
        qs = qs.filter(company_id=company_id)
    if brand_id:
        qs = qs.filter(brand_id=brand_id)
    return qs


def _filter_orders(qs, *, company_id, brand_id, start, end):
    qs = qs.filter(
        is_deleted=False,
        created_at__date__gte=start,
        created_at__date__lte=end,
    ).exclude(status__in=('CANCELLED', 'REFUNDED', 'FAILED'))
    if company_id:
        qs = qs.filter(company_id=company_id)
    if brand_id:
        qs = qs.filter(brand_id=brand_id)
    return qs


# ── Public read API ──────────────────────────────────────────────────────

def summary(*, company_id, brand_id, period: str, start_date=None, end_date=None) -> dict:
    from apps.orders.models import Order

    rng = period_range(period, start_date=start_date, end_date=end_date)
    prev = _previous_range(rng)

    stats = _filter_stats(
        DailyBrandChannelStats.objects.select_related('sales_channel'),
        company_id=company_id, brand_id=brand_id, start=rng.start, end=rng.end,
    )

    per_bucket = {}
    for row in stats.values('sales_channel__channel_type').annotate(
        revenue=Coalesce(Sum('revenue'), Value(Decimal('0'))),
        orders_count=Coalesce(Sum('orders_count'), Value(0)),
    ):
        bucket = _channel_bucket(row['sales_channel__channel_type'])
        b = per_bucket.setdefault(bucket, {'revenue': Decimal('0'), 'orders': 0})
        b['revenue'] += row['revenue']
        b['orders'] += row['orders_count']

    website_revenue = per_bucket.get('Website', {}).get('revenue', Decimal('0'))
    pos_revenue = per_bucket.get('POS', {}).get('revenue', Decimal('0'))

    totals = stats.aggregate(
        total_revenue=Coalesce(Sum('revenue'), Value(Decimal('0'))),
        total_orders=Coalesce(Sum('orders_count'), Value(0)),
    )
    total_revenue = totals['total_revenue']
    total_orders = totals['total_orders']

    # Customers — count DISTINCT across the entire period from raw orders
    customers_count = (
        _filter_orders(Order.objects.all(), company_id=company_id, brand_id=brand_id,
                       start=rng.start, end=rng.end)
        .exclude(client_id__isnull=True)
        .values('client_id').distinct().count()
    )

    # Previous period — revenue & orders for growth
    prev_totals = _filter_stats(
        DailyBrandChannelStats.objects.all(),
        company_id=company_id, brand_id=brand_id, start=prev.start, end=prev.end,
    ).aggregate(
        prev_revenue=Coalesce(Sum('revenue'), Value(Decimal('0'))),
        prev_orders=Coalesce(Sum('orders_count'), Value(0)),
    )
    prev_revenue = prev_totals['prev_revenue']
    prev_orders = prev_totals['prev_orders']
    prev_customers = (
        _filter_orders(Order.objects.all(), company_id=company_id, brand_id=brand_id,
                       start=prev.start, end=prev.end)
        .exclude(client_id__isnull=True)
        .values('client_id').distinct().count()
    )

    average_order_value = _safe_div(total_revenue, total_orders)
    prev_aov = _safe_div(prev_revenue, prev_orders)

    revenue_growth = _growth_rate(total_revenue, prev_revenue)
    orders_growth = _growth_rate(total_orders, prev_orders)
    customers_growth = _growth_rate(customers_count, prev_customers)
    aov_growth = _growth_rate(average_order_value, prev_aov)

    # ── Insights ────────────────────────────────────────────────────────
    best_channel = None
    if website_revenue > pos_revenue and website_revenue > 0:
        best_channel = 'Website'
    elif pos_revenue > 0:
        best_channel = 'POS'

    total_channels = website_revenue + pos_revenue
    concentration = float(_safe_div(
        max(website_revenue, pos_revenue),
        total_channels,
    ) * 100) if total_channels else 0.0

    warnings = []
    if concentration >= 80 and total_channels > 0:
        leading = 'Website' if website_revenue >= pos_revenue else 'POS'
        warnings.append({
            'code': 'channel_concentration',
            'message': f'{leading} accounts for {concentration:.0f}% of revenue.',
            'severity': 'warning',
        })

    if revenue_growth <= -20:
        brand_health = 'critical'
    elif revenue_growth < 0 or warnings:
        brand_health = 'warning'
    else:
        brand_health = 'healthy'

    return {
        'period': period,
        'period_start': rng.start.isoformat(),
        'period_end': rng.end.isoformat(),
        'previous_period_start': prev.start.isoformat(),
        'previous_period_end': prev.end.isoformat(),

        'total_revenue': str(total_revenue),
        'orders_count': int(total_orders),
        'customers_count': int(customers_count),
        'average_order_value': str(average_order_value.quantize(Decimal('0.01'))),

        'website_revenue': str(website_revenue),
        'pos_revenue': str(pos_revenue),

        'previous': {
            'total_revenue': str(prev_revenue),
            'orders_count': int(prev_orders),
            'customers_count': int(prev_customers),
            'average_order_value': str(prev_aov.quantize(Decimal('0.01'))),
        },

        'growth': {
            'revenue': float(revenue_growth.quantize(Decimal('0.01'))),
            'orders': float(orders_growth.quantize(Decimal('0.01'))),
            'customers': float(customers_growth.quantize(Decimal('0.01'))),
            'average_order_value': float(aov_growth.quantize(Decimal('0.01'))),
        },

        'insights': {
            'best_channel': best_channel,
            'channel_concentration_pct': round(concentration, 2),
            'brand_health': brand_health,
            'warnings': warnings,
        },
    }


def sales_chart(*, company_id, brand_id, period: str, start_date=None, end_date=None) -> dict:
    rng = period_range(period, start_date=start_date, end_date=end_date)
    stats = _filter_stats(
        DailyBrandChannelStats.objects.select_related('sales_channel'),
        company_id=company_id, brand_id=brand_id, start=rng.start, end=rng.end,
    )

    by_day: dict[date_cls, dict] = {}

    # Initialise every day with zeros so the chart has no gaps
    cursor = rng.start
    while cursor <= rng.end:
        by_day[cursor] = {
            'date': cursor.isoformat(),
            'revenue': Decimal('0'),
            'orders_count': 0,
            'website_revenue': Decimal('0'),
            'pos_revenue': Decimal('0'),
        }
        cursor += timedelta(days=1)

    for row in stats.values(
        'date',
        'sales_channel__channel_type',
    ).annotate(
        revenue=Coalesce(Sum('revenue'), Value(Decimal('0'))),
        orders=Coalesce(Sum('orders_count'), Value(0)),
    ):
        day = row['date']
        if day not in by_day:
            continue
        bucket = _channel_bucket(row['sales_channel__channel_type'])
        entry = by_day[day]
        entry['revenue'] += row['revenue']
        entry['orders_count'] += row['orders']
        if bucket == 'Website':
            entry['website_revenue'] += row['revenue']
        elif bucket == 'POS':
            entry['pos_revenue'] += row['revenue']

    series = []
    for day in sorted(by_day):
        e = by_day[day]
        series.append({
            'date': e['date'],
            'revenue': str(e['revenue']),
            'orders_count': int(e['orders_count']),
            'website_revenue': str(e['website_revenue']),
            'pos_revenue': str(e['pos_revenue']),
        })

    return {
        'period': period,
        'period_start': rng.start.isoformat(),
        'period_end': rng.end.isoformat(),
        'series': series,
    }


def sales_channel_chart(*, company_id, brand_id, period: str, start_date=None, end_date=None) -> dict:
    """
    Per-channel daily revenue series.

    Returns the channel metadata alongside a wide-format ``series`` array
    where every row has the date plus one column per ``ch_<id>`` carrying
    that channel's revenue for the day. This is the shape Recharts likes
    for stacked area / multi-line charts driven by a dynamic ChartConfig.
    """

    from apps.sales_channels.models import SalesChannel

    rng = period_range(period, start_date=start_date, end_date=end_date)
    stats = _filter_stats(
        DailyBrandChannelStats.objects.all(),
        company_id=company_id, brand_id=brand_id, start=rng.start, end=rng.end,
    )

    # Resolve channel metadata once (active channels with any data in the period).
    channel_ids = list(stats.values_list('sales_channel_id', flat=True).distinct())
    channels = list(
        SalesChannel.objects
        .select_related('brand')
        .filter(pk__in=channel_ids)
        .order_by('name')
    )
    channel_meta = [
        {
            'id': ch.id,
            'key': f'ch_{ch.id}',
            'name': ch.name,
            'code': ch.code,
            'channel_type': ch.channel_type,
            'channel_bucket': _channel_bucket(ch.channel_type),
            'brand_name': ch.brand.name if ch.brand_id else None,
        }
        for ch in channels
    ]

    # Initialise every day x channel with 0 so the chart has no gaps.
    by_day: dict[date_cls, dict] = {}
    cursor = rng.start
    while cursor <= rng.end:
        row = {'date': cursor.isoformat()}
        for ch in channel_meta:
            row[ch['key']] = 0.0
        by_day[cursor] = row
        cursor += timedelta(days=1)

    for r in stats.values('date', 'sales_channel_id').annotate(
        revenue=Coalesce(Sum('revenue'), Value(Decimal('0'))),
    ):
        day = r['date']
        if day not in by_day:
            continue
        key = f'ch_{r["sales_channel_id"]}'
        if key in by_day[day]:
            by_day[day][key] = float(r['revenue'] or 0)

    return {
        'period': period,
        'period_start': rng.start.isoformat(),
        'period_end': rng.end.isoformat(),
        'channels': channel_meta,
        'series': [by_day[d] for d in sorted(by_day)],
    }


def _products_aggregate(base_orders):
    """Aggregate OrderLine by product for the given Order queryset."""

    from apps.orders.models import OrderLine

    return (
        OrderLine.objects.filter(
            order__in=base_orders,
            is_deleted=False,
            product__isnull=False,
        )
        .values(
            'product_id',
            'product__name',
            'product__barcode',
            'product__product_type',
        )
        .annotate(
            sales_count=Count('order_id', distinct=True),
            quantity_sold=Coalesce(Sum('quantity'), Value(0)),
            revenue=Coalesce(Sum(F('quantity') * F('unit_price')), Value(Decimal('0'))),
        )
    )


def _paginate_slice(qs_or_list, *, page: int, page_size: int):
    """Return (sliced_iterable, total_count, total_pages, page) for offset pagination.

    Accepts either a Django QuerySet (uses ``.count()``) or a plain sequence
    (uses ``len()``). We distinguish by ``model`` attribute presence so we
    don't accidentally call the wrong ``count`` overload — ``list.count``
    expects a value to count occurrences of, not a row count.
    """

    if hasattr(qs_or_list, 'model'):  # Django QuerySet
        total = qs_or_list.count()
    else:
        total = len(qs_or_list)

    if page_size <= 0:
        page_size = 10
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))
    start = (page - 1) * page_size
    end = start + page_size
    return qs_or_list[start:end], total, total_pages, page


def _products_payload(
    *,
    company_id,
    brand_id,
    period: str,
    start_date,
    end_date,
    page: int,
    page_size: int,
    ascending: bool,
    resell_only: bool = False,
    require_revenue: bool = False,
) -> dict:
    """Shared core for ``top_products`` and ``bad_products``.

    Knobs:
      - ``ascending``: top vs bad ordering.
      - ``resell_only``: restrict the population to ``product_type='resell'``.
      - ``require_revenue``: drop rows with revenue <= 0 (refunded / voided
        lines) — useful to keep the bad-products table to genuine slow-movers
        rather than zero-value noise.
    """
    from apps.orders.models import Order

    rng = period_range(period, start_date=start_date, end_date=end_date)
    base_orders = _filter_orders(
        Order.objects.all(),
        company_id=company_id, brand_id=brand_id,
        start=rng.start, end=rng.end,
    )

    qs = _products_aggregate(base_orders)
    if resell_only:
        qs = qs.filter(product__product_type='resell')
    if require_revenue:
        qs = qs.filter(revenue__gt=0)
    qs = qs.order_by(
        'revenue' if ascending else '-revenue',
        'quantity_sold' if ascending else '-quantity_sold',
    )
    sliced, count, total_pages, page = _paginate_slice(qs, page=page, page_size=page_size)

    return {
        'period': period,
        'period_start': rng.start.isoformat(),
        'period_end': rng.end.isoformat(),
        'count': count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
        'results': [
            {
                'product_id': r['product_id'],
                'name': r['product__name'],
                'barcode': r['product__barcode'],
                'product_type': r['product__product_type'],
                'sales_count': int(r['sales_count'] or 0),
                'quantity_sold': int(r['quantity_sold'] or 0),
                'revenue': str(r['revenue'] or Decimal('0')),
            }
            for r in sliced
        ],
    }


def top_products(
    *, company_id, brand_id, period: str,
    page: int = 1, page_size: int = 10,
    start_date=None, end_date=None,
) -> dict:
    """Products ordered by revenue desc, with offset pagination."""
    return _products_payload(
        company_id=company_id, brand_id=brand_id, period=period,
        start_date=start_date, end_date=end_date,
        page=page, page_size=page_size, ascending=False,
    )


def bad_products(
    *, company_id, brand_id, period: str,
    page: int = 1, page_size: int = 10,
    start_date=None, end_date=None,
) -> dict:
    """
    Worst-performing resell products in the period.

    Scope:
      - Only ``product_type='resell'`` — packaging / raw-material / finished
        goods are inventory lines, not a buyer's slow-mover problem.
      - Only products that *did* sell (revenue > 0). A row with zero revenue
        usually means a refunded or 100%-discounted line and would be noise
        for someone trying to spot lines to promote or discontinue.

    Ordering: revenue ascending, then quantity ascending — the slowest
    movers surface first.
    """
    return _products_payload(
        company_id=company_id, brand_id=brand_id, period=period,
        start_date=start_date, end_date=end_date,
        page=page, page_size=page_size, ascending=True,
        resell_only=True, require_revenue=True,
    )


def trending_products(
    *, company_id, brand_id, period: str,
    page: int = 1, page_size: int = 10,
    start_date=None, end_date=None,
) -> dict:
    """
    Products with the biggest revenue growth vs the previous period.

    Only products that have sales in the current period are considered.
    Products with no previous-period sales but non-zero current revenue
    are flagged with ``growth_pct = None`` and treated as "new".
    """

    from apps.orders.models import Order

    rng = period_range(period, start_date=start_date, end_date=end_date)
    prev = _previous_range(rng)

    current_orders = _filter_orders(
        Order.objects.all(),
        company_id=company_id, brand_id=brand_id,
        start=rng.start, end=rng.end,
    )
    previous_orders = _filter_orders(
        Order.objects.all(),
        company_id=company_id, brand_id=brand_id,
        start=prev.start, end=prev.end,
    )

    current_rows = {
        r['product_id']: r
        for r in _products_aggregate(current_orders)
    }
    previous_revenue = {
        r['product_id']: (r['revenue'] or Decimal('0'))
        for r in _products_aggregate(previous_orders)
    }

    enriched = []
    for pid, r in current_rows.items():
        prev_rev = previous_revenue.get(pid, Decimal('0'))
        cur_rev = r['revenue'] or Decimal('0')
        if prev_rev == 0:
            growth_pct = None  # "new" — no prior baseline
            sort_key = (1, float(cur_rev))  # rank new products by absolute revenue
        else:
            growth_pct = float(_growth_rate(cur_rev, prev_rev))
            sort_key = (0, growth_pct)
        enriched.append({
            'product_id': pid,
            'name': r['product__name'],
            'barcode': r['product__barcode'],
            'product_type': r['product__product_type'],
            'sales_count': int(r['sales_count'] or 0),
            'quantity_sold': int(r['quantity_sold'] or 0),
            'revenue': str(cur_rev),
            'previous_revenue': str(prev_rev),
            'growth_pct': growth_pct,
            '_sort': sort_key,
        })

    # Highest growth first, then "new" products by revenue, then drop the helper.
    enriched.sort(key=lambda x: x['_sort'], reverse=True)
    for row in enriched:
        row.pop('_sort', None)

    sliced, count, total_pages, page = _paginate_slice(
        enriched, page=page, page_size=page_size,
    )

    return {
        'period': period,
        'period_start': rng.start.isoformat(),
        'period_end': rng.end.isoformat(),
        'previous_period_start': prev.start.isoformat(),
        'previous_period_end': prev.end.isoformat(),
        'count': count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
        'results': list(sliced),
    }


def sales_channel_revenue(
    *, company_id, brand_id, period: str,
    page: int = 1, page_size: int = 10,
    start_date=None, end_date=None,
) -> dict:
    """
    Per individual sales channel (not just Website/POS buckets).

    Returns one row per ``SalesChannel`` that has activity during the period,
    with ``revenue``, ``orders_count``, the channel's display name and type,
    and the share of total revenue.
    """

    from apps.sales_channels.models import SalesChannel

    rng = period_range(period, start_date=start_date, end_date=end_date)
    stats = _filter_stats(
        DailyBrandChannelStats.objects.all(),
        company_id=company_id, brand_id=brand_id, start=rng.start, end=rng.end,
    )

    agg = (
        stats.values('sales_channel_id')
        .annotate(
            revenue=Coalesce(Sum('revenue'), Value(Decimal('0'))),
            orders_count=Coalesce(Sum('orders_count'), Value(0)),
        )
        .order_by('-revenue')
    )
    rows_by_channel = {r['sales_channel_id']: r for r in agg}

    # Bulk-load channel metadata (name, type, brand) — one query
    channels = {
        c.id: c for c in SalesChannel.objects
        .select_related('brand')
        .filter(pk__in=rows_by_channel.keys())
    }

    total_revenue = sum((r['revenue'] for r in rows_by_channel.values()), Decimal('0'))

    results = []
    for ch_id, row in rows_by_channel.items():
        ch = channels.get(ch_id)
        if not ch:
            continue
        revenue = row['revenue'] or Decimal('0')
        share = float(_safe_div(revenue, total_revenue) * 100) if total_revenue else 0.0
        results.append({
            'sales_channel_id': ch.id,
            'name': ch.name,
            'code': ch.code,
            'channel_type': ch.channel_type,
            'channel_bucket': _channel_bucket(ch.channel_type),
            'brand_id': ch.brand_id,
            'brand_name': ch.brand.name if ch.brand_id else None,
            'revenue': str(revenue),
            'orders_count': int(row['orders_count'] or 0),
            'share_pct': round(share, 2),
        })

    # Already sorted by revenue desc thanks to the QuerySet ordering
    sliced, count, total_pages, page = _paginate_slice(
        results, page=page, page_size=page_size,
    )

    return {
        'period': period,
        'period_start': rng.start.isoformat(),
        'period_end': rng.end.isoformat(),
        'total_revenue': str(total_revenue),
        'count': count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
        'results': list(sliced),
    }


def product_resale_types(*, company_id, brand_id, period: str, start_date=None, end_date=None) -> dict:
    rng = period_range(period, start_date=start_date, end_date=end_date)
    qs = _filter_stats(
        DailyProductResaleStats.objects.all(),
        company_id=company_id, brand_id=brand_id, start=rng.start, end=rng.end,
    )

    rows = qs.values('resale_type').annotate(
        sales_count=Coalesce(Sum('sales_count'), Value(0)),
        quantity_sold=Coalesce(Sum('quantity_sold'), Value(0)),
        revenue=Coalesce(Sum('revenue'), Value(Decimal('0'))),
    ).order_by('-revenue')

    return {
        'period': period,
        'period_start': rng.start.isoformat(),
        'period_end': rng.end.isoformat(),
        'results': [
            {
                'resale_type': r['resale_type'],
                'sales_count': int(r['sales_count'] or 0),
                'quantity_sold': int(r['quantity_sold'] or 0),
                'revenue': str(r['revenue'] or Decimal('0')),
            }
            for r in rows
        ],
    }
