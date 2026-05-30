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
        order._actor = actor

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

            line.product = product_obj if product_obj is not None else line.product
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

        if 'customer_note' in data:
            order.customer_note = data['customer_note']
        if 'internal_note' in data:
            order.internal_note = data['internal_note']

        # Update billing fields if provided
        billing_fields = [
            'billing_first_name', 'billing_last_name', 'billing_company',
            'billing_email', 'billing_phone', 'billing_address_1', 'billing_address_2',
            'billing_city', 'billing_state', 'billing_postcode', 'billing_country',
        ]
        for field in billing_fields:
            if field in data:
                setattr(order, field, data[field])

        # Model-level clean/recalculate covers business invariants.
        order.recalculate_totals()
        update_fields = [
            'discount_type',
            'discount_value',
            'discount_total',
            'subtotal',
            'tax_total',
            'total',
            'customer_note',
            'internal_note',
            'updated_at',
        ]
        # Add billing fields to update if they were in the request
        for field in billing_fields:
            if field in data:
                update_fields.append(field)
        
        order.save(update_fields=update_fields)
        return order

    @staticmethod
    def soft_delete_order(*, order: Order, actor=None, reason: str = '') -> None:
        order._actor = actor
        order.soft_delete(user=actor, reason=reason)

    @staticmethod
    def restore_order(*, order: Order, actor=None) -> Order:
        order._actor = actor
        order.restore(user=actor)
        return order
