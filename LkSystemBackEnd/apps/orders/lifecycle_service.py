"""Centralized order lifecycle transitions.

React calls viewset actions, but this service owns the business rules,
idempotency checks, audit trail, and stock restoration side effects.
"""

from __future__ import annotations

from django.db import models, transaction
from django.utils import timezone

from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.delivery_service import DeliverySubmissionService
from apps.orders.logging_service import OrderLoggingService
from apps.orders.models import Order, OrderLog
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class LifecycleError(Exception):
    """Raised when an order lifecycle action is invalid."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class OrderLifecycleService:
    """Single backend source of truth for order lifecycle actions."""

    FINAL_STATUSES = {
        Order.Status.RETURNED,
        Order.Status.CANCELED,
    }

    @staticmethod
    def _lock(order: Order) -> Order:
        return (
            Order.all_objects
            .select_for_update(of=('self',))
            .select_related('company', 'sales_channel__brand', 'pos_sales_channel__brand')
            .get(pk=order.pk)
        )

    @staticmethod
    def _ensure_active(order: Order) -> None:
        if order.is_deleted:
            raise LifecycleError('Order is soft-deleted and cannot be processed.')

    @staticmethod
    def _ensure_not_cancelled(order: Order) -> None:
        if order.status in (Order.Status.CANCELED, Order.Status.RETURNED):
            raise LifecycleError('Order is in a terminal status and cannot be processed.')

    @classmethod
    def _assert_stock_available(
        cls,
        order: Order,
        *,
        sales_channel_id: int | None,
        context: str,
        channel_label: str,
    ) -> None:
        """Hard-block a fulfilment transition when LINKED products lack stock in
        the target channel.

        ``context`` is ``'delivery'`` or ``'pos'`` (drives the message wording);
        ``channel_label`` is the human-readable channel name. Unlinked lines are
        never blocked — by design they don't move stock (WooCommerce-import
        compatibility), so they cannot create a shortfall here.

        Imported lazily to avoid any import-order coupling with stock_service.
        """
        from apps.orders.stock_service import OrderStockAvailabilityService

        shortfalls = OrderStockAvailabilityService.shortfalls_for_channel(
            order, sales_channel_id,
        )
        if not shortfalls:
            return

        shown = shortfalls[:6]
        detail = '; '.join(
            f"{s['product_name'] or ('product #' + str(s['product_id']))} "
            f"(need {s['required']}, available {s['available']})"
            for s in shown
        )
        remaining = len(shortfalls) - len(shown)
        if remaining > 0:
            detail += f"; and {remaining} more product(s)"

        if context == 'pos':
            message = f'Cannot send to POS — insufficient stock at {channel_label}: {detail}.'
        else:
            message = f'Cannot send to delivery — insufficient stock in {channel_label}: {detail}.'
        raise LifecycleError(message)


    # ── Clean top-layer status derivation (Phase C) ──────────────────────────
    # order_status / confirmation_status / delivery_method are pure functions of
    # the existing mechanism fields. stock_status / priority_level read inventory
    # + SystemSetting. The lifecycle service is the ONLY writer of these fields.

    _NO_ANSWER_DEFAULT = 3

    @classmethod
    def _no_answer_threshold(cls, order: Order) -> int:
        """Unanswered attempts before order_status becomes not_answered.

        Reads SystemSetting.no_answer_max_attempts for the company without
        creating a row (pure read), falling back to the documented default.
        """
        from apps.orders.models import SystemSetting
        value = (
            SystemSetting.objects
            .filter(company_id=order.company_id)
            .values_list('no_answer_max_attempts', flat=True)
            .first()
        )
        return int(value) if value else cls._NO_ANSWER_DEFAULT


    @classmethod
    def _derive_delivery_method(cls, order: Order) -> str:
        """STATUS_MAP.md 5.3."""
        DM = Order.DeliveryMethod
        if order.in_store_pickup or order.pos_sales_channel_id or order.source == Order.Source.POS:
            return DM.POS_PICKUP
        return DM.HOME_DELIVERY

    @classmethod
    def refresh_aux_fields(cls, order: Order, *, actor=None) -> str:
        """Refresh the informational derived fields ONLY (delivery_method /
        stock_status / priority_level). Best-effort: a transient inventory
        issue never blocks a transition. ``status`` is NOT touched here — it
        moves only through OrderStatusService.transition()."""
        new_dm = cls._derive_delivery_method(order)

        update_fields: list[str] = []
        if new_dm != order.delivery_method:
            order.delivery_method = new_dm
            update_fields.append('delivery_method')

        # stock_status + priority_level (best-effort; never block the transition).
        try:
            from apps.orders.priority_service import OrderPriorityService
            from apps.orders.stock_service import OrderStockAvailabilityService
            snapshot = OrderStockAvailabilityService.status_snapshot(order)
            if snapshot['stock_status'] != order.stock_status:
                order.stock_status = snapshot['stock_status']
                update_fields.append('stock_status')
            new_priority = OrderPriorityService.compute(
                order,
                stock_status=order.stock_status,
                mapping_required=snapshot['mapping_required'],
            )
            if new_priority != order.priority_level:
                order.priority_level = new_priority
                update_fields.append('priority_level')
        except Exception:  # noqa: BLE001 - derived fields must not break a transition
            pass

        if update_fields:
            update_fields.append('updated_at')
            order.save(update_fields=update_fields)
        return order.status

    @classmethod
    def refresh_derived_fields(cls, order: Order, *, actor=None) -> str:
        """Back-compat alias — refreshes the informational fields only."""
        return cls.refresh_aux_fields(order, actor=actor)


    # ── Loyalty points (Phase 2) ─────────────────────────────────────────────

    @classmethod
    def _compute_points(cls, order: Order) -> int:
        from django.conf import settings as _s
        from decimal import Decimal
        per_unit = Decimal(str(getattr(_s, 'LOYALTY_POINTS_PER_UNIT', 1)))
        if per_unit <= 0:
            return 0
        return int((order.total or Decimal('0')) * per_unit)

    @classmethod
    @transaction.atomic
    def grant_loyalty_points(cls, order: Order, *, actor=None) -> int:
        """Record that a completed order earned points, then refresh the client's
        derived total.

        Idempotent via ``loyalty_points_granted`` (a per-order audit flag). The
        client's ``points`` are recomputed from all *done* orders by
        ``Client.recalculate_metrics`` — they are NOT incremented here — so the
        total can never double-count or drift out of sync with the orders.
        """
        order = cls._lock(order)
        if order.loyalty_points_granted or not order.client_id:
            return order.loyalty_points_amount or 0
        points = cls._compute_points(order)
        order.loyalty_points_granted = True
        order.loyalty_points_amount = points
        order.loyalty_points_granted_at = timezone.now()
        order.save(update_fields=[
            'loyalty_points_granted', 'loyalty_points_amount',
            'loyalty_points_granted_at', 'updated_at',
        ])
        cls._sync_client_points(order.client_id)
        OrderLoggingService.log(
            order=order, action=OrderLog.Action.POINTS_GRANTED, user=actor,
            details={'client_id': order.client_id, 'points': points, 'total': str(order.total)},
        )
        return points

    @classmethod
    @transaction.atomic
    def reverse_loyalty_points(cls, order: Order, *, actor=None) -> int:
        """Mark a previously-completed order as no longer earning points, then
        refresh the client's derived total. Idempotent."""
        order = cls._lock(order)
        if not order.loyalty_points_granted or not order.client_id:
            return 0
        points = order.loyalty_points_amount or 0
        order.loyalty_points_granted = False
        order.save(update_fields=['loyalty_points_granted', 'updated_at'])
        cls._sync_client_points(order.client_id)
        OrderLoggingService.log(
            order=order, action=OrderLog.Action.POINTS_REVERSED, user=actor,
            details={'client_id': order.client_id, 'points': points},
        )
        return points

    @staticmethod
    def _sync_client_points(client_id) -> None:
        """Recompute a client's derived metrics (points + counters) from their
        orders. Best-effort — loyalty bookkeeping must never block a transition."""
        if not client_id:
            return
        try:
            from apps.clients.models import Client
            client = Client.objects.filter(pk=client_id).first()
            if client is not None:
                client.recalculate_metrics()
        except Exception:  # pragma: no cover - defensive
            pass

    @classmethod
    @transaction.atomic
    def mark_not_answered(cls, order: Order, *, actor=None, note: str = '') -> Order:
        """Record one unanswered client call attempt without confirming the order."""
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.status in (Order.Status.CONFIRMED, Order.Status.PACKAGING, Order.Status.DONE):
            raise LifecycleError('Confirmed orders cannot be marked as not answered.')

        now = timezone.now()
        order.not_answered_attempts = (order.not_answered_attempts or 0) + 1
        if not order.not_answered_at:
            order.not_answered_at = now
        order.delay_date = None
        order.delay_reason = ''
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.save(update_fields=[
            'not_answered_attempts', 'not_answered_at',
            'delay_date', 'delay_reason', 'outcome_note',
            'outcome_changed_at', 'outcome_changed_by', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.CONTACT_STATUS_CHANGED,
            user=actor,
            details={
                'attempts': order.not_answered_attempts,
                'note': note,
            },
        )
        # The order leaves ``new``/``delayed`` only once the configured number
        # of unanswered attempts is reached (each attempt is still audited).
        from apps.orders.status_service import OrderStatusService
        if (
            order.status in (Order.Status.NEW, Order.Status.DELAYED)
            and (order.not_answered_attempts or 0) >= cls._no_answer_threshold(order)
        ):
            OrderStatusService.transition(
                order, Order.Status.NOT_ANSWERED, actor=actor,
                note=f'{order.not_answered_attempts} unanswered attempts',
            )
        return order

    @classmethod
    @transaction.atomic
    def restore_delayed(cls, order: Order, *, actor=None) -> Order:
        """Move a delayed order back to the first-call pending state."""
        order = cls._lock(order)
        cls._ensure_active(order)
        if order.status != Order.Status.DELAYED:
            raise LifecycleError('Only delayed orders can be restored to pending.')

        order.delay_date = None
        order.delay_reason = ''
        order.outcome_note = ''
        order.confirmed_at = None
        order.not_answered_at = None
        order.not_answered_attempts = 0
        order.outcome_changed_at = timezone.now()
        order.outcome_changed_by = actor
        order.save(update_fields=[
            'delay_date', 'delay_reason',
            'outcome_note', 'confirmed_at', 'not_answered_at',
            'not_answered_attempts', 'outcome_changed_at',
            'outcome_changed_by', 'updated_at',
        ])
        # Undo semantics: putting a delayed order back in the first-call queue
        # is an admin convenience outside the strict matrix, so it goes through
        # the forced-but-audited path.
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.NEW, actor=actor,
            note='delay removed — restored to pending', force=True,
        )
        return order

    @classmethod
    @transaction.atomic
    def confirm(cls, order: Order, *, actor=None, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.status in (Order.Status.CONFIRMED, Order.Status.PACKAGING, Order.Status.DONE):
            raise LifecycleError('Order is already confirmed.')

        now = timezone.now()
        order.confirmed_at = now
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.delay_date = None
        order.delay_reason = ''
        order.cancellation_reason = ''
        order.not_answered_attempts = 0
        order.not_answered_at = None
        order.save(update_fields=[
            'confirmed_at', 'outcome_note', 'outcome_changed_at',
            'outcome_changed_by', 'delay_date', 'delay_reason',
            'cancellation_reason', 'not_answered_attempts',
            'not_answered_at', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.OUTCOME_CONFIRMED,
            user=actor,
            details={'note': note},
        )
        # Canonical lifecycle: new / delayed / not_answered → confirmed
        # (validated by the one transition matrix). Confirming is intentionally a
        # SIMPLE status move — stock is reserved later, when the order is actually
        # sent for fulfilment (delivery / POS), not here.
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.CONFIRMED, actor=actor, note=note,
        )
        return order

    @classmethod
    @transaction.atomic
    def delay(cls, order: Order, *, actor=None, delay_date, delay_reason: str, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if not delay_date:
            raise LifecycleError('Delay date is required for delayed orders.')
        if order.delivery_reference:
            raise LifecycleError('Order already entered delivery and cannot be delayed.')

        now = timezone.now()
        order.delay_date = delay_date
        order.delay_reason = delay_reason
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.confirmed_at = None
        order.cancellation_reason = ''
        order.save(update_fields=[
            'delay_date', 'delay_reason', 'outcome_note',
            'outcome_changed_at', 'outcome_changed_by', 'confirmed_at',
            'cancellation_reason', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.OUTCOME_DELAYED,
            user=actor,
            details={'delay_date': delay_date, 'delay_reason': delay_reason, 'note': note},
        )
        # Canonical lifecycle: new / not_answered / confirmed → delayed (validated).
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.DELAYED, actor=actor, note=delay_reason,
        )
        return order

    @classmethod
    @transaction.atomic
    def cancel(cls, order: Order, *, actor=None, reason: str, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        if order.status == Order.Status.CANCELED:
            raise LifecycleError('Order is already cancelled.')

        now = timezone.now()
        order.cancellation_reason = reason
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.confirmed_at = None
        order.delay_date = None
        order.delay_reason = ''
        order.save(update_fields=[
            'cancellation_reason', 'outcome_note',
            'outcome_changed_at', 'outcome_changed_by', 'confirmed_at',
            'delay_date', 'delay_reason', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.OUTCOME_CANCELLED,
            user=actor,
            details={'cancellation_reason': reason, 'note': note},
        )
        # Canonical lifecycle: canceled is reachable from every non-terminal
        # state; the matrix blocks it from done / returned. Loyalty reversal
        # and the WooCommerce 'cancelled' push intent ride on the transition.
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.CANCELED, actor=actor, note=reason,
        )
        # The order never completed, so release any stock it reserved at confirm
        # back to available. Idempotent (no-op if it held no reservation).
        from apps.orders.stock_service import OrderStockReservationService
        OrderStockReservationService.release(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def mark_in_store_pickup(cls, order: Order, *, actor=None, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.in_store_pickup:
            raise LifecycleError('Order is already marked as in-store pickup.')
        if order.status != Order.Status.CONFIRMED:
            raise LifecycleError('Order must be confirmed before pickup/POS flow.')

        order.in_store_pickup = True
        if note:
            order.internal_note = f"{order.internal_note}\n[Pickup] {note}".strip()
        order.save(update_fields=['in_store_pickup', 'internal_note', 'updated_at'])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.STATUS_CHANGED,
            user=actor,
            details={'in_store_pickup': True, 'note': note},
        )
        return order

    @classmethod
    @transaction.atomic
    def send_to_pos(cls, order: Order, *, pos_sales_channel: SalesChannel, actor=None) -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.status != Order.Status.CONFIRMED:
            raise LifecycleError('Order must be confirmed before sending to POS.')
        if order.delivery_reference:
            raise LifecycleError('Order has already entered delivery and cannot be sent to POS.')
        if order.sent_to_pos_at:
            raise LifecycleError('Order has already been sent to POS.')
        # Any sales channel can act as a POS pickup/checkout location (POS and
        # WooCommerce alike); it just has to be active, same-brand, and hold the
        # stock. The destination is validated/checked out from the POS page.
        if not pos_sales_channel.is_active:
            raise LifecycleError('Selected destination channel is inactive.')
        if pos_sales_channel.brand_id != order.sales_channel.brand_id:
            raise LifecycleError('Selected destination must belong to the same brand as this order.')

        # Stock gate: the selected POS location must physically hold enough of
        # every linked product before we route the order there.
        cls._assert_stock_available(
            order,
            sales_channel_id=pos_sales_channel.id,
            context='pos',
            channel_label=pos_sales_channel.name,
        )

        order.in_store_pickup = True
        order.pos_sales_channel = pos_sales_channel
        order.sent_to_pos_at = timezone.now()
        order.sent_to_pos_by = actor
        order.save(update_fields=[
            'in_store_pickup', 'pos_sales_channel',
            'sent_to_pos_at', 'sent_to_pos_by', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.SENT_TO_POS,
            user=actor,
            details={
                'pos_sales_channel_id': pos_sales_channel.id,
                'pos_sales_channel_name': pos_sales_channel.name,
            },
        )
        # Canonical lifecycle: confirmed → packaging (the order entered fulfilment).
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.PACKAGING, actor=actor,
            note=f'sent to POS {pos_sales_channel.name}',
        )
        # Tell the till's cashier(s) an order is waiting (best-effort; the
        # notification itself fans out after commit and never raises).
        try:
            from apps.notifications.services import NotificationService
            NotificationService.order_sent_to_pos(order, actor=actor)
        except Exception:  # pragma: no cover - notifications must never block routing
            pass
        return order

    @classmethod
    @transaction.atomic
    def validate_pos(
        cls,
        order: Order,
        *,
        actor=None,
        payment_method: str = '',
        payment_method_title: str = '',
        customer_note: str = '',
    ) -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if not order.sent_to_pos_at:
            raise LifecycleError('Order must be sent to POS before validation.')
        if order.pos_validated_at:
            raise LifecycleError('Order has already been validated by POS.')

        order.pos_validated_at = timezone.now()
        order.pos_validated_by = actor
        if payment_method:
            order.payment_method = payment_method
        order.payment_status = Order.PaymentStatus.PAID
        if customer_note:
            order.customer_note = customer_note
        order.save(update_fields=[
            'pos_validated_at', 'pos_validated_by',
            'payment_method', 'payment_status', 'customer_note', 'updated_at',
        ])
        # Canonical lifecycle FIRST: the stock engine below keys the sale
        # deduction on status == done.
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.DONE, actor=actor,
            note='POS validated', force=True,
        )

        from apps.orders.service import OrderIngestionError, OrderIngestionService

        inventory_channel = order.pos_sales_channel or order.sales_channel
        lines = list(order.lines.filter(is_deleted=False).select_related('product'))
        # Packaging-type items are owned by package_order(); refuse to validate
        # a POS pickup that has packaging lines, so we cannot accidentally
        # reintroduce the "packaging marks order done" path.
        for line in lines:
            if not line.product:
                continue
            if line.product.product_type == Product.ProductType.PACKAGING_ITEM:
                raise LifecycleError(
                    'POS validation cannot include packaging-type items. '
                    'Use the packaging endpoint to add packaging.'
                )
            if not line.product.is_sellable:
                raise LifecycleError(
                    f'Product "{line.product.name}" ({line.product.product_type}) is not sellable. '
                    'Only resell_product and pack items can appear on a customer order.'
                )
        try:
            OrderIngestionService._sync_inventory_movements(
                order,
                lines,
                inventory_channel,
                actor,
            )
        except OrderIngestionError as exc:
            raise LifecycleError(exc.message) from exc
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.POS_VALIDATED,
            user=actor,
            details={
                'payment_method': payment_method,
                'payment_method_title': payment_method_title,
                'sales_channel_id': inventory_channel.id,
                'sales_channel_name': inventory_channel.name,
            },
        )
        return order

    # ── Packaging step ───────────────────────────────────────────────────────
    # Adding packaging items is a separate operator step from POS validation.
    # It MUST NOT touch order.status / delivery_status / final_outcome.

    @staticmethod
    def _packaging_channel(order: Order):
        return (
            order.pos_sales_channel
            if order.pos_validated_at and order.pos_sales_channel_id
            else order.sales_channel
        )

    @classmethod
    def _net_packaging_moved(cls, order: Order, sales_channel) -> dict[int, int]:
        """Net packaging quantity already moved for this order per product."""
        rows = (
            InventoryMovement.objects
            .filter(
                sales_channel=sales_channel,
                external_reference=order.order_number,
                status=InventoryMovement.MovementStatus.COMPLETED,
                movement_type__in=[
                    InventoryMovement.MovementType.SALE,
                    InventoryMovement.MovementType.RETURN_IN,
                ],
                product__product_type=Product.ProductType.PACKAGING_ITEM,
            )
            .values('product_id', 'movement_type')
            .annotate(total=models.Sum('quantity'))
        )
        net: dict[int, int] = {}
        for row in rows:
            sign = 1 if row['movement_type'] == InventoryMovement.MovementType.SALE else -1
            net[row['product_id']] = net.get(row['product_id'], 0) + sign * (row['total'] or 0)
        return net

    @classmethod
    def _apply_packaging_stock(cls, order: Order, desired: dict[int, int], *, actor) -> list[dict]:
        """Reconcile packaging stock movements with the desired quantities.
        Returns a list of {product_id, action, quantity} for logging.
        """
        sales_channel = cls._packaging_channel(order)
        moved = cls._net_packaging_moved(order, sales_channel)
        product_ids = set(desired) | set(moved)
        if not product_ids:
            return []

        inventories = {
            inv.product_id: inv
            for inv in (
                SalesChannelInventory.objects
                .select_for_update()
                .filter(sales_channel=sales_channel, product_id__in=product_ids)
            )
        }
        products = {p.id: p for p in Product.objects.filter(id__in=product_ids)}
        movements_log: list[dict] = []

        for product_id in product_ids:
            desired_qty = desired.get(product_id, 0)
            already = moved.get(product_id, 0)
            delta = desired_qty - already
            if delta == 0:
                continue
            product = products.get(product_id)
            if not product:
                continue
            if product.product_type != Product.ProductType.PACKAGING_ITEM:
                raise LifecycleError(
                    f'Product "{product.name}" is not a packaging item.'
                )
            inventory = inventories.get(product_id)
            if delta > 0:
                if not inventory or inventory.available_quantity < delta:
                    available = inventory.available_quantity if inventory else 0
                    raise LifecycleError(
                        f'Insufficient packaging stock for "{product.name}". '
                        f'Required: {delta}, available: {available}.'
                    )
                quantity_before = inventory.quantity
                quantity_after = quantity_before - delta
                InventoryMovement.objects.create(
                    sales_channel=sales_channel,
                    product=product,
                    movement_type=InventoryMovement.MovementType.SALE,
                    status=InventoryMovement.MovementStatus.COMPLETED,
                    quantity=delta,
                    quantity_before=quantity_before,
                    quantity_after=quantity_after,
                    external_reference=order.order_number,
                    notes=f"Packaging deduction for order {order.order_number}",
                    created_by=actor,
                    completed_at=timezone.now(),
                )
                inventory.quantity = quantity_after
                movements_log.append({'product_id': product_id, 'action': 'deduct', 'quantity': delta})
            else:
                quantity = abs(delta)
                quantity_before = inventory.quantity if inventory else 0
                quantity_after = quantity_before + quantity
                InventoryMovement.objects.create(
                    sales_channel=sales_channel,
                    product=product,
                    movement_type=InventoryMovement.MovementType.RETURN_IN,
                    status=InventoryMovement.MovementStatus.COMPLETED,
                    quantity=quantity,
                    quantity_before=quantity_before,
                    quantity_after=quantity_after,
                    external_reference=order.order_number,
                    notes=f"Packaging reversal for order {order.order_number}",
                    created_by=actor,
                    completed_at=timezone.now(),
                )
                if inventory:
                    inventory.quantity = quantity_after
                movements_log.append({'product_id': product_id, 'action': 'reverse', 'quantity': quantity})
        return movements_log

    @classmethod
    @transaction.atomic
    def package_order(
        cls,
        order: Order,
        *,
        actor=None,
        packaging_items: list[dict],
        allow_update: bool = False,
    ) -> Order:
        """Add/replace packaging items on an order.

        `packaging_items` is `[{'product_id': int, 'quantity': int}, ...]`.
        Each product MUST have product_type=PACKAGING. The order must already
        have a delivery_code (or be in-store pickup) so that packaging is
        traceable to a real outbound parcel.

        Completing packaging is the local operational "done" step. It marks the
        order completed/successful locally while returns/exchanges can still
        override the final outcome later through process_return().
        """
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.status == Order.Status.RETURNED or order.returned_at:
            raise LifecycleError(
                'Packaging is blocked for returned orders.'
            )

        if not (order.delivery_code or order.delivery_reference or order.in_store_pickup):
            raise LifecycleError(
                'Packaging requires a delivery code or in-store pickup flag. '
                'Send the order to delivery (or POS) first.'
            )
        already_packaged = bool(order.packaged_at)
        if already_packaged and not allow_update:
            raise LifecycleError(
                'Order is already packaged. Pass allow_update=True to update packaging.'
            )

        # Normalize the desired payload to {product_id: quantity}
        if not isinstance(packaging_items, list) or not packaging_items:
            raise LifecycleError('At least one packaging item is required.')
        desired: dict[int, int] = {}
        for item in packaging_items:
            try:
                pid = int(item.get('product_id'))
                qty = int(item.get('quantity'))
            except (TypeError, ValueError) as exc:
                raise LifecycleError('Invalid packaging item payload.') from exc
            if qty <= 0:
                raise LifecycleError('Packaging quantity must be greater than zero.')
            desired[pid] = desired.get(pid, 0) + qty

        products = {p.id: p for p in Product.objects.filter(id__in=desired.keys())}
        for pid in desired:
            product = products.get(pid)
            if not product:
                raise LifecycleError(f'Packaging product id={pid} not found.')
            if product.product_type != Product.ProductType.PACKAGING_ITEM:
                raise LifecycleError(
                    f'Product "{product.name}" is not a packaging item.'
                )

        # Replace existing packaging-type OrderLine rows with the new set.
        # Customer (non-packaging) lines are untouched.
        existing_lines = list(
            order.lines.filter(
                is_deleted=False,
                product__product_type=Product.ProductType.PACKAGING_ITEM,
            ).select_related('product')
        )
        # Soft-delete existing packaging lines that are not in the new set,
        # or whose quantity changed.
        existing_by_product = {ln.product_id: ln for ln in existing_lines}
        for pid, line in existing_by_product.items():
            if pid not in desired or line.quantity != desired[pid]:
                line.is_deleted = True
                line.save(update_fields=['is_deleted'])
        # Create / update OrderLine rows
        for pid, qty in desired.items():
            existing = existing_by_product.get(pid)
            product = products[pid]
            if existing and not existing.is_deleted and existing.quantity == qty:
                continue
            from decimal import Decimal
            order.lines.create(
                product=product,
                product_name=product.name,
                barcode=getattr(product, 'barcode', '') or '',
                quantity=qty,
                unit_price=Decimal('0.00'),
                subtotal=Decimal('0.00'),
                tax=Decimal('0.00'),
                total=Decimal('0.00'),
            )

        # Adjust packaging stock movements (idempotent delta).
        movements = cls._apply_packaging_stock(order, desired, actor=actor)

        is_update = already_packaged
        if not order.packaged_at:
            order.packaged_at = timezone.now()
        order.packaged_by = actor
        order.save(update_fields=[
            'packaged_at', 'packaged_by', 'updated_at',
        ])

        # Canonical lifecycle FIRST: the stock engine below keys the customer-
        # line sale deduction on status == done. Forced — an operator may
        # package a confirmed pickup order directly (audited).
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.DONE, actor=actor,
            note='packaging completed', force=True,
        )

        OrderLoggingService.log(
            order=order,
            action=(
                OrderLog.Action.PACKAGING_UPDATED if is_update else OrderLog.Action.PACKAGED
            ),
            user=actor,
            details={'items': [{'product_id': p, 'quantity': q} for p, q in desired.items()],
                     'movements': movements},
        )

        # Packaging is this workflow's "sale" moment: the order is now COMPLETED +
        # SUCCESSFUL_SALE, so convert any stock reservation into an actual sale —
        # release the hold and decrement on-hand for the CUSTOMER lines. The
        # engine skips packaging-type lines (their stock was already moved above
        # by _apply_packaging_stock) and is idempotent (delta = desired - already
        # moved), so a later delivery-delivered / POS path reconciles to a no-op
        # instead of double-decrementing. Without this, a packaged order stayed
        # reserved forever and was never actually sold.
        from apps.orders.service import OrderIngestionError, OrderIngestionService
        inventory_channel = order.pos_sales_channel or order.sales_channel
        if inventory_channel:
            try:
                OrderIngestionService._sync_inventory_movements(
                    order,
                    list(order.lines.filter(is_deleted=False).select_related('product')),
                    inventory_channel,
                    actor,
                )
            except OrderIngestionError as exc:
                raise LifecycleError(exc.message) from exc

        return order

    @classmethod
    @transaction.atomic
    def unpackage_order(cls, order: Order, *, actor=None) -> Order:
        """Reverse all packaging deductions and step the lifecycle back."""
        order = cls._lock(order)
        cls._ensure_active(order)
        if not order.packaged_at:
            raise LifecycleError('Order has no packaging to reverse.')

        # Reverse stock by passing desired={} → every previously-moved product
        # becomes a RETURN_IN movement.
        movements = cls._apply_packaging_stock(order, desired={}, actor=actor)

        # Soft-delete packaging lines
        order.lines.filter(
            is_deleted=False,
            product__product_type=Product.ProductType.PACKAGING_ITEM,
        ).update(is_deleted=True)

        order.packaged_at = None
        order.packaged_by = None
        order.save(update_fields=[
            'packaged_at', 'packaged_by', 'updated_at',
        ])

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.PACKAGING_REVERSED,
            user=actor,
            details={'movements': movements},
        )
        # Canonical lifecycle: undo — step back from done. Falls to packaging
        # when the order is still routed to fulfilment, else to confirmed.
        from apps.orders.status_service import OrderStatusService
        if order.status == Order.Status.DONE:
            in_fulfilment = bool(order.sent_to_pos_at or order.delivery_reference)
            OrderStatusService.transition(
                order,
                Order.Status.PACKAGING if in_fulfilment else Order.Status.CONFIRMED,
                actor=actor, note='packaging reversed', force=True,
            )
        return order

    @classmethod
    def submit_delivery(cls, order: Order, *, actor=None, force: bool = False) -> dict:
        with transaction.atomic():
            locked = cls._lock(order)
            cls._ensure_active(locked)
            cls._ensure_not_cancelled(locked)
            if locked.in_store_pickup:
                raise LifecycleError('In-store pickup orders must go through POS, not delivery.')
            if locked.status != Order.Status.CONFIRMED:
                raise LifecycleError('Order must be confirmed before delivery submission.')
            if locked.delivery_reference:
                raise LifecycleError('Order has already been sent to delivery.')

            # Reserve stock at the point the order enters fulfilment (delivery).
            # Without force, an insufficient channel raises a shortfall message
            # (the UI shows the missing-stock warning first); with force the
            # operator acknowledged it, so we reserve best-effort (backorder).
            from apps.orders.stock_service import OrderStockReservationService
            OrderStockReservationService.reserve(locked, actor=actor, force=force)

        service = DeliverySubmissionService()
        result = service.submit(order, actor=actor)
        Order.all_objects.filter(pk=order.pk, delivery_submitted_by__isnull=True).update(
            delivery_submitted_by=actor,
        )
        # Canonical lifecycle: confirmed → packaging once the parcel is
        # actually handed to the delivery provider.
        from apps.orders.status_service import OrderStatusService
        order.refresh_from_db()
        if order.status == Order.Status.CONFIRMED:
            with transaction.atomic():
                OrderStatusService.transition(
                    cls._lock(order), Order.Status.PACKAGING,
                    actor=actor, note='submitted to delivery',
                )
        return result

    @classmethod
    @transaction.atomic
    def process_return(
        cls,
        order: Order,
        *,
        actor=None,
        reason: str = '',
        return_type: str | None = None,
        line_conditions: list[dict] | None = None,
    ) -> Order:
        """Mark an order as returned with structured classification.

        `return_type` (Order.ReturnType): operator-level reason.
        `line_conditions` (optional): `[{line_id, condition, replacement_product_id?}, ...]`.
        When provided, drives a per-line stock movement matrix:
          GOOD      → RETURN_IN
          DAMAGED   → DAMAGE movement (and product is NOT returned to available stock)
          MISSING   → no movement
          EXCHANGED → RETURN_IN for original line + SALE for replacement_product
        When omitted, falls back to legacy whole-order stock restoration.
        """
        order = cls._lock(order)
        cls._ensure_active(order)
        if order.returned_at or order.status == Order.Status.RETURNED:
            raise LifecycleError('Order return has already been processed.')
        if order.status not in (Order.Status.DONE, Order.Status.PACKAGING):
            raise LifecycleError('Only completed (or in-fulfilment) orders can be returned.')

        resolved_return_type = (return_type or Order.ReturnType.RETURNED) or Order.ReturnType.RETURNED
        if resolved_return_type not in dict(Order.ReturnType.choices):
            raise LifecycleError(f'Invalid return_type: {return_type}')

        order.returned_at = timezone.now()
        order.returned_by = actor
        order.return_reason = reason or ''
        order.return_type = resolved_return_type
        order.save(update_fields=[
            'returned_at', 'returned_by',
            'return_reason', 'return_type', 'updated_at',
        ])
        if order.client_id and order.source == Order.Source.WOOCOMMERCE:
            order.client.number_of_returns = (order.client.number_of_returns or 0) + 1
            order.client.save(update_fields=['number_of_returns', 'is_blocked', 'updated_at'])

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.RETURN_PROCESSED,
            user=actor,
            details={
                'reason': reason,
                'return_type': resolved_return_type,
                'line_conditions': line_conditions or [],
            },
        )
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.RETURN_TYPE_SET,
            user=actor,
            details={'return_type': resolved_return_type},
        )

        if line_conditions:
            cls._apply_structured_return_conditions(order, line_conditions, actor=actor)
        else:
            # Backward compatibility: whole-order restoration based on return_type.
            if resolved_return_type in (Order.ReturnType.DAMAGED, Order.ReturnType.MISSING):
                # Do NOT restore stock to available bin.
                order.stock_restored_at = timezone.now()
                order.stock_restored_by = actor
                order.save(update_fields=['stock_restored_at', 'stock_restored_by', 'updated_at'])
                OrderLoggingService.log(
                    order=order, action=OrderLog.Action.STOCK_RESTORED,
                    user=actor, details={'reason': 'damaged_or_missing_no_restore'},
                )
            else:
                cls._restore_stock_locked(order, actor=actor)

        # Canonical lifecycle: done → returned (matrix). Forced only when the
        # courier returned the parcel before completion (packaging → returned).
        # Loyalty reversal + the WooCommerce 'refunded' push intent ride on the
        # transition.
        from apps.orders.status_service import OrderStatusService
        OrderStatusService.transition(
            order, Order.Status.RETURNED, actor=actor,
            note=reason or resolved_return_type,
            force=(order.status != Order.Status.DONE),
        )
        return order

    @staticmethod
    def _pack_component_ids(product: Product | None) -> set[int]:
        """Return valid immediate component IDs for a pack product."""
        if not product or not product.is_pack or not product.pack_items:
            return set()
        component_ids: set[int] = set()
        for item in product.pack_items:
            if not isinstance(item, dict):
                continue
            try:
                component_ids.add(int(item.get('product_id')))
            except (TypeError, ValueError):
                continue
        return component_ids

    @classmethod
    def _stock_items_for_product(
        cls,
        product: Product,
        quantity: int,
        products: dict[int, Product],
    ) -> list[dict]:
        """Expand a sellable product into the inventory items it represents."""
        if not product.is_pack:
            return [{
                'product': product,
                'quantity': quantity,
                'source_pack': None,
            }]
        if not product.pack_items:
            raise LifecycleError(f'Pack "{product.name}" has no configured components.')

        stock_items: list[dict] = []
        errors: list[str] = []
        for item in product.pack_items:
            if not isinstance(item, dict):
                errors.append('invalid component row')
                continue
            try:
                component_id = int(item.get('product_id'))
                per_pack_quantity = int(item.get('quantity'))
            except (TypeError, ValueError):
                errors.append('invalid component identifier or quantity')
                continue
            if per_pack_quantity <= 0:
                errors.append(f'component {component_id} has a non-positive quantity')
                continue
            component = products.get(component_id)
            if not component:
                errors.append(f'component {component_id} is missing')
                continue
            stock_items.append({
                'product': component,
                'quantity': per_pack_quantity * quantity,
                'source_pack': product,
            })

        if errors:
            raise LifecycleError(
                f'Pack "{product.name}" cannot be returned: {"; ".join(errors)}.'
            )
        return stock_items

    @classmethod
    def _pack_sources_by_component(cls, order: Order) -> dict[int, set[str]]:
        """Map component IDs to pack names for legacy whole-order return notes."""
        sources: dict[int, set[str]] = {}
        for line in order.lines.filter(is_deleted=False).select_related('product'):
            product = line.product
            if not product or not product.is_pack:
                continue
            for component_id in cls._pack_component_ids(product):
                sources.setdefault(component_id, set()).add(product.name)
        return sources

    @staticmethod
    def _conditioned_stock_items(
        line,
        stock_items: list[dict],
        component_conditions: list[dict],
    ) -> list[dict]:
        """Split stock items by per-unit condition and validate the totals.

        Works for both packs (one entry per component product) and normal lines
        (a single product split into good/damaged quantities). The caller-built
        ``stock_items`` already carry the correct ``source_pack`` (the pack for
        pack components, ``None`` for a plain line), which we preserve so notes
        and movements stay accurate.
        """
        expected = {
            stock_item['product'].id: stock_item['quantity']
            for stock_item in stock_items
        }
        products = {
            stock_item['product'].id: stock_item['product']
            for stock_item in stock_items
        }
        source_pack_by_product = {
            stock_item['product'].id: stock_item['source_pack']
            for stock_item in stock_items
        }
        line_label = line.product.name if line.product else f'line {line.id}'
        allowed = {
            line.ReturnCondition.GOOD,
            line.ReturnCondition.DAMAGED,
            line.ReturnCondition.MISSING,
        }
        classified_totals: dict[int, int] = {}
        conditioned: list[dict] = []

        for component_condition in component_conditions:
            try:
                product_id = int(component_condition.get('product_id'))
                quantity = int(component_condition.get('quantity'))
            except (TypeError, ValueError):
                raise LifecycleError(
                    f'Invalid unit classification for "{line_label}".'
                )
            condition = component_condition.get('condition')
            if product_id not in expected:
                raise LifecycleError(
                    f'Product id={product_id} is not part of "{line_label}".'
                )
            if quantity <= 0 or condition not in allowed:
                raise LifecycleError(
                    f'Invalid return quantity or condition for '
                    f'"{products[product_id].name}".'
                )
            classified_totals[product_id] = (
                classified_totals.get(product_id, 0) + quantity
            )
            conditioned.append({
                'product': products[product_id],
                'quantity': quantity,
                'source_pack': source_pack_by_product.get(product_id),
                'condition': condition,
            })

        mismatches = []
        for product_id, expected_quantity in expected.items():
            actual_quantity = classified_totals.get(product_id, 0)
            if actual_quantity != expected_quantity:
                mismatches.append(
                    f'{products[product_id].name}: expected {expected_quantity}, '
                    f'classified {actual_quantity}'
                )
        unexpected_ids = set(classified_totals) - set(expected)
        if unexpected_ids:
            mismatches.extend(f'unexpected product id={pid}' for pid in unexpected_ids)
        if mismatches:
            raise LifecycleError(
                f'Incomplete return for "{line_label}": '
                f'{"; ".join(mismatches)}.'
            )
        return conditioned

    @classmethod
    def _apply_structured_return_conditions(
        cls, order: Order, line_conditions: list[dict], *, actor,
    ) -> None:
        """Apply the per-line stock-movement matrix for a structured return.
        Pack entries may also include component_conditions with quantity splits.
        """
        sales_channel = (
            order.pos_sales_channel
            if order.pos_validated_at and order.pos_sales_channel_id
            else order.sales_channel
        )

        line_map = {ln.id: ln for ln in order.lines.filter(is_deleted=False).select_related('product')}
        replacement_ids = {
            int(item.get('replacement_product_id'))
            for item in line_conditions
            if item.get('replacement_product_id')
        }
        replacement_products = {
            p.id: p for p in Product.objects.filter(id__in=replacement_ids)
        } if replacement_ids else {}

        inv_product_ids: set[int] = set()
        for item in line_conditions:
            line = line_map.get(int(item.get('line_id', 0)))
            if line and line.product_id:
                if line.product and line.product.is_pack:
                    inv_product_ids |= cls._pack_component_ids(line.product)
                else:
                    inv_product_ids.add(line.product_id)
        for replacement in replacement_products.values():
            if replacement.is_pack:
                inv_product_ids |= cls._pack_component_ids(replacement)
            else:
                inv_product_ids.add(replacement.id)

        stock_products = {
            product.id: product
            for product in Product.all_objects.filter(id__in=inv_product_ids)
        }
        inventories = {
            inv.product_id: inv
            for inv in (
                SalesChannelInventory.objects
                .select_for_update()
                .filter(sales_channel=sales_channel, product_id__in=inv_product_ids)
            )
        }

        restored: list[dict] = []
        for item in line_conditions:
            line = line_map.get(int(item.get('line_id', 0)))
            condition = item.get('condition')
            if not line or not line.product_id:
                continue
            if condition not in dict(line.ReturnCondition.choices):
                raise LifecycleError(f'Invalid line condition: {condition}')

            qty = line.quantity
            stock_items = cls._stock_items_for_product(line.product, qty, stock_products)
            component_conditions = item.get('component_conditions') or []
            if component_conditions:
                # Per-unit split — valid for packs (per component product) AND
                # plain lines (one product, good/damaged quantity split).
                stock_items = cls._conditioned_stock_items(
                    line,
                    stock_items,
                    component_conditions,
                )
                component_outcomes = {
                    stock_item['condition'] for stock_item in stock_items
                }
                # The line-level enum has no MIXED state. DAMAGED indicates that
                # at least one pack unit was not returned in good condition; the
                # exact split remains in movements and the STOCK_RESTORED log.
                line.return_condition = (
                    line.ReturnCondition.GOOD
                    if component_outcomes == {line.ReturnCondition.GOOD}
                    else line.ReturnCondition.DAMAGED
                )
            else:
                line.return_condition = condition
            update_fields = ['return_condition']

            if component_conditions or condition in (
                line.ReturnCondition.GOOD,
                line.ReturnCondition.DAMAGED,
                line.ReturnCondition.MISSING,
            ):
                damaged_items: list[dict] = []
                for stock_item in stock_items:
                    product = stock_item['product']
                    item_qty = stock_item['quantity']
                    source_pack = stock_item['source_pack']
                    item_condition = stock_item.get('condition', condition)
                    inventory = inventories.get(product.id)
                    before = inventory.quantity if inventory else 0
                    pack_note = f" (pack: {source_pack.name})" if source_pack else ''
                    if item_condition == line.ReturnCondition.GOOD:
                        after = before + item_qty
                        InventoryMovement.objects.create(
                            sales_channel=sales_channel,
                            product=product,
                            movement_type=InventoryMovement.MovementType.RETURN_IN,
                            status=InventoryMovement.MovementStatus.COMPLETED,
                            quantity=item_qty,
                            quantity_before=before,
                            quantity_after=after,
                            external_reference=order.order_number,
                            notes=f"Return GOOD for order {order.order_number}{pack_note}",
                            created_by=actor,
                            completed_at=timezone.now(),
                        )
                        if inventory:
                            inventory.quantity = after
                        else:
                            inventories[product.id] = (
                                SalesChannelInventory.objects
                                .select_for_update()
                                .get(sales_channel=sales_channel, product=product)
                            )
                        restored.append({
                            'line_id': line.id,
                            'product_id': product.id,
                            'source_pack_id': source_pack.id if source_pack else None,
                            'source_pack_name': source_pack.name if source_pack else '',
                            'action': 'return_in',
                            'quantity': item_qty,
                        })
                    elif item_condition == line.ReturnCondition.DAMAGED:
                        InventoryMovement.objects.create(
                            sales_channel=sales_channel,
                            product=product,
                            movement_type=InventoryMovement.MovementType.DAMAGE,
                            status=InventoryMovement.MovementStatus.COMPLETED,
                            quantity=item_qty,
                            quantity_before=before,
                            quantity_after=before,
                            external_reference=order.order_number,
                            notes=(
                                f"Return DAMAGED for order "
                                f"{order.order_number}{pack_note}"
                            ),
                            created_by=actor,
                            completed_at=timezone.now(),
                        )
                        damaged_item = {
                            'line_id': line.id,
                            'product_id': product.id,
                            'source_pack_id': source_pack.id if source_pack else None,
                            'source_pack_name': source_pack.name if source_pack else '',
                            'action': 'damage',
                            'quantity': item_qty,
                        }
                        damaged_items.append(damaged_item)
                        restored.append(damaged_item)
                    elif item_condition == line.ReturnCondition.MISSING:
                        restored.append({
                            'line_id': line.id,
                            'product_id': product.id,
                            'source_pack_id': source_pack.id if source_pack else None,
                            'source_pack_name': source_pack.name if source_pack else '',
                            'action': 'missing_no_movement',
                            'quantity': item_qty,
                        })
                if damaged_items:
                    OrderLoggingService.log(
                        order=order,
                        action=OrderLog.Action.DAMAGED_STOCK_RECORDED,
                        user=actor,
                        details={'line_id': line.id, 'items': damaged_items},
                    )

            elif condition == line.ReturnCondition.EXCHANGED:
                rep_id = item.get('replacement_product_id')
                if not rep_id:
                    raise LifecycleError(
                        f'Replacement product required for EXCHANGED line {line.id}.'
                    )
                rep = replacement_products.get(int(rep_id))
                if not rep:
                    raise LifecycleError(f'Replacement product id={rep_id} not found.')
                line.replacement_product = rep
                update_fields.append('replacement_product')

                # Return every original inventory item, expanding pack lines.
                for stock_item in stock_items:
                    product = stock_item['product']
                    item_qty = stock_item['quantity']
                    source_pack = stock_item['source_pack']
                    inventory = inventories.get(product.id)
                    before = inventory.quantity if inventory else 0
                    after = before + item_qty
                    pack_note = f" (pack: {source_pack.name})" if source_pack else ''
                    InventoryMovement.objects.create(
                        sales_channel=sales_channel,
                        product=product,
                        movement_type=InventoryMovement.MovementType.RETURN_IN,
                        status=InventoryMovement.MovementStatus.COMPLETED,
                        quantity=item_qty,
                        quantity_before=before,
                        quantity_after=after,
                        external_reference=order.order_number,
                        notes=f"Exchange return-in for order {order.order_number}{pack_note}",
                        created_by=actor,
                        completed_at=timezone.now(),
                    )
                    if inventory:
                        inventory.quantity = after
                    else:
                        inventories[product.id] = (
                            SalesChannelInventory.objects
                            .select_for_update()
                            .get(sales_channel=sales_channel, product=product)
                        )
                    restored.append({
                        'line_id': line.id,
                        'product_id': product.id,
                        'source_pack_id': source_pack.id if source_pack else None,
                        'source_pack_name': source_pack.name if source_pack else '',
                        'action': 'exchange_return_in',
                        'quantity': item_qty,
                    })

                # Deduct replacement inventory, also expanding a replacement pack.
                replacement_items = cls._stock_items_for_product(rep, qty, stock_products)
                for replacement_item in replacement_items:
                    replacement_product = replacement_item['product']
                    replacement_qty = replacement_item['quantity']
                    replacement_inventory = inventories.get(replacement_product.id)
                    available = (
                        replacement_inventory.available_quantity
                        if replacement_inventory else 0
                    )
                    if available < replacement_qty:
                        raise LifecycleError(
                            f'Insufficient stock for replacement "{replacement_product.name}". '
                            f'Required: {replacement_qty}, available: {available}.'
                        )
                replacement_log: list[dict] = []
                for replacement_item in replacement_items:
                    replacement_product = replacement_item['product']
                    replacement_qty = replacement_item['quantity']
                    source_pack = replacement_item['source_pack']
                    replacement_inventory = inventories[replacement_product.id]
                    before_rep = replacement_inventory.quantity
                    after_rep = before_rep - replacement_qty
                    pack_note = f" (pack: {source_pack.name})" if source_pack else ''
                    InventoryMovement.objects.create(
                        sales_channel=sales_channel,
                        product=replacement_product,
                        movement_type=InventoryMovement.MovementType.SALE,
                        status=InventoryMovement.MovementStatus.COMPLETED,
                        quantity=replacement_qty,
                        quantity_before=before_rep,
                        quantity_after=after_rep,
                        external_reference=order.order_number,
                        notes=(
                            f"Exchange replacement-out for order "
                            f"{order.order_number}{pack_note}"
                        ),
                        created_by=actor,
                        completed_at=timezone.now(),
                    )
                    replacement_inventory.quantity = after_rep
                    replacement_entry = {
                        'product_id': replacement_product.id,
                        'source_pack_id': source_pack.id if source_pack else None,
                        'source_pack_name': source_pack.name if source_pack else '',
                        'quantity': replacement_qty,
                    }
                    replacement_log.append(replacement_entry)
                    restored.append({
                        'line_id': line.id,
                        **replacement_entry,
                        'action': 'exchange_replacement_out',
                    })
                OrderLoggingService.log(
                    order=order,
                    action=OrderLog.Action.REPLACEMENT_DEDUCTED,
                    user=actor,
                    details={
                        'line_id': line.id,
                        'replacement_product_id': rep.id,
                        'items': replacement_log,
                    },
                )

            line.save(update_fields=update_fields)

        # Mark stock as restored so legacy code paths don't double-process this.
        order.stock_restored_at = timezone.now()
        order.stock_restored_by = actor
        order.save(update_fields=['stock_restored_at', 'stock_restored_by', 'updated_at'])
        OrderLoggingService.log(
            order=order, action=OrderLog.Action.STOCK_RESTORED,
            user=actor, details={'items': restored, 'structured': True},
        )

    @classmethod
    @transaction.atomic
    def restore_stock_from_return(cls, order: Order, *, actor=None) -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        if not order.returned_at and order.status != Order.Status.RETURNED:
            raise LifecycleError('Order must be marked as returned before stock restoration.')
        cls._restore_stock_locked(order, actor=actor)
        return order

    @classmethod
    def _restore_stock_locked(cls, order: Order, *, actor=None) -> None:
        if order.stock_restored_at:
            raise LifecycleError('Order stock has already been restored.')

        stock_channel = order.pos_sales_channel if order.pos_validated_at and order.pos_sales_channel_id else order.sales_channel
        movement_rows = (
            InventoryMovement.objects
            .filter(
                sales_channel=stock_channel,
                external_reference=order.order_number,
                status=InventoryMovement.MovementStatus.COMPLETED,
            )
            .exclude(
                product__product_type=Product.ProductType.PACKAGING_ITEM,
            )
            .filter(
                movement_type__in=[
                    InventoryMovement.MovementType.SALE,
                    InventoryMovement.MovementType.RETURN_IN,
                ],
            )
            .values('product_id', 'movement_type')
            .annotate(total=models.Sum('quantity'))
        )
        net_by_product: dict[int, int] = {}
        for row in movement_rows:
            sign = 1 if row['movement_type'] == InventoryMovement.MovementType.SALE else -1
            net_by_product[row['product_id']] = net_by_product.get(row['product_id'], 0) + sign * (row['total'] or 0)

        restore_ids = [pid for pid, qty in net_by_product.items() if qty > 0]
        inventories = {
            inv.product_id: inv
            for inv in (
                SalesChannelInventory.objects
                .select_for_update()
                .filter(sales_channel=stock_channel, product_id__in=restore_ids)
            )
        }
        products = {p.id: p for p in Product.all_objects.filter(id__in=restore_ids)}
        pack_sources = cls._pack_sources_by_component(order)

        restored = []
        for product_id in restore_ids:
            qty = net_by_product[product_id]
            product = products.get(product_id)
            if not product:
                continue
            inventory = inventories.get(product_id)
            before = inventory.quantity if inventory else 0
            source_packs = sorted(pack_sources.get(product_id, set()))
            pack_note = (
                f" (pack component: {', '.join(source_packs)})"
                if source_packs else ''
            )
            InventoryMovement.objects.create(
                sales_channel=stock_channel,
                product=product,
                movement_type=InventoryMovement.MovementType.RETURN_IN,
                status=InventoryMovement.MovementStatus.COMPLETED,
                quantity=qty,
                quantity_before=before,
                quantity_after=before + qty,
                external_reference=order.order_number,
                notes=(
                    f"Stock restored from returned order "
                    f"{order.order_number}{pack_note}"
                ),
                created_by=actor,
                completed_at=timezone.now(),
            )
            restored.append({
                'product_id': product_id,
                'quantity': qty,
                'source_packs': source_packs,
            })

        order.stock_restored_at = timezone.now()
        order.stock_restored_by = actor
        order.save(update_fields=['stock_restored_at', 'stock_restored_by', 'updated_at'])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.STOCK_RESTORED,
            user=actor,
            details={'items': restored},
        )

    # ── Manual backward transitions / reopen (admin override) ────────────────
    # Admin/manager-only, reason-required, fully audited overrides. Each move
    # unwinds the matching side effects (packaging stock, routing, holds,
    # return bookkeeping), then the status itself moves through
    # OrderStatusService.transition(force=True) — the same audited write path
    # as every other change.

    ALLOWED_MANUAL_TRANSITIONS: dict[str, set[str]] = {
        Order.Status.DONE:         {Order.Status.PACKAGING},
        Order.Status.PACKAGING:    {Order.Status.CONFIRMED},
        Order.Status.CONFIRMED:    {Order.Status.NEW},
        Order.Status.DELAYED:      {Order.Status.NEW},
        Order.Status.NOT_ANSWERED: {Order.Status.NEW},
        Order.Status.RETURNED:     {Order.Status.DONE},
        Order.Status.CANCELED:     {Order.Status.NEW, Order.Status.CONFIRMED},
    }

    @staticmethod
    def _assert_can_manual_override(actor) -> None:
        """Gate on the ``manual_status_override`` permission (admin/manager).

        Checked via PermissionService so nothing is hardcoded: superusers pass,
        and the codename is granted to the admin/manager roles by the rbac
        layer. Denies by default (including ``actor is None``).
        """
        from apps.rbac.services import PermissionService
        if actor is not None and PermissionService.has_permission(actor, 'manual_status_override'):
            return
        raise LifecycleError(
            'You do not have permission to manually override an order status. '
            'This action is limited to admin / manager roles.'
        )

    @classmethod
    @transaction.atomic
    def manual_transition(cls, order: Order, *, target: str, actor=None, reason: str) -> Order:
        """Move an order backward (or reopen a terminal one) — audited override."""
        if not reason or not str(reason).strip():
            raise LifecycleError('A reason is required for a manual status change.')
        cls._assert_can_manual_override(actor)

        order = cls._lock(order)
        cls._ensure_active(order)

        from apps.orders.status_service import OrderStatusService

        current = order.status
        S = Order.Status
        if target == current:
            raise LifecycleError(f'Order is already "{current}".')
        allowed = cls.ALLOWED_MANUAL_TRANSITIONS.get(current, set())
        if target not in allowed:
            raise LifecycleError(
                f'Manual transition "{current}" → "{target}" is not allowed. '
                f'Allowed from "{current}": {sorted(allowed) or "(none)"}.'
            )

        notes: dict = {}
        if current == S.DONE and target == S.PACKAGING:
            cls._mt_done_to_packaging(order, actor=actor, notes=notes)
        elif current == S.PACKAGING and target == S.CONFIRMED:
            cls._mt_packaging_to_confirmed(order, actor=actor, notes=notes)
        elif current == S.RETURNED and target == S.DONE:
            cls._mt_returned_to_done(order, actor=actor, notes=notes)
        elif current == S.CANCELED:
            cls._mt_canceled_reopen(order, actor=actor, confirm=(target == S.CONFIRMED), notes=notes)
        else:  # confirmed / delayed / not_answered → new
            cls._mt_clear_holds_to_pending(order, actor=actor, notes=notes)

        OrderStatusService.transition(
            order, target, actor=actor,
            note=f'manual override: {reason}', force=True,
        )

        # returned → done: re-apply the sale through the idempotent delta
        # engine AFTER the status landed on done (the engine keys on it).
        if current == S.RETURNED and target == S.DONE:
            from apps.orders.service import OrderIngestionError, OrderIngestionService
            channel = (
                order.pos_sales_channel
                if order.pos_validated_at and order.pos_sales_channel_id
                else order.sales_channel
            )
            lines = list(order.lines.filter(is_deleted=False).select_related('product'))
            try:
                OrderIngestionService._sync_inventory_movements(order, lines, channel, actor)
            except OrderIngestionError as exc:
                raise LifecycleError(exc.message) from exc
            if order.client_id and not order.loyalty_points_granted:
                try:
                    cls.grant_loyalty_points(order, actor=actor)
                except Exception:  # noqa: BLE001 - points are non-fatal
                    pass
            notes['stock'] = 're_deducted_delta'
            notes['points'] = 're_granted'

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.MANUAL_STATUS_OVERRIDE,
            user=actor,
            details={
                'from': current,
                'to': order.status,
                'reason': reason,
                **({'side_effects': notes} if notes else {}),
            },
        )
        return order

    # ── Per-transition side-effect handlers ──────────────────────────────────

    @classmethod
    def _mt_returned_to_done(cls, order: Order, *, actor, notes: dict) -> None:
        """Clear the return bookkeeping so the sale can be re-applied."""
        order.returned_at = None
        order.returned_by = None
        order.return_reason = ''
        order.return_type = Order.ReturnType.NONE
        # Allow a future genuine return to restore stock again.
        order.stock_restored_at = None
        order.stock_restored_by = None
        order.save(update_fields=[
            'returned_at', 'returned_by', 'return_reason', 'return_type',
            'stock_restored_at', 'stock_restored_by', 'updated_at',
        ])
        # Undo the return's customer-stat bump (mirrors process_return's guard).
        if order.client_id and order.source == Order.Source.WOOCOMMERCE:
            from apps.clients.models import Client
            client = Client.objects.select_for_update().get(pk=order.client_id)
            if (client.number_of_returns or 0) > 0:
                client.number_of_returns -= 1
                client.save(update_fields=['number_of_returns', 'is_blocked', 'updated_at'])
        notes['return'] = 'cleared'

    @classmethod
    def _mt_done_to_packaging(cls, order: Order, *, actor, notes: dict) -> None:
        """Unwind the done push: reverse packaging only; the customer-line sale
        stays deducted (the order is still selling) and re-validation /
        re-packaging is idempotent, so no double-counting occurs."""
        if order.packaged_at:
            cls._apply_packaging_stock(order, desired={}, actor=actor)
            order.lines.filter(
                is_deleted=False,
                product__product_type=Product.ProductType.PACKAGING_ITEM,
            ).update(is_deleted=True)
            order.packaged_at = None
            order.packaged_by = None
            notes['packaging'] = 'reversed'
        order.pos_validated_at = None
        order.pos_validated_by = None
        order.save(update_fields=[
            'packaged_at', 'packaged_by',
            'pos_validated_at', 'pos_validated_by', 'updated_at',
        ])
        # Guarantee a fulfilment-routing signal so "packaging" makes sense for
        # an order that had no delivery reference.
        if not (order.sent_to_pos_at or order.delivery_reference):
            order.sent_to_pos_at = timezone.now()
            order.sent_to_pos_by = actor
            order.save(update_fields=['sent_to_pos_at', 'sent_to_pos_by', 'updated_at'])

    @classmethod
    def _mt_packaging_to_confirmed(cls, order: Order, *, actor, notes: dict) -> None:
        """Release fulfilment routing; keep the order confirmed."""
        order.sent_to_pos_at = None
        order.sent_to_pos_by = None
        order.pos_sales_channel = None
        order.delivery_reference = ''
        order.in_store_pickup = False
        if not order.confirmed_at:
            order.confirmed_at = timezone.now()
        order.save(update_fields=[
            'sent_to_pos_at', 'sent_to_pos_by', 'pos_sales_channel',
            'delivery_reference', 'in_store_pickup',
            'confirmed_at', 'updated_at',
        ])
        notes['fulfilment'] = 'routing_released'

    @classmethod
    def _mt_clear_holds_to_pending(cls, order: Order, *, actor, notes: dict) -> None:
        """confirmed / delayed / not_answered → new: clear holds."""
        order.delay_date = None
        order.delay_reason = ''
        order.delay_until = None
        order.delay_note = ''
        order.not_answered_attempts = 0
        order.not_answered_at = None
        order.confirmed_at = None
        order.outcome_changed_at = timezone.now()
        order.outcome_changed_by = actor
        order.save(update_fields=[
            'delay_date', 'delay_reason', 'delay_until', 'delay_note',
            'not_answered_attempts', 'not_answered_at', 'confirmed_at',
            'outcome_changed_at', 'outcome_changed_by', 'updated_at',
        ])
        notes['holds'] = 'cleared'

    @classmethod
    def _mt_canceled_reopen(cls, order: Order, *, actor, confirm: bool, notes: dict) -> None:
        """canceled → confirmed | new: admin reopen.

        Cancellation never moved stock, so there is nothing to restore."""
        order.cancellation_reason = ''
        order.outcome_changed_at = timezone.now()
        order.outcome_changed_by = actor
        if confirm and not order.confirmed_at:
            order.confirmed_at = timezone.now()
        if not confirm:
            order.confirmed_at = None
        order.save(update_fields=[
            'cancellation_reason', 'confirmed_at',
            'outcome_changed_at', 'outcome_changed_by', 'updated_at',
        ])
        notes['reopen'] = 'confirmed' if confirm else 'new'
