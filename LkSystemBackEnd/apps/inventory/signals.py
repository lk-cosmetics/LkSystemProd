"""
LkSystem Inventory App - Signals
Handle SalesChannelInventory and InventoryMovement side effects.

Note: stock_quantity, inventory_status, manage_stock were removed from the
Product model.  Inventory totals are now derived from SalesChannelInventory
at query time.
"""

from django.db import transaction
from django.db.models.signals import pre_save, post_save, post_delete
from django.dispatch import receiver
from django.utils import timezone
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.inventory.models import SalesChannelInventory, InventoryMovement
from .consumers import InventoryConsumer


@receiver(pre_save, sender=InventoryMovement)
def remember_previous_movement_status(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_status = None
        return
    instance._previous_status = (
        InventoryMovement.objects
        .filter(pk=instance.pk)
        .values_list('status', flat=True)
        .first()
    )


@receiver(post_save, sender=InventoryMovement)
def on_inventory_movement_completed(sender, instance, created, **kwargs):
    """
    Update SalesChannelInventory when an InventoryMovement is completed.
    """
    if instance.status != InventoryMovement.MovementStatus.COMPLETED:
        return
    if not created and getattr(instance, '_previous_status', None) == InventoryMovement.MovementStatus.COMPLETED:
        return

    with transaction.atomic():
        try:
            store_inv = (
                SalesChannelInventory.objects
                .select_for_update()
                .get(
                    sales_channel=instance.sales_channel,
                    product=instance.product,
                )
            )
        except SalesChannelInventory.DoesNotExist:
            store_inv = SalesChannelInventory.objects.create(
                sales_channel=instance.sales_channel,
                product=instance.product,
                quantity=0,
            )

        # Apply this movement's RECORDED delta exactly once. The
        # status-transition guard above (``_previous_status``) ensures this body
        # runs a single time per movement-completion, and ``store_inv`` is locked
        # (select_for_update) for this transaction, so the read-modify-write is
        # atomic.
        #
        # We apply ``quantity_after - quantity_before`` — the delta the movement
        # itself recorded — instead of the previous
        # ``if store_inv.quantity != instance.quantity_after`` guard. That guard
        # compared live stock to a caller-supplied ABSOLUTE ``quantity_after``
        # (often from an unlocked, stale read), so when it coincidentally equalled
        # live stock it SILENTLY DROPPED a real decrement/restock (oversell), and
        # on a sign mismatch it diverged the ledger from on-hand. Applying the
        # recorded delta is sign-correct, robust to a stale absolute read (the
        # delta is what matters, applied to the locked live value), and naturally
        # a no-op for log-only movements that record quantity_after ==
        # quantity_before (e.g. a DAMAGE write-off that must NOT restock).
        delta = instance.quantity_after - instance.quantity_before
        if delta:
            store_inv.quantity += delta
            store_inv.save(update_fields=['quantity', 'updated_at'])

        if not instance.completed_at:
            InventoryMovement.objects.filter(pk=instance.pk).update(
                completed_at=timezone.now(),
            )

        # Handle transfer: create receiving movement
        if instance.movement_type == InventoryMovement.MovementType.TRANSFER_OUT:
            if instance.destination_channel and not instance.related_movement:
                try:
                    dest_inv = (
                        SalesChannelInventory.objects
                        .select_for_update()
                        .get(
                            sales_channel=instance.destination_channel,
                            product=instance.product,
                        )
                    )
                except SalesChannelInventory.DoesNotExist:
                    dest_inv = SalesChannelInventory.objects.create(
                        sales_channel=instance.destination_channel,
                        product=instance.product,
                        quantity=0,
                    )

                transfer_in = InventoryMovement.objects.create(
                    sales_channel=instance.destination_channel,
                    product=instance.product,
                    movement_type=InventoryMovement.MovementType.TRANSFER_IN,
                    status=InventoryMovement.MovementStatus.COMPLETED,
                    quantity=instance.quantity,
                    quantity_before=dest_inv.quantity,
                    quantity_after=dest_inv.quantity + instance.quantity,
                    unit_cost=instance.unit_cost,
                    notes=f"Transfer from {instance.sales_channel.name}",
                    created_by=instance.created_by,
                    completed_at=timezone.now(),
                )

                InventoryMovement.objects.filter(pk=instance.pk).update(
                    related_movement=transfer_in,
                )
                InventoryMovement.objects.filter(pk=transfer_in.pk).update(
                    related_movement=instance,
                )
                instance.related_movement = transfer_in
                transfer_in.related_movement = instance


def _broadcast_inventory_event(event_type: str, payload: dict) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        InventoryConsumer.GROUP_NAME,
        {
            'type': 'inventory_updated',
            'payload': {
                'event': event_type,
                **payload,
            },
        },
    )


def _inventory_payload(instance: SalesChannelInventory) -> dict:
    return {
        'inventory_id': instance.id,
        'sales_channel_id': instance.sales_channel_id,
        'product_id': instance.product_id,
        'quantity': instance.quantity,
        'reserved_quantity': instance.reserved_quantity,
        'available_quantity': instance.available_quantity,
        'minimum_quantity': instance.minimum_quantity,
        'maximum_quantity': instance.maximum_quantity,
        'updated_at': instance.updated_at.isoformat() if instance.updated_at else None,
    }


@receiver(post_save, sender=SalesChannelInventory)
def on_sales_channel_inventory_saved(sender, instance, created, **kwargs):
    payload = _inventory_payload(instance)
    event_type = 'created' if created else 'updated'
    transaction.on_commit(lambda: _broadcast_inventory_event(event_type, payload))


@receiver(post_delete, sender=SalesChannelInventory)
def on_sales_channel_inventory_deleted(sender, instance, **kwargs):
    payload = {
        'inventory_id': instance.id,
        'sales_channel_id': instance.sales_channel_id,
        'product_id': instance.product_id,
    }
    transaction.on_commit(lambda: _broadcast_inventory_event('deleted', payload))
