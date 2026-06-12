"""Auto-cancel orders that have sat in NOT_ANSWERED for too long.

The default threshold is 3 days, overridable via the Django setting
`ORDER_AUTO_CANCEL_DAYS` or the `--days N` flag on the management command.

Selection criteria:
  status = 'not_answered'
  not_answered_at <= now - days
  no delivery_reference
  not already cancelled

Each candidate is cancelled inside its own atomic transaction so a single
failure doesn't roll back the whole batch. The actor is passed as None so
OrderLog renders the entry as "System".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.orders.lifecycle_service import LifecycleError, OrderLifecycleService
from apps.orders.logging_service import OrderLoggingService
from apps.orders.models import Order, OrderLog


@dataclass
class AutoCancelResult:
    days: int
    candidates: int = 0
    cancelled: int = 0
    failures: list[dict] = field(default_factory=list)
    dry_run: bool = False


class AutoCancelService:
    """One-shot job that auto-cancels stale not-answered orders."""

    @staticmethod
    def _resolve_days(days: int | None) -> int:
        if days is not None:
            return max(1, int(days))
        return int(getattr(settings, 'ORDER_AUTO_CANCEL_DAYS', 3))

    @classmethod
    def run(cls, *, days: int | None = None, dry_run: bool = False) -> AutoCancelResult:
        days = cls._resolve_days(days)
        cutoff = timezone.now() - timedelta(days=days)
        result = AutoCancelResult(days=days, dry_run=dry_run)

        qs = (
            Order.all_objects
            .filter(
                status=Order.Status.NOT_ANSWERED,
                not_answered_at__isnull=False,
                not_answered_at__lte=cutoff,
                delivery_reference='',
                is_deleted=False,
            )
            .exclude(status__in=[Order.Status.CANCELED, Order.Status.RETURNED, Order.Status.DONE])
        )

        result.candidates = qs.count()

        for order in qs.iterator():
            if dry_run:
                continue
            try:
                with transaction.atomic():
                    reason_code = f'auto_cancel_not_answered_{days}d'
                    OrderLifecycleService.cancel(
                        order,
                        actor=None,
                        reason=reason_code,
                        note='System auto-cancel after not_answered timeout.',
                    )
                    # Stamp the audit metadata + dedicated AUTO_CANCELLED log.
                    order.auto_cancelled_at = timezone.now()
                    order.auto_cancel_reason = reason_code
                    order.save(update_fields=['auto_cancelled_at', 'auto_cancel_reason', 'updated_at'])
                    OrderLoggingService.log(
                        order=order,
                        action=OrderLog.Action.AUTO_CANCELLED,
                        user=None,
                        details={'days': days, 'reason': reason_code,
                                 'not_answered_at': order.not_answered_at.isoformat() if order.not_answered_at else None},
                    )
                result.cancelled += 1
            except (LifecycleError, Exception) as exc:
                result.failures.append({
                    'order_id': order.id,
                    'order_number': order.order_number,
                    'error': getattr(exc, 'message', str(exc)),
                })

        return result
