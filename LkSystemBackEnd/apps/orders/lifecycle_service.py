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
        Order.Status.CANCELLED,
        Order.Status.REFUNDED,
        Order.Status.FAILED,
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
        if order.status == Order.Status.CANCELLED or order.outcome == Order.Outcome.CANCELLED:
            raise LifecycleError('Order is cancelled and cannot be processed.')

    # ── Final-outcome recompute ──────────────────────────────────────────────
    # Single contract that determines Order.final_outcome from the current state
    # of every other status field. Called after every lifecycle transition so
    # KPIs always read from the same derivation.

    _IN_FLIGHT_DELIVERY = (
        Order.DeliveryStatus.QUEUED,
        Order.DeliveryStatus.SUBMITTED,
        Order.DeliveryStatus.ACCEPTED,
        Order.DeliveryStatus.IN_TRANSIT,
    )

    @classmethod
    def _derive_final_outcome(cls, order: Order) -> str:
        # Exchange wins over any other terminal classification when set.
        if order.return_exchange_status == Order.ReturnExchangeStatus.EXCHANGED:
            return Order.FinalOutcome.EXCHANGED
        # Returns (regardless of how they were captured)
        if (
            order.returned_at
            or order.delivery_status == Order.DeliveryStatus.RETURNED
            or order.return_exchange_status == Order.ReturnExchangeStatus.RETURNED
        ):
            return Order.FinalOutcome.RETURNED
        # Cancellations split by whether delivery already happened
        if order.delivery_status == Order.DeliveryStatus.CANCELLED:
            return Order.FinalOutcome.CANCELLED_AFTER_DELIVERY
        if order.outcome == Order.Outcome.CANCELLED or order.status == Order.Status.CANCELLED:
            if order.delivery_status == Order.DeliveryStatus.DELIVERED or order.pos_validated_at:
                return Order.FinalOutcome.CANCELLED_AFTER_DELIVERY
            return Order.FinalOutcome.CANCELLED_BEFORE_DELIVERY
        # Terminal failed delivery
        if order.delivery_status == Order.DeliveryStatus.FAILED and not order.pos_validated_at:
            return Order.FinalOutcome.FAILED_DELIVERY
        # Successful sale: delivery confirmed or POS pickup completed.
        if order.delivery_status == Order.DeliveryStatus.DELIVERED:
            return Order.FinalOutcome.SUCCESSFUL_SALE
        if order.pos_validated_at and order.delivery_status not in cls._IN_FLIGHT_DELIVERY:
            return Order.FinalOutcome.SUCCESSFUL_SALE
        return Order.FinalOutcome.NONE

    @classmethod
    def _recompute_outcome(cls, order: Order, *, actor=None) -> str:
        """Recompute and persist Order.final_outcome based on current fields.
        Returns the new outcome. Logs only when the value actually changes.
        Always followed by _recompute_workflow_status so the 10-state UI status
        stays in lockstep.
        """
        new_outcome = cls._derive_final_outcome(order)
        if new_outcome != order.final_outcome:
            old_outcome = order.final_outcome
            order.final_outcome = new_outcome
            order.save(update_fields=['final_outcome', 'updated_at'])
            OrderLoggingService.log(
                order=order,
                action=OrderLog.Action.FINAL_OUTCOME_CHANGED,
                user=actor,
                details={'old': old_outcome, 'new': new_outcome},
            )
        # Always recompute workflow_status — it depends on more than just final_outcome.
        cls._recompute_workflow_status(order, actor=actor)
        return new_outcome

    # ── Unified workflow status (Phase 2) ────────────────────────────────────

    @classmethod
    def _derive_workflow_status(cls, order: Order) -> str:
        """10-state main workflow derivation. Highest match wins.
        Stays in sync with the same logic duplicated in migration 0012.
        """
        if order.return_exchange_status == Order.ReturnExchangeStatus.EXCHANGED \
                or order.final_outcome == Order.FinalOutcome.EXCHANGED:
            return Order.WorkflowStatus.CHANGED
        if (
            order.returned_at
            or order.delivery_status == Order.DeliveryStatus.RETURNED
            or order.final_outcome == Order.FinalOutcome.RETURNED
        ):
            return Order.WorkflowStatus.RETOUR
        if order.status == Order.Status.CANCELLED or order.outcome == Order.Outcome.CANCELLED:
            return Order.WorkflowStatus.CANCELLED
        if order.final_outcome == Order.FinalOutcome.SUCCESSFUL_SALE:
            return Order.WorkflowStatus.DONE
        if order.packaging_status in (
            Order.PackagingStatus.PACKAGED, Order.PackagingStatus.UPDATED,
        ) and order.delivery_status in cls._IN_FLIGHT_DELIVERY:
            return Order.WorkflowStatus.PACKAGING
        if order.delivery_status in cls._IN_FLIGHT_DELIVERY or order.delivery_reference:
            return Order.WorkflowStatus.SENT_TO_DELIVERY
        if order.outcome == Order.Outcome.DELAYED or order.contact_status == Order.ContactStatus.DELAYED:
            return Order.WorkflowStatus.DELAYED
        if order.outcome == Order.Outcome.CONFIRMED:
            return Order.WorkflowStatus.ANSWERED
        if order.contact_status == Order.ContactStatus.NOT_ANSWERED:
            return Order.WorkflowStatus.NOT_ANSWERED
        return Order.WorkflowStatus.PENDING

    @classmethod
    def _recompute_workflow_status(cls, order: Order, *, actor=None) -> str:
        """Persist + log when the 10-state workflow status changes.
        Stamps not_answered_at the first time we enter not_answered.
        """
        new_ws = cls._derive_workflow_status(order)
        update_fields: list[str] = []
        if new_ws != order.workflow_status:
            old_ws = order.workflow_status
            order.workflow_status = new_ws
            update_fields.append('workflow_status')
        if (
            new_ws == Order.WorkflowStatus.NOT_ANSWERED
            and order.not_answered_at is None
        ):
            order.not_answered_at = timezone.now()
            update_fields.append('not_answered_at')
        if update_fields:
            update_fields.append('updated_at')
            order.save(update_fields=update_fields)
            if 'workflow_status' in update_fields:
                OrderLoggingService.log(
                    order=order,
                    action=OrderLog.Action.WORKFLOW_STATUS_CHANGED,
                    user=actor,
                    details={'old': old_ws, 'new': new_ws},
                )
        return new_ws

    # ── Transition matrix (validation gate for direct workflow changes) ──────

    _TRANSITIONS: dict[str, set[str]] = {
        'pending':          {'answered', 'not_answered', 'delayed', 'cancelled'},
        'not_answered':     {'answered', 'delayed', 'cancelled'},
        'delayed':          {'answered', 'not_answered', 'cancelled'},
        'answered':         {'sent_to_delivery', 'cancelled'},
        'sent_to_delivery': {'packaging', 'cancelled', 'retour'},
        'packaging':        {'done', 'retour', 'cancelled', 'changed'},
        'done':             {'retour', 'cancelled', 'changed'},
        'retour':           {'changed'},
        'changed':          {'done', 'retour', 'cancelled'},
        'cancelled':        {'pending'},  # admin reopen only
    }

    @classmethod
    def _assert_transition(cls, old: str, new: str, *, force: bool = False) -> None:
        if old == new:
            return
        allowed = cls._TRANSITIONS.get(old, set())
        if new in allowed:
            return
        if force:
            return
        raise LifecycleError(
            f'Invalid workflow transition: {old} → {new}. '
            f'Allowed: {sorted(allowed) or "(none)"}. Pass force=True to override.'
        )

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
        """Credit points to the client. Idempotent via loyalty_points_granted."""
        order = cls._lock(order)
        if order.loyalty_points_granted or not order.client_id:
            return order.loyalty_points_amount
        points = cls._compute_points(order)
        if points <= 0:
            return 0
        from apps.clients.models import Client
        client = Client.objects.select_for_update().get(pk=order.client_id)
        client.points = (client.points or 0) + points
        client.save(update_fields=['points', 'updated_at'])
        order.loyalty_points_granted = True
        order.loyalty_points_amount = points
        order.loyalty_points_granted_at = timezone.now()
        order.save(update_fields=[
            'loyalty_points_granted', 'loyalty_points_amount',
            'loyalty_points_granted_at', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order, action=OrderLog.Action.POINTS_GRANTED, user=actor,
            details={'client_id': client.id, 'points': points, 'total': str(order.total)},
        )
        return points

    @classmethod
    @transaction.atomic
    def reverse_loyalty_points(cls, order: Order, *, actor=None) -> int:
        """Subtract the previously-granted points. Idempotent."""
        order = cls._lock(order)
        if not order.loyalty_points_granted or not order.client_id:
            return 0
        points = order.loyalty_points_amount or 0
        if points > 0:
            from apps.clients.models import Client
            client = Client.objects.select_for_update().get(pk=order.client_id)
            client.points = max(0, (client.points or 0) - points)
            client.save(update_fields=['points', 'updated_at'])
        order.loyalty_points_granted = False
        order.save(update_fields=['loyalty_points_granted', 'updated_at'])
        OrderLoggingService.log(
            order=order, action=OrderLog.Action.POINTS_REVERSED, user=actor,
            details={'client_id': order.client_id, 'points': points},
        )
        return points

    @classmethod
    @transaction.atomic
    def mark_not_answered(cls, order: Order, *, actor=None, note: str = '') -> Order:
        """Record one unanswered client call attempt without confirming the order."""
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.outcome == Order.Outcome.CONFIRMED:
            raise LifecycleError('Confirmed orders cannot be marked as not answered.')
        if order.delivery_reference or order.delivery_status in cls._IN_FLIGHT_DELIVERY:
            raise LifecycleError('Order already entered fulfillment and cannot be marked not answered.')

        old_status = order.contact_status
        now = timezone.now()
        order.contact_status = Order.ContactStatus.NOT_ANSWERED
        order.not_answered_attempts = (order.not_answered_attempts or 0) + 1
        if not order.not_answered_at:
            order.not_answered_at = now
        order.outcome = Order.Outcome.NONE
        order.delay_date = None
        order.delay_reason = ''
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.save(update_fields=[
            'contact_status', 'not_answered_attempts', 'not_answered_at',
            'outcome', 'delay_date', 'delay_reason', 'outcome_note',
            'outcome_changed_at', 'outcome_changed_by', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.CONTACT_STATUS_CHANGED,
            user=actor,
            details={
                'old': old_status,
                'new': Order.ContactStatus.NOT_ANSWERED,
                'attempts': order.not_answered_attempts,
                'note': note,
            },
        )
        cls._recompute_workflow_status(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def restore_delayed(cls, order: Order, *, actor=None) -> Order:
        """Move a delayed order back to the first-call pending state."""
        order = cls._lock(order)
        cls._ensure_active(order)
        if not (
            order.outcome == Order.Outcome.DELAYED
            or order.contact_status == Order.ContactStatus.DELAYED
        ):
            raise LifecycleError('Only delayed orders can be restored to pending.')
        if order.delivery_reference or order.delivery_status in cls._IN_FLIGHT_DELIVERY:
            raise LifecycleError('Order already entered fulfillment and cannot be restored to pending.')

        old_outcome = order.outcome
        old_contact = order.contact_status
        order.outcome = Order.Outcome.NONE
        order.contact_status = Order.ContactStatus.NONE
        order.delay_date = None
        order.delay_reason = ''
        order.outcome_note = ''
        order.confirmed_at = None
        order.not_answered_at = None
        order.not_answered_attempts = 0
        order.outcome_changed_at = timezone.now()
        order.outcome_changed_by = actor
        order.save(update_fields=[
            'outcome', 'contact_status', 'delay_date', 'delay_reason',
            'outcome_note', 'confirmed_at', 'not_answered_at',
            'not_answered_attempts', 'outcome_changed_at',
            'outcome_changed_by', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.CONTACT_STATUS_CHANGED,
            user=actor,
            details={
                'event': 'restore_delayed',
                'old_outcome': old_outcome,
                'new_outcome': order.outcome,
                'old_contact_status': old_contact,
                'new_contact_status': order.contact_status,
            },
        )
        cls._recompute_outcome(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def confirm(cls, order: Order, *, actor=None, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.outcome == Order.Outcome.CONFIRMED:
            raise LifecycleError('Order is already confirmed.')

        now = timezone.now()
        order.outcome = Order.Outcome.CONFIRMED
        order.confirmed_at = now
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.delay_date = None
        order.delay_reason = ''
        order.cancellation_reason = ''
        order.contact_status = Order.ContactStatus.ANSWERED
        order.not_answered_attempts = 0
        order.not_answered_at = None
        order.save(update_fields=[
            'outcome', 'confirmed_at', 'outcome_note', 'outcome_changed_at',
            'outcome_changed_by', 'delay_date', 'delay_reason',
            'cancellation_reason', 'contact_status', 'not_answered_attempts',
            'not_answered_at', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.OUTCOME_CONFIRMED,
            user=actor,
            details={'note': note},
        )
        cls._recompute_outcome(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def delay(cls, order: Order, *, actor=None, delay_date, delay_reason: str, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if not delay_date:
            raise LifecycleError('Delay date is required for delayed orders.')
        if order.delivery_reference or order.delivery_status in (
            Order.DeliveryStatus.SUBMITTED,
            Order.DeliveryStatus.ACCEPTED,
            Order.DeliveryStatus.IN_TRANSIT,
            Order.DeliveryStatus.DELIVERED,
        ):
            raise LifecycleError('Order already entered delivery and cannot be delayed.')

        now = timezone.now()
        order.outcome = Order.Outcome.DELAYED
        order.delay_date = delay_date
        order.delay_reason = delay_reason
        order.contact_status = Order.ContactStatus.DELAYED
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.confirmed_at = None
        order.cancellation_reason = ''
        order.save(update_fields=[
            'outcome', 'delay_date', 'delay_reason', 'outcome_note',
            'contact_status', 'outcome_changed_at', 'outcome_changed_by', 'confirmed_at',
            'cancellation_reason', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.OUTCOME_DELAYED,
            user=actor,
            details={'delay_date': delay_date, 'delay_reason': delay_reason, 'note': note},
        )
        return order

    @classmethod
    @transaction.atomic
    def cancel(cls, order: Order, *, actor=None, reason: str, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        if order.delivery_status in (
            Order.DeliveryStatus.ACCEPTED,
            Order.DeliveryStatus.IN_TRANSIT,
            Order.DeliveryStatus.DELIVERED,
        ):
            raise LifecycleError('Order is already in delivery and cannot be cancelled here.')
        if order.outcome == Order.Outcome.CANCELLED and order.status == Order.Status.CANCELLED:
            raise LifecycleError('Order is already cancelled.')

        now = timezone.now()
        order.outcome = Order.Outcome.CANCELLED
        order.status = Order.Status.CANCELLED
        order.cancellation_reason = reason
        order.outcome_note = note or ''
        order.outcome_changed_at = now
        order.outcome_changed_by = actor
        order.confirmed_at = None
        order.delay_date = None
        order.delay_reason = ''
        order.save(update_fields=[
            'outcome', 'status', 'cancellation_reason', 'outcome_note',
            'outcome_changed_at', 'outcome_changed_by', 'confirmed_at',
            'delay_date', 'delay_reason', 'updated_at',
        ])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.OUTCOME_CANCELLED,
            user=actor,
            details={'cancellation_reason': reason, 'note': note},
        )
        cls._recompute_outcome(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def mark_in_store_pickup(cls, order: Order, *, actor=None, note: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.in_store_pickup:
            raise LifecycleError('Order is already marked as in-store pickup.')
        if order.outcome != Order.Outcome.CONFIRMED:
            raise LifecycleError('Order must be confirmed before pickup/POS flow.')

        order.in_store_pickup = True
        order.delivery_status = Order.DeliveryStatus.NONE
        if note:
            order.internal_note = f"{order.internal_note}\n[Pickup] {note}".strip()
        order.save(update_fields=['in_store_pickup', 'delivery_status', 'internal_note', 'updated_at'])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.STATUS_CHANGED,
            user=actor,
            details={'in_store_pickup': True, 'note': note},
        )
        cls._recompute_workflow_status(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def send_to_pos(cls, order: Order, *, pos_sales_channel: SalesChannel, actor=None) -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        cls._ensure_not_cancelled(order)
        if order.outcome != Order.Outcome.CONFIRMED:
            raise LifecycleError('Order must be confirmed before sending to POS.')
        if order.delivery_reference or order.delivery_status in (
            Order.DeliveryStatus.QUEUED,
            Order.DeliveryStatus.SUBMITTED,
            Order.DeliveryStatus.ACCEPTED,
            Order.DeliveryStatus.IN_TRANSIT,
            Order.DeliveryStatus.DELIVERED,
        ):
            raise LifecycleError('Order has already entered delivery and cannot be sent to POS.')
        if order.sent_to_pos_at:
            raise LifecycleError('Order has already been sent to POS.')
        if pos_sales_channel.channel_type != SalesChannel.ChannelType.POS:
            raise LifecycleError('Selected destination must be a POS sales channel.')
        if not pos_sales_channel.is_active:
            raise LifecycleError('Selected POS location is inactive.')
        if pos_sales_channel.brand_id != order.sales_channel.brand_id:
            raise LifecycleError('Selected POS location must belong to the same brand as this order.')

        order.in_store_pickup = True
        order.pos_sales_channel = pos_sales_channel
        order.delivery_status = Order.DeliveryStatus.NONE
        order.sent_to_pos_at = timezone.now()
        order.sent_to_pos_by = actor
        order.save(update_fields=[
            'in_store_pickup', 'pos_sales_channel', 'delivery_status',
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
        cls._recompute_workflow_status(order, actor=actor)
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
        order.status = Order.Status.COMPLETED
        if payment_method:
            order.payment_method = payment_method
        order.payment_status = Order.PaymentStatus.PAID
        if customer_note:
            order.customer_note = customer_note
        order.save(update_fields=[
            'pos_validated_at', 'pos_validated_by', 'status',
            'payment_method', 'payment_status', 'customer_note', 'updated_at',
        ])

        from apps.orders.service import OrderIngestionError, OrderIngestionService

        inventory_channel = order.pos_sales_channel or order.sales_channel
        lines = list(order.lines.filter(is_deleted=False).select_related('product'))
        # Packaging-type items are owned by package_order(); refuse to validate
        # a POS pickup that has packaging lines, so we cannot accidentally
        # reintroduce the "packaging marks order done" path.
        for line in lines:
            if line.product and line.product.product_type == Product.ProductType.PACKAGING:
                raise LifecycleError(
                    'POS validation cannot include packaging-type items. '
                    'Use the packaging endpoint to add packaging.'
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
        cls._recompute_outcome(order, actor=actor)
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
                product__product_type=Product.ProductType.PACKAGING,
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
            if product.product_type != Product.ProductType.PACKAGING:
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
        if order.returned_at or order.delivery_status in (
            Order.DeliveryStatus.RETURNED,
            Order.DeliveryStatus.CANCELLED,
            Order.DeliveryStatus.DELIVERED,
        ):
            raise LifecycleError(
                'Packaging is blocked for returned, cancelled, or already delivered orders.'
            )

        if not (order.delivery_code or order.delivery_reference or order.in_store_pickup):
            raise LifecycleError(
                'Packaging requires a delivery code or in-store pickup flag. '
                'Send the order to delivery (or POS) first.'
            )
        if (
            order.packaging_status == Order.PackagingStatus.PACKAGED
            and not allow_update
        ):
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
            if product.product_type != Product.ProductType.PACKAGING:
                raise LifecycleError(
                    f'Product "{product.name}" is not a packaging item.'
                )

        # Replace existing packaging-type OrderLine rows with the new set.
        # Customer (non-packaging) lines are untouched.
        existing_lines = list(
            order.lines.filter(
                is_deleted=False,
                product__product_type=Product.ProductType.PACKAGING,
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

        is_update = order.packaging_status == Order.PackagingStatus.PACKAGED
        order.packaging_status = (
            Order.PackagingStatus.UPDATED if is_update else Order.PackagingStatus.PACKAGED
        )
        if not order.packaged_at:
            order.packaged_at = timezone.now()
        order.packaged_by = actor
        order.status = Order.Status.COMPLETED
        order.final_outcome = Order.FinalOutcome.SUCCESSFUL_SALE
        order.save(update_fields=[
            'packaging_status', 'packaged_at', 'packaged_by',
            'status', 'final_outcome', 'updated_at',
        ])

        OrderLoggingService.log(
            order=order,
            action=(
                OrderLog.Action.PACKAGING_UPDATED if is_update else OrderLog.Action.PACKAGED
            ),
            user=actor,
            details={'items': [{'product_id': p, 'quantity': q} for p, q in desired.items()],
                     'movements': movements},
        )
        cls._recompute_workflow_status(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def unpackage_order(cls, order: Order, *, actor=None) -> Order:
        """Reverse all packaging deductions and reset packaging_status."""
        order = cls._lock(order)
        cls._ensure_active(order)
        if order.packaging_status == Order.PackagingStatus.NOT_PACKAGED:
            raise LifecycleError('Order has no packaging to reverse.')

        # Reverse stock by passing desired={} → every previously-moved product
        # becomes a RETURN_IN movement.
        movements = cls._apply_packaging_stock(order, desired={}, actor=actor)

        # Soft-delete packaging lines
        order.lines.filter(
            is_deleted=False,
            product__product_type=Product.ProductType.PACKAGING,
        ).update(is_deleted=True)

        order.packaging_status = Order.PackagingStatus.NOT_PACKAGED
        order.packaged_at = None
        order.packaged_by = None
        if order.final_outcome == Order.FinalOutcome.SUCCESSFUL_SALE and order.delivery_status != Order.DeliveryStatus.DELIVERED:
            order.final_outcome = Order.FinalOutcome.NONE
        if order.status == Order.Status.COMPLETED and order.source != Order.Source.POS:
            order.status = Order.Status.PROCESSING
        order.save(update_fields=[
            'packaging_status', 'packaged_at', 'packaged_by',
            'final_outcome', 'status', 'updated_at',
        ])

        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.PACKAGING_REVERSED,
            user=actor,
            details={'movements': movements},
        )
        cls._recompute_workflow_status(order, actor=actor)
        return order

    @classmethod
    def submit_delivery(cls, order: Order, *, actor=None) -> dict:
        with transaction.atomic():
            locked = cls._lock(order)
            cls._ensure_active(locked)
            cls._ensure_not_cancelled(locked)
            if locked.in_store_pickup:
                raise LifecycleError('In-store pickup orders must go through POS, not delivery.')
            if locked.outcome != Order.Outcome.CONFIRMED:
                raise LifecycleError('Order must be confirmed before delivery submission.')
            if locked.delivery_reference:
                raise LifecycleError('Order has already been sent to delivery.')
            if not locked.can_submit_delivery:
                raise LifecycleError(
                    f'Order is not eligible for delivery submission '
                    f'(status={locked.status}, delivery_status={locked.delivery_status}).'
                )

        service = DeliverySubmissionService()
        result = service.submit(order, actor=actor)
        Order.all_objects.filter(pk=order.pk, delivery_submitted_by__isnull=True).update(
            delivery_submitted_by=actor,
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
        if order.returned_at:
            raise LifecycleError('Order return has already been processed.')
        if order.delivery_status not in (
            Order.DeliveryStatus.DELIVERED,
            Order.DeliveryStatus.RETURNED,
            Order.DeliveryStatus.SUBMITTED,
            Order.DeliveryStatus.ACCEPTED,
            Order.DeliveryStatus.IN_TRANSIT,
        ) and not order.pos_validated_at:
            raise LifecycleError('Only delivered/POS-validated orders can be returned.')

        resolved_return_type = (return_type or Order.ReturnType.RETURNED) or Order.ReturnType.RETURNED
        if resolved_return_type not in dict(Order.ReturnType.choices):
            raise LifecycleError(f'Invalid return_type: {return_type}')

        order.delivery_status = Order.DeliveryStatus.RETURNED
        order.status = Order.Status.REFUNDED
        order.returned_at = timezone.now()
        order.returned_by = actor
        order.return_reason = reason or ''
        order.return_type = resolved_return_type
        order.return_exchange_status = (
            Order.ReturnExchangeStatus.EXCHANGED
            if resolved_return_type == Order.ReturnType.EXCHANGED
            else Order.ReturnExchangeStatus.RETURNED
        )
        order.save(update_fields=[
            'delivery_status', 'status', 'returned_at', 'returned_by',
            'return_reason', 'return_type', 'return_exchange_status', 'updated_at',
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

        cls._recompute_outcome(order, actor=actor)
        # If this order had loyalty points granted (it was a successful sale
        # before the return), reverse them so the customer's points reflect
        # only kept-and-paid orders.
        if order.loyalty_points_granted:
            try:
                cls.reverse_loyalty_points(order, actor=actor)
            except Exception:
                pass  # non-fatal
        return order

    @classmethod
    def _apply_structured_return_conditions(
        cls, order: Order, line_conditions: list[dict], *, actor,
    ) -> None:
        """Apply the per-line stock-movement matrix for a structured return.
        Each entry: {line_id, condition, replacement_product_id?}.
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
                inv_product_ids.add(line.product_id)
        inv_product_ids |= replacement_ids
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
            line.return_condition = condition
            update_fields = ['return_condition']

            inventory = inventories.get(line.product_id)
            qty = line.quantity

            if condition == line.ReturnCondition.GOOD:
                if inventory:
                    before = inventory.quantity
                    after = before + qty
                    InventoryMovement.objects.create(
                        sales_channel=sales_channel,
                        product=line.product,
                        movement_type=InventoryMovement.MovementType.RETURN_IN,
                        status=InventoryMovement.MovementStatus.COMPLETED,
                        quantity=qty,
                        quantity_before=before,
                        quantity_after=after,
                        external_reference=order.order_number,
                        notes=f"Return GOOD for order {order.order_number}",
                        created_by=actor,
                        completed_at=timezone.now(),
                    )
                    inventory.quantity = after
                restored.append({'line_id': line.id, 'action': 'return_in', 'quantity': qty})

            elif condition == line.ReturnCondition.DAMAGED:
                # Record a DAMAGE movement (audit trail) without restoring to available stock.
                if inventory:
                    InventoryMovement.objects.create(
                        sales_channel=sales_channel,
                        product=line.product,
                        movement_type=InventoryMovement.MovementType.DAMAGE,
                        status=InventoryMovement.MovementStatus.COMPLETED,
                        quantity=qty,
                        quantity_before=inventory.quantity,
                        quantity_after=inventory.quantity,
                        external_reference=order.order_number,
                        notes=f"Return DAMAGED for order {order.order_number}",
                        created_by=actor,
                        completed_at=timezone.now(),
                    )
                OrderLoggingService.log(
                    order=order,
                    action=OrderLog.Action.DAMAGED_STOCK_RECORDED,
                    user=actor,
                    details={'line_id': line.id, 'product_id': line.product_id, 'quantity': qty},
                )
                restored.append({'line_id': line.id, 'action': 'damage', 'quantity': qty})

            elif condition == line.ReturnCondition.MISSING:
                # No stock movement, but log it explicitly so the audit shows the loss.
                restored.append({'line_id': line.id, 'action': 'missing_no_movement', 'quantity': qty})

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

                # 1) RETURN_IN for the original product
                if inventory:
                    before = inventory.quantity
                    after = before + qty
                    InventoryMovement.objects.create(
                        sales_channel=sales_channel,
                        product=line.product,
                        movement_type=InventoryMovement.MovementType.RETURN_IN,
                        status=InventoryMovement.MovementStatus.COMPLETED,
                        quantity=qty,
                        quantity_before=before,
                        quantity_after=after,
                        external_reference=order.order_number,
                        notes=f"Exchange return-in for order {order.order_number}",
                        created_by=actor,
                        completed_at=timezone.now(),
                    )
                    inventory.quantity = after
                # 2) SALE for the replacement product
                rep_inv = inventories.get(rep.id)
                if not rep_inv or rep_inv.available_quantity < qty:
                    available = rep_inv.available_quantity if rep_inv else 0
                    raise LifecycleError(
                        f'Insufficient stock for replacement "{rep.name}". '
                        f'Required: {qty}, available: {available}.'
                    )
                before_rep = rep_inv.quantity
                after_rep = before_rep - qty
                InventoryMovement.objects.create(
                    sales_channel=sales_channel,
                    product=rep,
                    movement_type=InventoryMovement.MovementType.SALE,
                    status=InventoryMovement.MovementStatus.COMPLETED,
                    quantity=qty,
                    quantity_before=before_rep,
                    quantity_after=after_rep,
                    external_reference=order.order_number,
                    notes=f"Exchange replacement-out for order {order.order_number}",
                    created_by=actor,
                    completed_at=timezone.now(),
                )
                rep_inv.quantity = after_rep
                OrderLoggingService.log(
                    order=order,
                    action=OrderLog.Action.REPLACEMENT_DEDUCTED,
                    user=actor,
                    details={
                        'line_id': line.id,
                        'replacement_product_id': rep.id,
                        'quantity': qty,
                    },
                )
                restored.append({
                    'line_id': line.id,
                    'action': 'exchange',
                    'quantity': qty,
                    'replacement_product_id': rep.id,
                })

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
    def mark_exchanged(cls, order: Order, *, actor=None, reason: str = '') -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        if order.return_exchange_status == Order.ReturnExchangeStatus.EXCHANGED:
            raise LifecycleError('Order is already marked as exchanged.')
        order.return_exchange_status = Order.ReturnExchangeStatus.EXCHANGED
        if reason:
            order.return_reason = reason
        order.save(update_fields=['return_exchange_status', 'return_reason', 'updated_at'])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.RETURN_EXCHANGE_CHANGED,
            user=actor,
            details={'old': Order.ReturnExchangeStatus.NONE, 'new': Order.ReturnExchangeStatus.EXCHANGED, 'reason': reason},
        )
        cls._recompute_outcome(order, actor=actor)
        return order

    @classmethod
    @transaction.atomic
    def restore_stock_from_return(cls, order: Order, *, actor=None) -> Order:
        order = cls._lock(order)
        cls._ensure_active(order)
        if not order.returned_at and order.delivery_status != Order.DeliveryStatus.RETURNED:
            raise LifecycleError('Order must be marked as returned before stock restoration.')
        cls._restore_stock_locked(order, actor=actor)
        cls._recompute_outcome(order, actor=actor)
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
                product__product_type=Product.ProductType.PACKAGING,
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
        products = {p.id: p for p in Product.objects.filter(id__in=restore_ids)}

        restored = []
        for product_id in restore_ids:
            qty = net_by_product[product_id]
            product = products.get(product_id)
            if not product:
                continue
            inventory = inventories.get(product_id)
            before = inventory.quantity if inventory else 0
            InventoryMovement.objects.create(
                sales_channel=stock_channel,
                product=product,
                movement_type=InventoryMovement.MovementType.RETURN_IN,
                status=InventoryMovement.MovementStatus.COMPLETED,
                quantity=qty,
                quantity_before=before,
                quantity_after=before + qty,
                external_reference=order.order_number,
                notes=f"Stock restored from returned order {order.order_number}",
                created_by=actor,
                completed_at=timezone.now(),
            )
            restored.append({'product_id': product_id, 'quantity': qty})

        order.stock_restored_at = timezone.now()
        order.stock_restored_by = actor
        order.save(update_fields=['stock_restored_at', 'stock_restored_by', 'updated_at'])
        OrderLoggingService.log(
            order=order,
            action=OrderLog.Action.STOCK_RESTORED,
            user=actor,
            details={'items': restored},
        )
