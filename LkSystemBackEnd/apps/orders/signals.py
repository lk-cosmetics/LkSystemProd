"""Order domain signals for automatic audit logging."""

from __future__ import annotations

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .logging_service import OrderLoggingService
from .models import Order, OrderLine, OrderLog
from .realtime import broadcast_order_event


@receiver(pre_save, sender=Order)
def order_pre_save(sender, instance: Order, **kwargs):
    if not instance.pk:
        instance._previous_state = None
        return
    instance._previous_state = sender.all_objects.filter(pk=instance.pk).values(
        'status',
        'wc_status',
        'delivery_status',
        'contact_status',
        'outcome',
        'delay_date',
        'return_exchange_status',
        'subtotal',
        'tax_total',
        'discount_type',
        'discount_value',
        'discount_total',
        'total',
    ).first()


@receiver(post_save, sender=Order)
def order_post_save(sender, instance: Order, created: bool, **kwargs):
    user = getattr(instance, '_actor', None)
    previous = getattr(instance, '_previous_state', None)

    if created:
        OrderLoggingService.log(
            order=instance,
            action=OrderLog.Action.CREATED,
            user=user,
            details={
                'total': str(instance.total),
                'discount_total': str(instance.discount_total),
            },
        )
        if instance.client_id:
            instance.client.recalculate_metrics()
        return

    if not previous:
        return

    changed = {}
    tracked_fields = [
        'status',
        'wc_status',
        'delivery_status',
        'contact_status',
        'outcome',
        'delay_date',
        'return_exchange_status',
        'subtotal',
        'tax_total',
        'discount_type',
        'discount_value',
        'discount_total',
        'total',
    ]
    for field in tracked_fields:
        old_value = previous.get(field)
        new_value = getattr(instance, field)
        if str(old_value) != str(new_value):
            changed[field] = {'old': old_value, 'new': new_value}

    if changed:
        OrderLoggingService.log(
            order=instance,
            action=OrderLog.Action.UPDATED,
            user=user,
            details={'changes': changed},
        )

    action_by_field = {
        'status': OrderLog.Action.LOCAL_STATUS_CHANGED,
        'wc_status': OrderLog.Action.WOOCOMMERCE_STATUS_CHANGED,
        'delivery_status': OrderLog.Action.STATUS_CHANGED,
        'contact_status': OrderLog.Action.CONTACT_STATUS_CHANGED,
        'delay_date': OrderLog.Action.DELAY_DATE_CHANGED,
        'return_exchange_status': OrderLog.Action.RETURN_EXCHANGE_CHANGED,
    }
    for field, action in action_by_field.items():
        if field in changed:
            OrderLoggingService.log(
                order=instance,
                action=action,
                user=user,
                details={
                    'field': field,
                    'old': changed[field]['old'],
                    'new': changed[field]['new'],
                },
            )

    if (
        ('discount_type' in changed or 'discount_value' in changed or 'discount_total' in changed)
        and instance.discount_type != Order.DiscountType.NONE
    ):
        OrderLoggingService.log(
            order=instance,
            action=OrderLog.Action.DISCOUNT_APPLIED,
            user=user,
            details={
                'discount_type': instance.discount_type,
                'discount_value': str(instance.discount_value),
                'discount_total': str(instance.discount_total),
            },
        )

    if instance.client_id and (
        'total' in changed
        or 'status' in changed
        or 'delivery_status' in changed
        or 'return_exchange_status' in changed
    ):
        instance.client.recalculate_metrics()


@receiver(post_save, sender=Order)
def order_realtime_broadcast(sender, instance: Order, created: bool, **kwargs):
    """Push a lightweight real-time signal so connected order-queue clients
    refetch immediately. Kept separate from audit logging and fully best-effort:
    ``broadcast_order_event`` never raises and defers the send to
    ``transaction.on_commit``, so this can never interfere with the save."""
    event = 'created' if created else (
        'deleted' if getattr(instance, 'is_deleted', False) else 'updated'
    )
    broadcast_order_event(instance, event=event)


@receiver(pre_save, sender=OrderLine)
def order_line_pre_save(sender, instance: OrderLine, **kwargs):
    if not instance.pk:
        instance._previous_line_state = None
        return
    instance._previous_line_state = sender.all_objects.filter(pk=instance.pk).values(
        'quantity',
        'unit_price',
        'subtotal',
        'tax',
        'total',
        'is_deleted',
    ).first()


@receiver(post_save, sender=OrderLine)
def order_line_post_save(sender, instance: OrderLine, created: bool, **kwargs):
    if instance.is_deleted:
        return

    previous = getattr(instance, '_previous_line_state', None)
    if created:
        OrderLoggingService.log(
            order=instance.order,
            action=OrderLog.Action.UPDATED,
            user=getattr(instance.order, '_actor', None),
            details={
                'line_action': 'added',
                'line_id': instance.id,
                'product_name': instance.product_name,
                'quantity': instance.quantity,
                'unit_price': str(instance.unit_price),
            },
        )
        if instance.order.client_id:
            instance.order.client.recalculate_metrics()
        return

    if not previous:
        return

    changed = {}
    tracked_fields = ['quantity', 'unit_price', 'subtotal', 'tax', 'total']
    for field in tracked_fields:
        old_value = previous.get(field)
        new_value = getattr(instance, field)
        if str(old_value) != str(new_value):
            changed[field] = {'old': old_value, 'new': new_value}

    if changed:
        OrderLoggingService.log(
            order=instance.order,
            action=OrderLog.Action.UPDATED,
            user=getattr(instance.order, '_actor', None),
            details={
                'line_action': 'updated',
                'line_id': instance.id,
                'changes': changed,
            },
        )
        if instance.order.client_id:
            instance.order.client.recalculate_metrics()
