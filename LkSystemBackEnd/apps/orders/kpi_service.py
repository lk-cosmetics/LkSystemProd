"""KPI aggregations computed from the clean ``order_status`` (STATUS_MAP.md 7).

The dashboard must count only genuinely successful sales. Because ``returned``,
``exchanged`` and ``canceled`` outrank ``done`` in the section 5.1 precedence, an
order in any of those states can never also read as ``done`` — so counting
``order_status == done`` for successful-sales / revenue automatically excludes
returns, exchanges and cancellations. This is the behaviour decision 3 / 7 asks
for, and it replaces the legacy ``final_outcome`` / ``workflow_status`` dashboard
queries.

This is a pure read service. Phase D wires the API/dashboard to it; nothing here
mutates state.
"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Count, QuerySet, Sum

from apps.orders.models import Order


class OrderKPIService:
    """Compute order KPIs from the persisted-but-derived ``order_status``."""

    # Only these statuses count as realised sales / revenue.
    SUCCESS_STATUSES = (Order.OrderStatus.DONE,)
    # Surfaced explicitly so the dashboard can show the "lost" buckets.
    RETURNED = Order.OrderStatus.RETURNED
    EXCHANGED = Order.OrderStatus.EXCHANGED
    CANCELED = Order.OrderStatus.CANCELED

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
        """Return a KPI dict.

        Pass either an explicit ``queryset`` (already tenant-scoped by the caller)
        or a ``company`` plus optional ``brand`` / ``sales_channel`` / ``start`` /
        ``end`` filters.
        """
        if queryset is None:
            if company is None:
                raise ValueError('OrderKPIService.compute requires company or queryset.')
            queryset = cls.base_queryset(company=company, **filters)

        raw = {
            row['order_status']: row['n']
            for row in queryset.values('order_status').annotate(n=Count('id'))
        }
        by_status = {value: raw.get(value, 0) for value, _ in Order.OrderStatus.choices}

        success_qs = queryset.filter(order_status__in=cls.SUCCESS_STATUSES)
        revenue = success_qs.aggregate(total=Sum('total'))['total'] or Decimal('0.00')

        OS = Order.OrderStatus
        in_confirmation = (
            by_status.get(OS.NEW, 0)
            + by_status.get(OS.AWAITING_CONFIRMATION, 0)
            + by_status.get(OS.DELAYED, 0)
            + by_status.get(OS.NOT_ANSWERED, 0)
        )
        in_fulfillment = by_status.get(OS.CONFIRMED, 0) + by_status.get(OS.PREPARING, 0)

        return {
            'total_orders': sum(by_status.values()),
            'by_status': by_status,
            'successful_sales': by_status.get(OS.DONE, 0),
            'revenue': revenue,
            'returned': by_status.get(cls.RETURNED, 0),
            'exchanged': by_status.get(cls.EXCHANGED, 0),
            'canceled': by_status.get(cls.CANCELED, 0),
            'in_confirmation': in_confirmation,
            'in_fulfillment': in_fulfillment,
        }
