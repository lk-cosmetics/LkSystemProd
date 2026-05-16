"""Production/BOM inventory operations.

The service keeps manufacturing stock movements auditable:
components leave warehouse stock as SENT_TO_FACTORY, remain visible as
in-factory quantities on the production batch, then finished goods enter stock
as PRODUCTION_IN when production is received.
"""

from decimal import Decimal, ROUND_CEILING

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.inventory.models import (
    BillOfMaterials,
    InventoryMovement,
    ProductionBatch,
    ProductionBatchComponent,
    SalesChannelInventory,
)
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class ProductionService:
    """Coordinates BOM consumption and finished-product receipt."""

    @staticmethod
    def _ceil_quantity(value: Decimal) -> int:
        return int(value.quantize(Decimal('1'), rounding=ROUND_CEILING))

    @classmethod
    def _required_component_quantity(cls, quantity_per_unit, waste_percent, planned_quantity: int) -> int:
        base = Decimal(quantity_per_unit) * Decimal(planned_quantity)
        if waste_percent:
            base = base * (Decimal('1') + (Decimal(waste_percent) / Decimal('100')))
        return cls._ceil_quantity(base)

    @classmethod
    @transaction.atomic
    def send_to_factory(
        cls,
        *,
        sales_channel: SalesChannel,
        finished_product: Product,
        planned_quantity: int,
        created_by,
        notes: str = '',
    ) -> ProductionBatch:
        if planned_quantity <= 0:
            raise ValidationError({'planned_quantity': 'Planned quantity must be greater than zero.'})

        if finished_product.brand_id and sales_channel.brand_id != finished_product.brand_id:
            raise ValidationError({
                'finished_product': 'Finished product must belong to the same brand as the sales channel.'
            })

        try:
            bom = (
                BillOfMaterials.objects
                .select_related('finished_product')
                .prefetch_related('items__component')
                .get(finished_product=finished_product, is_active=True)
            )
        except BillOfMaterials.DoesNotExist:
            raise ValidationError({'finished_product': 'This product has no active bill of materials.'})

        bom_items = list(bom.items.select_related('component'))
        if not bom_items:
            raise ValidationError({'bom': 'The active BOM has no components.'})

        required = []
        for item in bom_items:
            required_qty = cls._required_component_quantity(
                item.quantity_per_unit,
                item.waste_percent,
                planned_quantity,
            )
            if required_qty <= 0:
                raise ValidationError({'bom': f'Invalid required quantity for {item.component.name}.'})
            required.append((item.component, required_qty))

        component_ids = [component.id for component, _ in required]
        inventory_by_product = {
            inv.product_id: inv
            for inv in (
                SalesChannelInventory.objects
                .select_for_update()
                .filter(sales_channel=sales_channel, product_id__in=component_ids)
            )
        }

        shortages = []
        for component, required_qty in required:
            inventory = inventory_by_product.get(component.id)
            available = inventory.available_quantity if inventory else 0
            if available < required_qty:
                shortages.append({
                    'component_id': component.id,
                    'component_name': component.name,
                    'required': required_qty,
                    'available': available,
                })

        if shortages:
            raise ValidationError({'components': shortages})

        batch = ProductionBatch.objects.create(
            sales_channel=sales_channel,
            finished_product=finished_product,
            bom=bom,
            status=ProductionBatch.Status.SENT_TO_FACTORY,
            planned_quantity=planned_quantity,
            sent_at=timezone.now(),
            notes=notes,
            created_by=created_by,
        )

        for component, required_qty in required:
            inventory = inventory_by_product[component.id]
            movement = InventoryMovement.objects.create(
                sales_channel=sales_channel,
                product=component,
                movement_type=InventoryMovement.MovementType.SENT_TO_FACTORY,
                status=InventoryMovement.MovementStatus.COMPLETED,
                quantity=required_qty,
                quantity_before=inventory.quantity,
                quantity_after=inventory.quantity - required_qty,
                external_reference=batch.batch_number,
                notes=f"Sent to Factory for {planned_quantity} x {finished_product.name}. {notes}".strip(),
                created_by=created_by,
                completed_at=timezone.now(),
            )
            ProductionBatchComponent.objects.create(
                production_batch=batch,
                component=component,
                quantity_sent=required_qty,
                sent_movement=movement,
            )

        return batch

    @classmethod
    @transaction.atomic
    def receive_from_factory(
        cls,
        *,
        batch: ProductionBatch,
        received_quantity: int,
        created_by,
        reason: str = '',
        notes: str = '',
    ) -> ProductionBatch:
        batch = (
            ProductionBatch.objects
            .select_for_update()
            .select_related('sales_channel', 'finished_product')
            .get(pk=batch.pk)
        )

        if batch.status not in (
            ProductionBatch.Status.SENT_TO_FACTORY,
            ProductionBatch.Status.PARTIALLY_RECEIVED,
        ):
            raise ValidationError({'batch': 'Only sent or partially received batches can be received.'})

        if received_quantity <= 0:
            raise ValidationError({'received_quantity': 'Received quantity must be greater than zero.'})

        remaining = batch.planned_quantity - batch.received_quantity
        if received_quantity > remaining:
            raise ValidationError({
                'received_quantity': f'Received quantity cannot exceed remaining production quantity ({remaining}).'
            })

        finished_inventory, _ = (
            SalesChannelInventory.objects
            .select_for_update()
            .get_or_create(
                sales_channel=batch.sales_channel,
                product=batch.finished_product,
                defaults={'quantity': 0},
            )
        )

        new_received_total = batch.received_quantity + received_quantity
        quantity_before = finished_inventory.quantity
        InventoryMovement.objects.create(
            sales_channel=batch.sales_channel,
            product=batch.finished_product,
            movement_type=InventoryMovement.MovementType.PRODUCTION_IN,
            status=InventoryMovement.MovementStatus.COMPLETED,
            quantity=received_quantity,
            quantity_before=quantity_before,
            quantity_after=quantity_before + received_quantity,
            external_reference=batch.batch_number,
            notes=f"{reason or 'Production order returned from factory'}. {notes}".strip(),
            created_by=created_by,
            completed_at=timezone.now(),
        )

        for component_line in (
            ProductionBatchComponent.objects
            .select_for_update()
            .filter(production_batch=batch)
        ):
            target_consumed = cls._ceil_quantity(
                Decimal(component_line.quantity_sent)
                * Decimal(new_received_total)
                / Decimal(batch.planned_quantity)
            )
            component_line.quantity_consumed = min(component_line.quantity_sent, target_consumed)
            component_line.save(update_fields=['quantity_consumed'])

        batch.received_quantity = new_received_total
        batch.status = (
            ProductionBatch.Status.COMPLETED
            if batch.received_quantity == batch.planned_quantity
            else ProductionBatch.Status.PARTIALLY_RECEIVED
        )
        if batch.status == ProductionBatch.Status.COMPLETED:
            batch.completed_at = timezone.now()
        batch.save(update_fields=['received_quantity', 'status', 'completed_at', 'updated_at'])

        return batch

    @classmethod
    @transaction.atomic
    def cancel_order(
        cls,
        *,
        batch: ProductionBatch,
        created_by,
        notes: str = '',
    ) -> ProductionBatch:
        batch = (
            ProductionBatch.objects
            .select_for_update()
            .select_related('sales_channel')
            .get(pk=batch.pk)
        )

        if batch.status == ProductionBatch.Status.CANCELLED:
            return batch
        if batch.received_quantity > 0:
            raise ValidationError({
                'batch': 'Production orders with received finished products cannot be deleted. Keep the audit history.'
            })
        if batch.status not in (
            ProductionBatch.Status.SENT_TO_FACTORY,
            ProductionBatch.Status.PARTIALLY_RECEIVED,
        ):
            raise ValidationError({'batch': 'Only active production orders can be cancelled.'})

        for component_line in (
            ProductionBatchComponent.objects
            .select_for_update()
            .select_related('component')
            .filter(production_batch=batch)
        ):
            return_qty = component_line.in_factory_quantity
            if return_qty <= 0:
                continue

            inventory, _ = (
                SalesChannelInventory.objects
                .select_for_update()
                .get_or_create(
                    sales_channel=batch.sales_channel,
                    product=component_line.component,
                    defaults={'quantity': 0},
                )
            )
            InventoryMovement.objects.create(
                sales_channel=batch.sales_channel,
                product=component_line.component,
                movement_type=InventoryMovement.MovementType.RETURN_IN,
                status=InventoryMovement.MovementStatus.COMPLETED,
                quantity=return_qty,
                quantity_before=inventory.quantity,
                quantity_after=inventory.quantity + return_qty,
                external_reference=batch.batch_number,
                notes=f"Returned components from cancelled production order. {notes}".strip(),
                created_by=created_by,
                completed_at=timezone.now(),
            )
            component_line.quantity_consumed = component_line.quantity_sent
            component_line.save(update_fields=['quantity_consumed'])

        batch.status = ProductionBatch.Status.CANCELLED
        batch.completed_at = timezone.now()
        if notes:
            batch.notes = f"{batch.notes}\nCancelled: {notes}".strip()
        batch.save(update_fields=['status', 'completed_at', 'notes', 'updated_at'])
        return batch
