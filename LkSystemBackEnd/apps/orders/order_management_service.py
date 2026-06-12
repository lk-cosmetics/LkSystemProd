"""Order mutation service layer (edit, soft-delete, restore)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db import transaction

from apps.products.models import Product

from .models import Order, OrderLine


class OrderManagementService:
    """Encapsulates order mutation business rules outside views/models."""

    @staticmethod
    @transaction.atomic
    def edit_order(*, order: Order, data: dict[str, Any], actor=None) -> Order:
        # Mutation callers may hold a stale instance after a lifecycle service
        # locked and updated the same row. Read the reservation flag from the DB.
        order.refresh_from_db(fields=['stock_reserved'])
        order._actor = actor
        reservation_was_active = order.stock_reserved
        if reservation_was_active:
            # Release using the original line quantities. If editing or the new
            # reservation fails, this transaction restores the previous state.
            from .stock_service import OrderStockReservationService
            OrderStockReservationService.release(order, actor=actor)

        existing_lines = {
            l.id: l
            for l in order.lines
            .filter(is_deleted=False)
            .exclude(product__product_type=Product.ProductType.PACKAGING_ITEM)
        }
        kept_line_ids = set()

        for line_data in data['lines']:
            product_obj = None
            product_id = line_data.get('product')
            if product_id is not None:
                product_obj = Product.objects.filter(
                    pk=product_id,
                    brand=order.sales_channel.brand,
                ).first()

            line_id = line_data.get('id')
            if line_id and line_id in existing_lines:
                line = existing_lines[line_id]
            else:
                line = OrderLine(order=order)

            quantity = line_data['quantity']
            unit_price = line_data['unit_price']
            subtotal = Decimal(quantity) * unit_price
            tax = line.tax if line.pk else Decimal('0.00')
            total = subtotal + tax

            if 'product' in line_data:
                line.product = product_obj
            line.product_name = line_data.get('product_name') or (
                product_obj.name if product_obj else line.product_name
            )
            line.barcode = line_data.get('barcode', line.barcode or '')
            line.quantity = quantity
            line.unit_price = unit_price
            line.subtotal = subtotal
            line.tax = tax
            line.total = total
            line.is_deleted = False
            line.save()
            kept_line_ids.add(line.id)

        OrderLine.all_objects.filter(
            order=order,
            is_deleted=False,
        ).exclude(
            product__product_type=Product.ProductType.PACKAGING_ITEM,
        ).exclude(id__in=kept_line_ids).update(is_deleted=True)

        if 'discount_type' in data:
            order.discount_type = data['discount_type']
        if 'discount_value' in data:
            order.discount_value = data['discount_value']
        if order.discount_type == Order.DiscountType.NONE:
            order.discount_value = Decimal('0.00')

        # Editable delivery fee — recalculate_totals() folds it into the total.
        if 'delivery_fee' in data:
            order.delivery_fee = data['delivery_fee'] or Decimal('0.00')

        if 'customer_note' in data:
            order.customer_note = data['customer_note']
        if 'internal_note' in data:
            order.internal_note = data['internal_note']

        # Update billing (client) + shipping (delivery) address fields if provided.
        billing_fields = [
            'billing_first_name', 'billing_last_name', 'billing_company',
            'billing_email', 'billing_phone', 'billing_address_1', 'billing_address_2',
            'billing_city', 'billing_state', 'billing_postcode', 'billing_country',
        ]
        shipping_fields = [
            'shipping_first_name', 'shipping_last_name', 'shipping_phone',
            'shipping_address_1', 'shipping_city', 'shipping_state',
            'shipping_postcode', 'shipping_country',
        ]
        address_fields = billing_fields + shipping_fields
        for field in address_fields:
            if field in data:
                setattr(order, field, data[field])

        # Model-level clean/recalculate covers business invariants.
        order.recalculate_totals()
        update_fields = [
            'discount_type',
            'discount_value',
            'discount_total',
            'delivery_fee',
            'subtotal',
            'tax_total',
            'total',
            'customer_note',
            'internal_note',
            'updated_at',
        ]
        # Add billing/shipping fields to update if they were in the request
        for field in address_fields:
            if field in data:
                update_fields.append(field)
        
        order.save(update_fields=update_fields)

        # Quantities and totals directly affect stock availability and business
        # priority, so these derived fields cannot remain stale after editing.
        from .lifecycle_service import OrderLifecycleService
        OrderLifecycleService.refresh_derived_fields(order, actor=actor)

        if reservation_was_active:
            # The order was already confirmed (held a reservation), so editing it
            # must not fail on stock — re-reserve best-effort (backorder) for the
            # new quantities, mirroring a force-confirmed order.
            from .stock_service import OrderStockReservationService
            OrderStockReservationService.reserve(order, actor=actor, force=True)

        order.refresh_from_db()
        return order

    @staticmethod
    def soft_delete_order(*, order: Order, actor=None, reason: str = '') -> None:
        order._actor = actor
        order.soft_delete(user=actor, reason=reason)
        OrderManagementService._sync_bi_for_order(order)
        # A soft-deleted order no longer counts toward loyalty points; recompute
        # so a deleted COMPLETED order's points drop off the client immediately.
        OrderManagementService._recalc_client_points(order)

    @staticmethod
    def restore_order(*, order: Order, actor=None) -> Order:
        order._actor = actor
        order.restore(user=actor)
        OrderManagementService._sync_bi_for_order(order)
        # Restoring brings the order back into scope; recompute so a restored
        # COMPLETED order's points return to the client.
        OrderManagementService._recalc_client_points(order)
        return order

    @staticmethod
    def _recalc_client_points(order: Order) -> None:
        """Refresh the order's client metrics (points + counters). Best-effort:
        loyalty bookkeeping must never block or break an order mutation."""
        client_id = getattr(order, 'client_id', None)
        if not client_id:
            return
        try:
            from apps.clients.models import Client
            client = Client.objects.filter(pk=client_id).first()
            if client is not None:
                client.recalculate_metrics()
        except Exception:  # pragma: no cover — defensive
            import logging
            logging.getLogger(__name__).warning(
                'client points recalc after order mutation failed for order %s',
                getattr(order, 'pk', None), exc_info=True,
            )

    @staticmethod
    def _sync_bi_for_order(order: Order) -> None:
        """Immediately refresh BI rollups + bust the dashboard cache for this
        order's (company, brand, day) bucket, so a delete/restore shows on the
        dashboard right away instead of waiting on the async post-save signal.

        Best-effort: BI must never block or break an order mutation.
        """
        try:
            from apps.bi import cache as bi_cache
            from apps.bi.services.aggregation import recompute_for_order
            recompute_for_order(order)
            bi_cache.invalidate_for(
                getattr(order, 'company_id', None),
                getattr(order, 'brand_id', None),
            )
        except Exception:  # pragma: no cover — defensive; never break the mutation
            import logging
            logging.getLogger(__name__).warning(
                'BI sync after order mutation failed for order %s',
                getattr(order, 'pk', None), exc_info=True,
            )
