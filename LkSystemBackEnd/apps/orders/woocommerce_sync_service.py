"""Push local ``status`` changes TO WooCommerce (STATUS_MAP.md 5.8/5.9/5.11).

Design rules baked in here:

* **Local is the source of truth.** A failed push NEVER rolls back the local
  status. It records ``sync_status = sync_failed`` + ``sync_error_message`` and a
  history log, and leaves a retry available. ``update_order_status`` therefore
  swallows WooCommerce/network exceptions instead of propagating them.
* **Network is opt-in.** The actual HTTP ``PUT`` is gated behind
  ``settings.WC_ORDER_PUSH_ENABLED`` (default ``False``). When disabled the order
  is parked in ``pending_sync`` for a later push and no network call is made — so
  unit tests and not-yet-configured environments never hit WooCommerce.
* **Mapping is configurable.** local ``status`` -> WooCommerce status comes
  from ``SystemSetting.wc_status_map`` (falling back to ``default_wc_status_map``).
  ``new`` / ``delayed`` / ``not_answered`` have no mapping and are never pushed.

Only ``source == WOOCOMMERCE`` orders that carry an ``external_order_id`` push.
POS / manual orders stay ``imported``.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.orders.logging_service import OrderLoggingService
from apps.orders.models import Order, OrderLog, SystemSetting, default_wc_status_map


class WooCommerceSyncService:
    """Owns the ``status`` -> WooCommerce status push and its retry."""

    # ── Configuration helpers ────────────────────────────────────────────────

    @staticmethod
    def _push_enabled(channel) -> bool:
        """Whether the outbound status push is enabled for this order's channel.

        The control lives in the DB on the channel (``wc_push_status_enabled``),
        right next to the WooCommerce credentials — so each store is toggled
        independently and nothing has to be configured via env.
        ``settings.WC_ORDER_PUSH_ENABLED`` is an OPTIONAL global override: set it
        to force pushes on/off everywhere (an ops kill-switch / CI safety); when
        it is left unset (the default) the per-channel flag decides.
        """
        override = getattr(settings, 'WC_ORDER_PUSH_ENABLED', None)
        if override is not None:
            return bool(override)
        return bool(channel and getattr(channel, 'wc_push_status_enabled', False))

    @staticmethod
    def _status_map(order: Order) -> dict:
        mapping = (
            SystemSetting.objects
            .filter(company_id=order.company_id)
            .values_list('wc_status_map', flat=True)
            .first()
        )
        return mapping or default_wc_status_map()

    @classmethod
    def wc_status_for(cls, order: Order, status: str | None = None) -> str | None:
        """WooCommerce status string for this order's canonical status, or None."""
        return cls._status_map(order).get(status or order.status)

    @classmethod
    def _build_client(cls, channel):
        # Imported lazily so the module never needs the dependency at import time
        # (and so tests can patch this classmethod without the package present).
        from woocommerce import API as WooCommerceAPI

        return WooCommerceAPI(
            url=channel.wc_store_url,
            consumer_key=channel.wc_consumer_key,
            consumer_secret=channel.wc_consumer_secret,
            version='wc/v3',
            timeout=getattr(settings, 'WC_ORDER_PUSH_TIMEOUT', 30),
        )

    # ── Push ──────────────────────────────────────────────────────────────────

    @classmethod
    def update_order_status(cls, order: Order, *, actor=None, force: bool = False) -> Order:
        """Map ``order.status`` to a WooCommerce status and push it.

        Returns the (mutated) order. Never raises on a WooCommerce failure — the
        local status stands and the failure is recorded for a retry.

        ``force=True`` performs the network call even when push is globally
        disabled (used by the retry action and by callers that explicitly opt in).
        """
        if order.source != Order.Source.WOOCOMMERCE or not order.external_order_id:
            return order

        target = cls.wc_status_for(order)
        if not target:
            # new / delayed / not_answered: nothing to push by default.
            return order

        # Record intent to push: imported / synced -> pending_sync (5.8 / 6.2).
        if order.sync_status in (Order.SyncStatus.IMPORTED, Order.SyncStatus.SYNCED):
            order.sync_status = Order.SyncStatus.PENDING_SYNC
            order.save(update_fields=['sync_status', 'updated_at'])

        if not cls._push_enabled(order.sales_channel) and not force:
            # Parked for a later push; this channel hasn't enabled the push.
            return order

        channel = order.sales_channel
        order.sync_status = Order.SyncStatus.SYNCING
        order.save(update_fields=['sync_status', 'updated_at'])

        try:
            client = cls._build_client(channel)
            response = client.put(f'orders/{order.external_order_id}', {'status': target})
            status_code = getattr(response, 'status_code', None)
            if status_code is not None and status_code >= 400:
                body = getattr(response, 'text', '') or ''
                raise RuntimeError(f'WooCommerce returned HTTP {status_code}: {body[:300]}')
        except Exception as exc:  # noqa: BLE001 - local stays the source of truth
            cls._record_failure(order, target, exc, actor=actor)
            return order

        cls._record_success(order, target, actor=actor)
        return order

    @classmethod
    def retry(cls, order: Order, *, actor=None) -> Order:
        """Retry a previously failed (or parked) push.

        Logs the retry, then runs ``update_order_status`` with ``force=True`` so
        the network call happens regardless of the global gate.
        """
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.WC_SYNC_RETRIED,
            user=actor,
            details={'from_sync_status': order.sync_status, 'status': order.status},
        )
        if order.sync_status not in (Order.SyncStatus.IMPORTED, Order.SyncStatus.SYNCED):
            # Reset so update_order_status doesn't short-circuit on the intent step.
            order.sync_status = Order.SyncStatus.PENDING_SYNC
            order.save(update_fields=['sync_status', 'updated_at'])
        return cls.update_order_status(order, actor=actor, force=True)

    # ── Result recording ───────────────────────────────────────────────────────

    @classmethod
    @transaction.atomic
    def _record_success(cls, order: Order, target: str, *, actor=None) -> None:
        order.sync_status = Order.SyncStatus.SYNCED
        order.wc_status = target
        order.last_sync_at = timezone.now()
        order.sync_error_message = ''
        order.save(update_fields=[
            'sync_status', 'wc_status', 'last_sync_at', 'sync_error_message', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=(
                OrderLog.Action.WC_CANCEL_SYNCED
                if target == 'cancelled'
                else OrderLog.Action.WOOCOMMERCE_STATUS_CHANGED
            ),
            user=actor,
            details={
                'direction': 'local_to_wc',
                'pushed_status': target,
                'status': order.status,
            },
        )

    @classmethod
    @transaction.atomic
    def _record_failure(cls, order: Order, target: str, exc: Exception, *, actor=None) -> None:
        order.sync_status = Order.SyncStatus.SYNC_FAILED
        order.sync_error_message = str(exc)[:2000]
        order.save(update_fields=['sync_status', 'sync_error_message', 'updated_at'])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.SYNC_FAILED,
            user=actor,
            details={
                'direction': 'local_to_wc',
                'attempted_status': target,
                'status': order.status,
                'error': str(exc)[:500],
            },
        )
