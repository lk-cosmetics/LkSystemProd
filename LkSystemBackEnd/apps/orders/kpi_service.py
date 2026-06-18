"""KPI aggregations computed from the canonical ``Order.status``.

The dashboard counts only genuinely successful sales: ``done``. ``returned``
and ``canceled`` are real lifecycle statuses, so the buckets read straight
off the one field — no overlay logic. Pure read service; every queryset is
tenant-scoped by the caller.
"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Count, Q, QuerySet, Sum

from apps.orders.models import Order


class OrderKPIService:
    """Compute order KPIs from the canonical ``status``."""

    @classmethod
    def base_queryset(
        cls,
        *,
        company,
        brand=None,
        sales_channel=None,
        start=None,
        end=None,
    ) -> QuerySet:
        qs = Order.objects.filter(company=company, is_deleted=False)
        if brand is not None:
            qs = qs.filter(brand=brand)
        if sales_channel is not None:
            qs = qs.filter(sales_channel=sales_channel)
        if start is not None:
            qs = qs.filter(created_at__gte=start)
        if end is not None:
            qs = qs.filter(created_at__lte=end)
        return qs

    @classmethod
    def compute(cls, *, company=None, queryset: QuerySet | None = None, **filters) -> dict:
        """Return a KPI dict (one DB round-trip).

        Pass either an explicit ``queryset`` (already tenant-scoped by the
        caller) or a ``company`` plus optional ``brand`` / ``sales_channel`` /
        ``start`` / ``end`` filters.
        """
        if queryset is None:
            if company is None:
                raise ValueError('OrderKPIService.compute requires company or queryset.')
            queryset = cls.base_queryset(company=company, **filters)

        S = Order.Status
        agg = queryset.aggregate(
            total_orders=Count('id'),
            **{
                f'st_{value}': Count('id', filter=Q(status=value))
                for value, _ in S.choices
            },
            revenue=Sum('total', filter=Q(status=S.DONE)),
        )
        by_status = {value: agg[f'st_{value}'] for value, _ in S.choices}

        return {
            'total_orders': agg['total_orders'],
            'by_status': by_status,
            'successful_sales': by_status.get(S.DONE, 0),
            'revenue': agg['revenue'] or Decimal('0.00'),
            'returned': by_status.get(S.RETURNED, 0),
            'canceled': by_status.get(S.CANCELED, 0),
            'in_confirmation': (
                by_status.get(S.NEW, 0)
                + by_status.get(S.DELAYED, 0)
                + by_status.get(S.NOT_ANSWERED, 0)
            ),
            'in_fulfillment': (
                by_status.get(S.CONFIRMED, 0) + by_status.get(S.PACKAGING, 0)
            ),
        }
