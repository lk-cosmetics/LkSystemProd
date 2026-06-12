"""
LkSystem Notifications App - Event integration

This module is the single seam between business events and notifications. It
registers signal receivers on the orders / inventory / settings models and
forwards to ``NotificationService``. Keeping it here means:

* no existing app imports the notification layer,
* every receiver is defensive — a bug here can never break an order save,
* the order audit log (``OrderLog``) is reused as the lifecycle event bus, so
  we do not have to touch ``lifecycle_service`` at all.
"""

import logging

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from apps.notifications.services import NotificationService

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Orders — new imports
# ──────────────────────────────────────────────────────────────────────────────

def _register_order_signals():
    from apps.orders.models import Order, OrderLog, SystemSetting

    @receiver(post_save, sender=Order, dispatch_uid='notif_order_created')
    def on_order_created(sender, instance, created, **kwargs):
        """A freshly imported WooCommerce order needs confirmation."""
        if not created:
            return
        try:
            if getattr(instance, 'source', None) != Order.Source.WOOCOMMERCE:
                return
            NotificationService.order_imported(instance)
        except Exception:  # pragma: no cover - never break order ingestion
            logger.exception('order_imported notification failed for order %s', instance.pk)

    @receiver(post_save, sender=OrderLog, dispatch_uid='notif_order_log')
    def on_order_log(sender, instance, created, **kwargs):
        """Map meaningful audit-log actions onto targeted notifications."""
        if not created:
            return
        try:
            _dispatch_order_log(instance, Order, OrderLog, SystemSetting)
        except Exception:  # pragma: no cover - never break the audit log write
            logger.exception('order-log notification failed for log %s', instance.pk)

    @receiver(post_save, sender=SystemSetting, dispatch_uid='notif_settings_changed')
    def on_settings_changed(sender, instance, created, **kwargs):
        """System settings changed → notify company admins only."""
        if created:
            # Lazy default-row creation is not a user action.
            return
        try:
            NotificationService.settings_changed(instance)
        except Exception:  # pragma: no cover
            logger.exception('settings_changed notification failed for %s', instance.pk)


def _dispatch_order_log(log, Order, OrderLog, SystemSetting):
    action = log.action
    order = log.order
    actor = log.user
    A = OrderLog.Action

    if action == A.OUTCOME_CONFIRMED:
        NotificationService.order_confirmed(order, actor=actor)
    elif action == A.OUTCOME_DELAYED:
        NotificationService.order_delayed(order, actor=actor)
    elif action in (A.OUTCOME_CANCELLED, A.AUTO_CANCELLED):
        NotificationService.order_cancelled(order, actor=actor)
    elif action in (A.POS_VALIDATED, A.DELIVERY_DELIVERED):
        NotificationService.order_done(order, actor=actor)
    elif action == A.RETURN_PROCESSED:
        is_exchange = (
            str(getattr(order, 'return_type', '')) == str(Order.ReturnType.EXCHANGED)
        )
        NotificationService.order_return_created(order, actor=actor, is_exchange=is_exchange)
    elif action == A.MANUAL_STATUS_OVERRIDE:
        NotificationService.order_manual_override(order, actor=actor)
    elif action == A.SYNC_FAILED:
        NotificationService.wc_sync_failed(order, actor=actor)
    elif action == A.WC_CANCEL_SYNCED:
        NotificationService.wc_sync_recovered(order, actor=actor)
    elif action == A.CONTACT_STATUS_CHANGED:
        # Emitted by mark_not_answered with the attempt counter in details.
        details = log.details or {}
        attempts = details.get('attempts')
        threshold = _no_answer_threshold(order, SystemSetting)
        if attempts and threshold and attempts >= threshold:
            NotificationService.order_not_answered(order, actor=actor, attempts=attempts)


def _no_answer_threshold(order, SystemSetting):
    """Read the company's no-answer cap without creating a settings row."""
    value = (
        SystemSetting.objects
        .filter(company_id=order.company_id)
        .values_list('no_answer_max_attempts', flat=True)
        .first()
    )
    return value or 3


# ──────────────────────────────────────────────────────────────────────────────
# Inventory — low / out of stock (fire only on transition INTO a bad state)
# ──────────────────────────────────────────────────────────────────────────────

def _register_inventory_signals():
    from apps.inventory.models import SalesChannelInventory

    @receiver(pre_save, sender=SalesChannelInventory, dispatch_uid='notif_inv_prev')
    def remember_previous_levels(sender, instance, **kwargs):
        if not instance.pk:
            instance._notif_prev = None
            return
        instance._notif_prev = (
            SalesChannelInventory.objects
            .filter(pk=instance.pk)
            .values('quantity', 'reserved_quantity', 'minimum_quantity')
            .first()
        )

    @receiver(post_save, sender=SalesChannelInventory, dispatch_uid='notif_inv_stock')
    def on_inventory_saved(sender, instance, created, **kwargs):
        try:
            prev = getattr(instance, '_notif_prev', None)
            now_low = instance.is_low_stock
            now_out = instance.is_out_of_stock
            if not (now_low or now_out):
                return

            if prev is None:
                prev_low = prev_out = False
            else:
                prev_available = max(0, prev['quantity'] - prev['reserved_quantity'])
                prev_low = prev['quantity'] <= prev['minimum_quantity']
                prev_out = prev_available <= 0

            if now_out and not prev_out:
                NotificationService.low_stock(instance, out_of_stock=True)
            elif now_low and not now_out and not prev_low:
                NotificationService.low_stock(instance, out_of_stock=False)
        except Exception:  # pragma: no cover - never break inventory updates
            logger.exception('low_stock notification failed for inventory %s', instance.pk)


# ──────────────────────────────────────────────────────────────────────────────
# Register everything at import time (apps.py ready() imports this module).
# Imports are deferred into functions so app loading order cannot break us.
# ──────────────────────────────────────────────────────────────────────────────

_register_order_signals()
_register_inventory_signals()
