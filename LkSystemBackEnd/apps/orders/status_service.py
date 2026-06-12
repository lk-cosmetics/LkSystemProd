"""THE single write path for the canonical order lifecycle.

``Order.status`` is the only lifecycle field::

    new ──► confirmed ──► packaging ──► done ──► returned
     │  ▲▲                   │
     │  │└── not_answered ◄──┤ (side flows, see the matrix)
     │  └─── delayed ◄───────┘
     └──► canceled (reachable from every non-terminal state)

Every change goes through :meth:`OrderStatusService.transition`, which
validates the move against ``ALLOWED_TRANSITIONS`` (one table, one place),
writes ``status`` + ``status_changed_at`` + ``status_changed_by`` inside a
transaction, and audit-logs ``{from, to, note}``. Admin overrides and system
events may pass ``force=True`` — the jump is still audited (``forced=True``).

payment_status, sync_status, delivery references, soft-delete and the other
technical fields stay orthogonal by design and never drive this field.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.orders.logging_service import OrderLoggingService
from apps.orders.models import Order, OrderLog


class TransitionError(Exception):
    """Raised when a status move is not allowed by the lifecycle matrix."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class OrderStatusService:
    """Validates and applies canonical ``Order.status`` transitions."""

    S = Order.Status

    #: The one transition matrix. ``returned`` and ``canceled`` are terminal.
    ALLOWED_TRANSITIONS: dict[str, set[str]] = {
        S.NEW:          {S.CONFIRMED, S.NOT_ANSWERED, S.DELAYED, S.CANCELED},
        S.NOT_ANSWERED: {S.CONFIRMED, S.DELAYED, S.CANCELED},
        S.DELAYED:      {S.CONFIRMED, S.NOT_ANSWERED, S.CANCELED},
        S.CONFIRMED:    {S.PACKAGING, S.DELAYED, S.CANCELED},
        S.PACKAGING:    {S.DONE, S.CANCELED},
        S.DONE:         {S.RETURNED},
        S.RETURNED:     set(),
        S.CANCELED:     set(),
    }

    # ── Validation ────────────────────────────────────────────────────────────

    @classmethod
    def assert_allowed(cls, old: str, new: str) -> None:
        if old == new:
            return
        if new in cls.ALLOWED_TRANSITIONS.get(old, set()):
            return
        allowed = sorted(cls.ALLOWED_TRANSITIONS.get(old, set()))
        raise TransitionError(
            f'Invalid order status transition: {old} → {new}. '
            f'Allowed from {old}: {allowed or "(none — terminal status)"}.'
        )

    # ── The write path ────────────────────────────────────────────────────────

    @classmethod
    def transition(
        cls,
        order: Order,
        target: str,
        *,
        actor=None,
        note: str = '',
        force: bool = False,
    ) -> bool:
        """Move ``order.status`` to ``target``.

        Returns True when the status actually changed (False on a no-op).
        Raises :class:`TransitionError` when the move is off-matrix and not
        forced. Runs in its own transaction (joins the caller's when nested).
        """
        old = order.status
        if old == target:
            return False
        if not force:
            cls.assert_allowed(old, target)

        with transaction.atomic():
            order.status = target
            order.status_changed_at = timezone.now()
            order.status_changed_by = actor
            update_fields = [
                'status', 'status_changed_at', 'status_changed_by', 'updated_at',
            ]

            # Mark the WooCommerce push intent (DB only — the network call is
            # deferred / gated in WooCommerceSyncService, so the lifecycle
            # stays network-free and unit-testable).
            if cls._wc_mappable(order, target):
                if order.sync_status in (Order.SyncStatus.IMPORTED, Order.SyncStatus.SYNCED):
                    order.sync_status = Order.SyncStatus.PENDING_SYNC
                    update_fields.append('sync_status')

            order.save(update_fields=update_fields)

            OrderLoggingService.log(
                order=order,
                action=OrderLog.Action.ORDER_STATUS_CHANGED,
                user=actor,
                details={
                    'from': old,
                    'to': target,
                    **({'note': note} if note else {}),
                    **({'forced': True} if force else {}),
                },
            )

        cls._after_transition(order, old, target, actor=actor)
        return True

    # ── Side effects that follow the canonical status ─────────────────────────

    @classmethod
    def _wc_mappable(cls, order: Order, target: str) -> bool:
        if order.source != Order.Source.WOOCOMMERCE or not order.external_order_id:
            return False
        from apps.orders.models import SystemSetting, default_wc_status_map
        mapping = (
            SystemSetting.objects
            .filter(company_id=order.company_id)
            .values_list('wc_status_map', flat=True)
            .first()
        ) or default_wc_status_map()
        return bool(mapping.get(target))

    @classmethod
    def _after_transition(cls, order: Order, old: str, new: str, *, actor=None) -> None:
        """Loyalty + derived aux fields. Best-effort: never blocks a transition."""
        from apps.orders.lifecycle_service import OrderLifecycleService

        try:
            if new == cls.S.DONE:
                OrderLifecycleService.grant_loyalty_points(order, actor=actor)
            elif new in (cls.S.RETURNED, cls.S.CANCELED):
                OrderLifecycleService.reverse_loyalty_points(order, actor=actor)
        except Exception:  # pragma: no cover — points must never block a move
            pass

        try:
            OrderLifecycleService.refresh_aux_fields(order, actor=actor)
        except Exception:  # pragma: no cover — derived fields must never block
            pass
