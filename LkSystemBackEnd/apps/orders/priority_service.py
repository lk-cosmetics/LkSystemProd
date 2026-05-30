"""Derived order priority (STATUS_MAP.md section 5.6).

Pure, read-mostly helper. Reads the per-company thresholds from ``SystemSetting``
(falling back to the documented defaults when no row exists yet) and maps an
order's ``total`` plus its stock signals onto ``high`` / ``medium`` / ``low``.

It never writes — the lifecycle service persists the result on the order through
``_recompute_order_status``. Keeping the computation here means the rule lives in
exactly one place and is unit-testable in isolation.
"""

from __future__ import annotations

from decimal import Decimal

from apps.orders.models import Order, SystemSetting


class OrderPriorityService:
    """Compute ``priority_level`` from total + stock_status + mapping_required."""

    DEFAULT_HIGH_MIN = Decimal('299.00')
    DEFAULT_MEDIUM_MIN = Decimal('100.00')

    @classmethod
    def _thresholds(cls, order: Order) -> tuple[Decimal, Decimal]:
        """(high_min, medium_min) for the order's company, or the defaults."""
        row = (
            SystemSetting.objects
            .filter(company_id=order.company_id)
            .values('priority_high_min_amount', 'priority_medium_min_amount')
            .first()
        )
        if not row:
            return cls.DEFAULT_HIGH_MIN, cls.DEFAULT_MEDIUM_MIN
        return (
            row['priority_high_min_amount'] or cls.DEFAULT_HIGH_MIN,
            row['priority_medium_min_amount'] or cls.DEFAULT_MEDIUM_MIN,
        )

    @classmethod
    def compute(
        cls,
        order: Order,
        *,
        stock_status: str | None = None,
        mapping_required: bool = False,
    ) -> str:
        """Return the ``Order.PriorityLevel`` value for this order.

        Rules (STATUS_MAP.md 5.6), applied top-down, first match wins:
          * ``total >= high_min`` and ``stock_status == in_stock`` -> ``high``
          * ``(medium_min <= total < high_min)`` or ``partial_stock`` -> ``medium``
          * ``total < medium_min`` or ``out_of_stock`` -> ``low``

        Section 5.5 additionally forces ``mapping_required`` orders to ``low``
        because they cannot be reliably stock-checked; that override wins.
        """
        PL = Order.PriorityLevel
        SS = Order.StockStatus
        stock_status = stock_status or order.stock_status

        if mapping_required:
            return PL.LOW

        high_min, medium_min = cls._thresholds(order)
        total = order.total or Decimal('0')

        if total >= high_min and stock_status == SS.IN_STOCK:
            return PL.HIGH
        if (medium_min <= total < high_min) or stock_status == SS.PARTIAL_STOCK:
            return PL.MEDIUM
        return PL.LOW
