"""Stock availability helpers for order detail screens."""

from __future__ import annotations

from typing import Any

from apps.inventory.models import SalesChannelInventory
from apps.orders.models import Order
from apps.products.models import Product


class OrderStockAvailabilityService:
    """Read-only stock check for website orders and optional POS routing."""

    @staticmethod
    def _channel_payload(channel) -> dict[str, Any] | None:
        if not channel:
            return None
        return {
            'id': channel.id,
            'name': channel.name,
            'code': channel.code,
            'channel_type': channel.channel_type,
        }

    @classmethod
    def build(cls, order: Order) -> dict[str, Any]:
        lines = list(
            order.lines.filter(is_deleted=False)
            .exclude(product__product_type=Product.ProductType.PACKAGING_ITEM)
            .select_related('product')
        )
        grouped: dict[int, dict[str, Any]] = {}
        unlinked: list[dict[str, Any]] = []

        for line in lines:
            if not line.product_id:
                unlinked.append({
                    'line_id': line.id,
                    'product_name': line.product_name,
                    'required_quantity': line.quantity,
                    'issue': 'Product is not linked to a local product.',
                })
                continue

            item = grouped.setdefault(line.product_id, {
                'product_id': line.product_id,
                'product_name': line.product.name if line.product else line.product_name,
                'barcode': line.product.barcode if line.product else line.barcode,
                'required_quantity': 0,
                'line_ids': [],
            })
            item['required_quantity'] += line.quantity
            item['line_ids'].append(line.id)

        channels = [order.sales_channel_id]
        if order.pos_sales_channel_id and order.pos_sales_channel_id not in channels:
            channels.append(order.pos_sales_channel_id)

        inventories = {
            (inv.sales_channel_id, inv.product_id): inv
            for inv in SalesChannelInventory.objects.filter(
                sales_channel_id__in=[cid for cid in channels if cid],
                product_id__in=grouped.keys(),
            )
        }

        items = []
        website_ok = True
        pos_ok = True if order.pos_sales_channel_id else None

        for product_id, item in grouped.items():
            required = item['required_quantity']
            website_inv = inventories.get((order.sales_channel_id, product_id))
            pos_inv = (
                inventories.get((order.pos_sales_channel_id, product_id))
                if order.pos_sales_channel_id else None
            )

            website_available = website_inv.available_quantity if website_inv else 0
            pos_available = pos_inv.available_quantity if pos_inv else None
            issues: list[str] = []

            if not website_inv:
                website_ok = False
                issues.append('No website inventory row exists for this product.')
            elif website_available < required:
                website_ok = False
                issues.append(
                    f'Website stock is insufficient: required {required}, available {website_available}.'
                )

            if order.pos_sales_channel_id:
                if not pos_inv:
                    pos_ok = False
                    issues.append('No selected POS inventory row exists for this product.')
                elif (pos_available or 0) < required:
                    pos_ok = False
                    issues.append(
                        f'Selected POS stock is insufficient: required {required}, available {pos_available}.'
                    )

            items.append({
                **item,
                'website_quantity': website_inv.quantity if website_inv else 0,
                'website_reserved_quantity': website_inv.reserved_quantity if website_inv else 0,
                'website_available_quantity': website_available,
                'pos_quantity': pos_inv.quantity if pos_inv else None,
                'pos_reserved_quantity': pos_inv.reserved_quantity if pos_inv else None,
                'pos_available_quantity': pos_available,
                'has_warning': bool(issues),
                'issues': issues,
            })

        if unlinked:
            website_ok = False
            if pos_ok is not None:
                pos_ok = False

        return {
            'website_channel': cls._channel_payload(order.sales_channel),
            'pos_channel': cls._channel_payload(order.pos_sales_channel),
            'can_fulfill_from_website': website_ok and not unlinked,
            'can_fulfill_from_pos': pos_ok if pos_ok is not None else None,
            'has_warnings': bool(unlinked) or any(item['has_warning'] for item in items),
            'items': items,
            'unlinked_lines': unlinked,
        }

    @classmethod
    def status_snapshot(cls, order: Order) -> dict[str, Any]:
        """Derive ``stock_status`` + ``mapping_required`` (STATUS_MAP.md 5.5).

        Evaluated against the *fulfilling* channel — ``pos_sales_channel`` when the
        order is routed to POS, otherwise ``sales_channel``. Only customer lines
        count (packaging-type lines are excluded).

          * any product with ``available_quantity <= 0`` -> ``out_of_stock``
          * else any product with ``available < required`` -> ``partial_stock``
          * else                                          -> ``in_stock``

        ``mapping_required`` is True when any customer line is unlinked
        (``is_linked == False`` or no ``product``); such an order cannot be
        stock-checked and is forced to ``low`` priority by ``OrderPriorityService``.
        """
        SS = Order.StockStatus
        channel_id = order.pos_sales_channel_id or order.sales_channel_id

        lines = list(
            order.lines.filter(is_deleted=False)
            .exclude(product__product_type=Product.ProductType.PACKAGING_ITEM)
        )
        mapping_required = any(
            (not line.is_linked) or (not line.product_id) for line in lines
        )

        required: dict[int, int] = {}
        for line in lines:
            if line.product_id:
                required[line.product_id] = required.get(line.product_id, 0) + line.quantity

        if not required:
            return {'stock_status': SS.IN_STOCK, 'mapping_required': mapping_required}

        available = {
            inv.product_id: inv.available_quantity
            for inv in SalesChannelInventory.objects.filter(
                sales_channel_id=channel_id,
                product_id__in=required.keys(),
            )
        }

        any_zero = False
        any_partial = False
        for product_id, needed in required.items():
            have = available.get(product_id, 0)
            if have <= 0:
                any_zero = True
            elif have < needed:
                any_partial = True

        if any_zero:
            stock_status = SS.OUT_OF_STOCK
        elif any_partial:
            stock_status = SS.PARTIAL_STOCK
        else:
            stock_status = SS.IN_STOCK

        return {'stock_status': stock_status, 'mapping_required': mapping_required}
