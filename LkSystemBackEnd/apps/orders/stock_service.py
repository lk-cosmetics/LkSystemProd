"""Stock availability helpers for order detail screens."""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.models import Order
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


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
        # Pack-aware requirements: a pack expands into its component products
        # (a pack has no stock row of its own) via the same engine the sale uses.
        # ``grouped`` keeps its historical shape so the per-channel logic below is
        # unchanged.
        required_map, meta, unlinked_raw = cls._required_customer_quantities(order)
        unlinked: list[dict[str, Any]] = [
            {
                'line_id': item['line_id'],
                'product_name': item['product_name'],
                'required_quantity': item['required_quantity'],
                'issue': (
                    'Pack components are missing or invalid; cannot stock-check.'
                    if item.get('reason') == 'pack_invalid'
                    else 'Product is not linked to a local product.'
                ),
            }
            for item in unlinked_raw
        ]
        grouped: dict[int, dict[str, Any]] = {
            product_id: {
                'product_id': product_id,
                'product_name': meta.get(product_id, {}).get('product_name', ''),
                'barcode': meta.get(product_id, {}).get('barcode', ''),
                'required_quantity': needed,
                'line_ids': [],
            }
            for product_id, needed in required_map.items()
        }

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

        # Pack-aware: ``required`` is keyed by the *component* products a pack
        # actually consumes (a pack has no stock row of its own), via the same
        # expansion the sale uses. ``unlinked`` drives ``mapping_required``.
        required, _meta, unlinked = cls._required_customer_quantities(order)
        mapping_required = bool(unlinked)

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

    # ──────────────────────────────────────────────────────────────────────
    # Stock-gating helpers (delivery / POS) + per-channel breakdown
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def _required_customer_quantities(
        cls, order: Order,
    ) -> tuple[dict[int, int], dict[int, dict[str, Any]], list[dict[str, Any]]]:
        """Aggregate the stock requirements of *stock-bearing* customer lines,
        with PACKS expanded into the component products they consume.

        Returns ``(required, meta, unlinked)`` where:

          * ``required``  -> ``{product_id: total_quantity}`` for the products that
            actually move stock. A pack has no inventory row of its own, so each
            pack line is expanded into its component products (via the same engine
            the sale uses) and a non-pack line maps to itself; quantities for a
            product shared across several lines / packs are summed.
          * ``meta``      -> ``{product_id: {product_name, barcode}}`` for display.
          * ``unlinked``  -> customer lines that cannot be stock-checked: unlinked
            WooCommerce lines (``is_linked == False`` or no local product) and
            misconfigured packs (``reason == 'pack_invalid'`` — a missing or
            deleted component). Reported as warnings; by design they never
            silently trigger stock movements (WooCommerce-import compatibility).
        """
        lines = list(
            order.lines.filter(is_deleted=False)
            .exclude(product__product_type=Product.ProductType.PACKAGING_ITEM)
            .select_related('product')
        )
        # Lazy import: ``service`` imports this module, so import at call time.
        from apps.orders.service import OrderIngestionError, OrderIngestionService

        required: dict[int, int] = {}
        meta: dict[int, dict[str, Any]] = {}
        unlinked: list[dict[str, Any]] = []
        for line in lines:
            if (not line.is_linked) or (not line.product_id):
                unlinked.append({
                    'line_id': line.id,
                    'product_name': line.product_name,
                    'required_quantity': line.quantity,
                    'reason': line.unlinked_reason or 'not_linked',
                })
                continue

            # A PACK carries no stock of its own — its availability is its
            # component stock. Expand each line with the SAME engine the sale
            # uses (``_line_quantities_by_product``) so this availability /
            # reservation check matches exactly what gets decremented at
            # fulfilment; a non-pack line maps to itself. Expanding one line at a
            # time keeps a single misconfigured pack (missing/deleted component)
            # from crashing this read-path: it degrades to an unfulfillable
            # warning instead, and the order simply cannot be stock-checked until
            # the pack is fixed.
            try:
                expanded = OrderIngestionService._line_quantities_by_product([line])
            except OrderIngestionError:
                unlinked.append({
                    'line_id': line.id,
                    'product_name': line.product_name,
                    'required_quantity': line.quantity,
                    'reason': 'pack_invalid',
                })
                continue

            for product_id, data in expanded.items():
                required[product_id] = required.get(product_id, 0) + data['quantity']
                if product_id not in meta:
                    meta[product_id] = {
                        'product_name': data['product'].name,
                        'barcode': (data['product'].barcode or ''),
                    }

        return required, meta, unlinked

    @classmethod
    def shortfalls_for_channel(
        cls, order: Order, sales_channel_id: int | None,
    ) -> list[dict[str, Any]]:
        """Linked products whose available stock is below the required quantity
        in ``sales_channel_id``.

        Used to *gate* delivery / POS submission. Unlinked lines are intentionally
        ignored (they never deduct stock). Returns an empty list when there is
        nothing to check or everything is sufficient.
        """
        required, meta, _unlinked = cls._required_customer_quantities(order)
        if not required or not sales_channel_id:
            return []

        available = {
            inv.product_id: inv.available_quantity
            for inv in SalesChannelInventory.objects.filter(
                sales_channel_id=sales_channel_id,
                product_id__in=required.keys(),
            )
        }

        shortfalls: list[dict[str, Any]] = []
        for product_id, needed in required.items():
            have = available.get(product_id, 0)
            if have < needed:
                info = meta.get(product_id, {})
                shortfalls.append({
                    'product_id': product_id,
                    'product_name': info.get('product_name', ''),
                    'required': needed,
                    'available': have,
                    'missing': needed - have,
                })

        shortfalls.sort(key=lambda s: (-s['missing'], (s['product_name'] or '').lower()))
        return shortfalls

    @classmethod
    def channel_breakdown(cls, order: Order) -> dict[str, Any]:
        """Per-sales-channel stock view for the order-detail screen.

        Every channel in the order's brand becomes a tab, each listing the
        required products and the channel's quantity / reserved / available /
        sufficiency. The order's own channel is surfaced first, the routed POS
        channel second, then the remaining channels alphabetically.
        """
        required, meta, unlinked = cls._required_customer_quantities(order)

        brand_id = order.brand_id or (
            order.sales_channel.brand_id if order.sales_channel_id else None
        )

        if brand_id:
            channels = list(SalesChannel.objects.filter(brand_id=brand_id))
        else:
            ids = [cid for cid in (order.sales_channel_id, order.pos_sales_channel_id) if cid]
            channels = list(SalesChannel.objects.filter(id__in=ids))

        # Defensive: the order channel + routed POS channel must always appear,
        # even if they somehow fall outside the brand filter.
        present_ids = {c.id for c in channels}
        for extra_id in (order.sales_channel_id, order.pos_sales_channel_id):
            if extra_id and extra_id not in present_ids:
                extra = SalesChannel.objects.filter(id=extra_id).first()
                if extra:
                    channels.append(extra)
                    present_ids.add(extra_id)

        channel_ids = [c.id for c in channels]
        inventories: dict[tuple[int, int], SalesChannelInventory] = {}
        if channel_ids and required:
            inventories = {
                (inv.sales_channel_id, inv.product_id): inv
                for inv in SalesChannelInventory.objects.filter(
                    sales_channel_id__in=channel_ids,
                    product_id__in=required.keys(),
                )
            }

        def sort_key(channel: SalesChannel) -> tuple[int, str]:
            if channel.id == order.sales_channel_id:
                return (0, '')
            if order.pos_sales_channel_id and channel.id == order.pos_sales_channel_id:
                return (1, '')
            return (2, (channel.name or '').lower())

        channels.sort(key=sort_key)

        channel_payloads: list[dict[str, Any]] = []
        for channel in channels:
            items: list[dict[str, Any]] = []
            can_fulfill = True
            for product_id, needed in required.items():
                inv = inventories.get((channel.id, product_id))
                quantity = inv.quantity if inv else 0
                reserved = inv.reserved_quantity if inv else 0
                available = inv.available_quantity if inv else 0
                is_sufficient = available >= needed
                if not is_sufficient:
                    can_fulfill = False
                info = meta.get(product_id, {})
                items.append({
                    'product_id': product_id,
                    'product_name': info.get('product_name', ''),
                    'barcode': info.get('barcode', ''),
                    'required_quantity': needed,
                    'quantity': quantity,
                    'reserved_quantity': reserved,
                    'available_quantity': available,
                    'is_sufficient': is_sufficient,
                    'shortfall': max(0, needed - available),
                    'has_inventory_row': inv is not None,
                })

            # Shortfalls float to the top so problems are visible first.
            items.sort(key=lambda it: (it['is_sufficient'], (it['product_name'] or '').lower()))

            channel_payloads.append({
                'sales_channel': {
                    'id': channel.id,
                    'name': channel.name,
                    'code': channel.code,
                    'channel_type': channel.channel_type,
                    'store_type': channel.store_type,
                    'is_active': channel.is_active,
                },
                'is_order_channel': channel.id == order.sales_channel_id,
                'is_pos_channel': bool(order.pos_sales_channel_id)
                    and channel.id == order.pos_sales_channel_id,
                'can_fulfill': can_fulfill,
                'has_unverifiable_lines': bool(unlinked),
                'items': items,
            })

        return {
            'order_channel_id': order.sales_channel_id,
            'pos_channel_id': order.pos_sales_channel_id,
            'tracked_product_count': len(required),
            'channels': channel_payloads,
            'unlinked_lines': unlinked,
        }

    # Open orders that still have to consume stock (a completed/canceled order
    # drops out automatically — its demand becomes a SALE in the ledger).
    OPEN_DEMAND_STATUSES = ('confirmed', 'packaging')

    @classmethod
    def open_order_demand(cls, *, orders=None, channel_id=None):
        """Consolidated component-stock demand across all OPEN orders.

        Sums the pack-aware required quantities (``_required_customer_quantities``
        — packs are expanded to their components) over every order whose clean
        ``status`` is still open (confirmed / packaging), then compares the
        total against available stock. ``orders`` may be a pre-scoped queryset
        (e.g. the viewset's tenant-scoped one); ``channel_id`` narrows both the
        orders and the availability to one channel.

        Returns rows sorted worst-shortfall-first, each with: required (summed
        across open orders), available, shortfall, and how many open orders need
        the product. A ``done`` order is intentionally absent — its demand has
        moved to the movement ledger (the "history").
        """
        from apps.orders.models import Order

        if orders is None:
            orders = Order.objects.all()
        orders = orders.filter(status__in=cls.OPEN_DEMAND_STATUSES)
        if channel_id:
            orders = orders.filter(sales_channel_id=channel_id)

        demand: dict[int, dict[str, Any]] = {}
        for order in orders:
            required, meta, _unlinked = cls._required_customer_quantities(order)
            for product_id, qty in required.items():
                row = demand.setdefault(product_id, {
                    'product_id': product_id,
                    'product_name': meta.get(product_id, {}).get('product_name', ''),
                    'barcode': meta.get(product_id, {}).get('barcode', ''),
                    'required': 0,
                    'order_count': 0,
                })
                row['required'] += qty
                row['order_count'] += 1

        product_ids = list(demand.keys())
        available: dict[int, int] = {}
        if product_ids:
            inv_qs = SalesChannelInventory.objects.filter(product_id__in=product_ids)
            if channel_id:
                inv_qs = inv_qs.filter(sales_channel_id=channel_id)
            for inv in inv_qs:
                available[inv.product_id] = (
                    available.get(inv.product_id, 0) + inv.available_quantity
                )

        rows = []
        for product_id, row in demand.items():
            row['available'] = available.get(product_id, 0)
            row['shortfall'] = max(0, row['required'] - row['available'])
            rows.append(row)
        rows.sort(
            key=lambda r: (-r['shortfall'], -r['required'], (r['product_name'] or '').lower())
        )
        return rows


class OrderStockReservationService:
    """Reserve / release finished-product stock for confirmed online orders.

    Reserving increments ``SalesChannelInventory.reserved_quantity`` so a unit's
    ``available_quantity`` (= quantity − reserved) drops immediately. Every sale
    path — POS checkout, the order ingestion engine and production — gates on
    ``available_quantity``, so a reserved unit can no longer be sold by the POS
    or committed to another order.

    Lifecycle: reserved at confirm (online / manual-delivery orders), held until
    the order completes — where the SALE movement supersedes it — or is
    cancelled (released). POS orders sell-and-complete instantly and never
    reserve.
    """

    # Sources confirmed first and fulfilled later (the reservation window). POS
    # is excluded: it sells and completes at the till, decrementing immediately.
    _RESERVING_SOURCES = {Order.Source.WOOCOMMERCE, Order.Source.MANUAL}

    @classmethod
    def should_reserve(cls, order: Order) -> bool:
        return order.source in cls._RESERVING_SOURCES and bool(order.sales_channel_id)

    @classmethod
    def reserve(cls, order: Order, *, actor=None, force: bool = False) -> None:
        """Reserve stock for the order's stock-bearing lines on its sales channel.

        Idempotent — a no-op when the order already holds a reservation or is not
        a reserving order. By default raises ``LifecycleError`` (blocking the
        confirm) when any line's available stock is insufficient, so a confirmed
        order always owns its stock.

        ``force=True`` turns the shortfall into a **best-effort backorder**: the
        order is still reserved (available may go negative), no exception is
        raised, and the oversell is recorded on the movement note. Used when the
        operator has explicitly acknowledged the missing-stock warning. The order
        row is locked and its reservation state is read from the DB, so a stale
        in-memory ``order`` can never double-reserve.
        """
        if not cls.should_reserve(order):
            return

        with transaction.atomic():
            locked = Order.all_objects.select_for_update().get(pk=order.pk)
            if locked.stock_reserved:
                order.stock_reserved = True
                return

            required, meta, _unlinked = (
                OrderStockAvailabilityService._required_customer_quantities(locked)
            )
            channel_id = locked.sales_channel_id
            if required and channel_id:
                inventories = {
                    inv.product_id: inv
                    for inv in SalesChannelInventory.objects
                    .select_for_update()
                    .filter(sales_channel_id=channel_id, product_id__in=required.keys())
                }
                shortfalls = []
                for product_id, needed in required.items():
                    inv = inventories.get(product_id)
                    available = inv.available_quantity if inv else 0
                    if available < needed:
                        info = meta.get(product_id, {})
                        shortfalls.append(
                            (info.get('product_name') or f'product #{product_id}', needed, available)
                        )
                # Without force, a shortfall blocks the confirm. With force, we
                # continue and reserve anyway (backorder) — the operator already
                # acknowledged the warning popup.
                if shortfalls and not force:
                    from apps.orders.lifecycle_service import LifecycleError
                    detail = '; '.join(
                        f'{name} (need {req}, available {av})'
                        for name, req, av in shortfalls[:6]
                    )
                    raise LifecycleError(
                        f'Cannot confirm — stock is no longer available to reserve: {detail}.'
                    )
                for product_id, needed in required.items():
                    inv = inventories.get(product_id)
                    if inv is None:
                        # No inventory row on this channel (untracked product) —
                        # nothing to reserve. Only reachable under force.
                        continue
                    reserved_before = inv.reserved_quantity
                    available_before = inv.available_quantity
                    inv.reserved_quantity += needed
                    inv.save(update_fields=['reserved_quantity', 'updated_at'])
                    oversold = max(0, needed - max(0, available_before))
                    # Ledger entry so the reservation is visible in the movements
                    # list. On-hand is unchanged (before == after) — only
                    # reserved_quantity moved (shown in the note).
                    InventoryMovement.objects.create(
                        sales_channel_id=channel_id,
                        product_id=product_id,
                        movement_type=InventoryMovement.MovementType.RESERVATION,
                        status=InventoryMovement.MovementStatus.COMPLETED,
                        quantity=needed,
                        quantity_before=inv.quantity,
                        quantity_after=inv.quantity,
                        external_reference=locked.order_number,
                        notes=(
                            f'Reserved for order {locked.order_number} '
                            f'(reserved {reserved_before}→{inv.reserved_quantity})'
                            + (f' — BACKORDER, oversold {oversold}' if oversold else '')
                        ),
                        created_by=actor,
                        completed_at=timezone.now(),
                    )

            locked.stock_reserved = True
            locked.save(update_fields=['stock_reserved', 'updated_at'])
            order.stock_reserved = True

    @classmethod
    def release(cls, order: Order, *, actor=None) -> None:
        """Release a held reservation back to available stock.

        Idempotent and safe to call unconditionally — it reads the authoritative
        ``stock_reserved`` flag under a row lock, so a stale in-memory ``order``
        (e.g. one passed from a separate request) can neither skip a real release
        nor double-release. Called when the order completes (the SALE movement
        takes over) or is cancelled.
        """
        with transaction.atomic():
            locked = Order.all_objects.select_for_update().get(pk=order.pk)
            if not locked.stock_reserved:
                order.stock_reserved = False
                return

            required, _meta, _unlinked = (
                OrderStockAvailabilityService._required_customer_quantities(locked)
            )
            channel_id = locked.sales_channel_id
            if required and channel_id:
                inventories = {
                    inv.product_id: inv
                    for inv in SalesChannelInventory.objects
                    .select_for_update()
                    .filter(sales_channel_id=channel_id, product_id__in=required.keys())
                }
                for product_id, needed in required.items():
                    inv = inventories.get(product_id)
                    if inv:
                        reserved_before = inv.reserved_quantity
                        inv.reserved_quantity = max(0, inv.reserved_quantity - needed)
                        inv.save(update_fields=['reserved_quantity', 'updated_at'])
                        # Ledger entry so the release is visible in the movements
                        # list. On-hand is unchanged (before == after).
                        InventoryMovement.objects.create(
                            sales_channel_id=channel_id,
                            product_id=product_id,
                            movement_type=InventoryMovement.MovementType.RELEASE,
                            status=InventoryMovement.MovementStatus.COMPLETED,
                            quantity=needed,
                            quantity_before=inv.quantity,
                            quantity_after=inv.quantity,
                            external_reference=locked.order_number,
                            notes=(
                                f'Reservation released for order {locked.order_number} '
                                f'(reserved {reserved_before}→{inv.reserved_quantity})'
                            ),
                            created_by=actor,
                            completed_at=timezone.now(),
                        )

            locked.stock_reserved = False
            locked.save(update_fields=['stock_reserved', 'updated_at'])
            order.stock_reserved = False
