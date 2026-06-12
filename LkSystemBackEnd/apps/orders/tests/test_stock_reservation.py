"""
Tests for stock reservation at order confirm.

An online (WooCommerce / manual-delivery) order reserves its stock when it is
confirmed: ``SalesChannelInventory.reserved_quantity`` goes up so
``available_quantity`` drops immediately, which blocks the POS (and any other
order) from selling the same units. The reservation is released when the order
completes (the SALE supersedes it) or is cancelled. Confirming is blocked when
the stock is no longer available.

Run with::

    python manage.py test apps.orders.tests.test_stock_reservation
"""

from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.delivery_service import DeliverySubmissionService
from apps.orders.lifecycle_service import LifecycleError, OrderLifecycleService
from apps.orders.models import Order, OrderLine
from apps.orders.order_management_service import OrderManagementService
from apps.orders.service import OrderIngestionError, OrderIngestionService
from apps.orders.stock_service import OrderStockReservationService
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel

User = get_user_model()


class StockReservationTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Co', abbreviation='CO')
        self.brand = Brand.objects.create(company=self.company, name='Br')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='Woo', code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.product = Product.objects.create(
            brand=self.brand, name='P1', barcode='P1',
            product_type=Product.ProductType.RESELL_PRODUCT, sales_price='100.00',
        )
        self.actor = User.objects.create_user(matricule='U1', email='u1@x.com', password='x')
        self.inv = SalesChannelInventory.objects.create(
            sales_channel=self.channel, product=self.product, quantity=8,
        )

    def _online_order(self, qty=2):
        order = Order.objects.create(
            company=self.company, sales_channel=self.channel, brand=self.brand,
            order_number=f'ORD-{qty}-{Order.objects.count()}',
            external_order_id=f'9{qty}{Order.objects.count()}',
            source=Order.Source.WOOCOMMERCE,
            status=Order.Status.NEW,
            billing_first_name='T', billing_last_name='C', billing_phone='+21620000000',
            total=Decimal('100.00') * qty,
        )
        OrderLine.objects.create(
            order=order, product=self.product, product_name=self.product.name,
            barcode=self.product.barcode, is_linked=True, quantity=qty,
            unit_price=Decimal('100.00'),
            subtotal=Decimal('100.00') * qty, total=Decimal('100.00') * qty,
        )
        return order

    def _confirm_and_reserve(self, order, *, force=False):
        """Mirror the live flow: confirm is a plain status move, then stock is
        reserved when the order is sent for fulfilment (delivery). We reserve
        directly to avoid the external delivery API."""
        OrderLifecycleService.confirm(order, actor=self.actor)
        OrderStockReservationService.reserve(order, actor=self.actor, force=force)
        order.refresh_from_db()
        return order

    # ── reserve on confirm ──────────────────────────────────────────────
    def test_confirm_is_a_plain_status_move_without_reservation(self):
        """Confirming no longer touches stock — it's a simple status move. Stock
        is reserved later, when the order is sent for fulfilment (delivery)."""
        order = self._online_order(qty=2)
        OrderLifecycleService.confirm(order, actor=self.actor)
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CONFIRMED)
        self.assertFalse(order.stock_reserved)            # nothing reserved
        self.assertEqual(self.inv.reserved_quantity, 0)
        self.assertEqual(self.inv.available_quantity, 8)  # untouched

    def test_reserve_drops_available_and_records_movement(self):
        """Reserving (done when the order is sent to delivery) holds the stock:
        reserved goes up, available drops, on-hand is unchanged, ledger entry."""
        order = self._confirm_and_reserve(self._online_order(qty=2))
        self.inv.refresh_from_db()
        self.assertTrue(order.stock_reserved)
        self.assertEqual(self.inv.quantity, 8)            # on-hand unchanged
        self.assertEqual(self.inv.reserved_quantity, 2)   # reserved
        self.assertEqual(self.inv.available_quantity, 6)  # available dropped
        mv = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            movement_type=InventoryMovement.MovementType.RESERVATION,
        ).first()
        self.assertIsNotNone(mv)
        self.assertEqual(mv.quantity, 2)
        self.assertEqual(mv.quantity_before, mv.quantity_after)  # on-hand untouched

    def test_reservation_blocks_another_sale_on_channel(self):
        """After an order reserves 2 of 8, only 6 are available — a second sale
        for 7 of the same product on the same channel is blocked."""
        self._confirm_and_reserve(self._online_order(qty=2))
        other = self._online_order(qty=7)
        other.status = Order.Status.DONE
        with self.assertRaises(OrderIngestionError):
            OrderIngestionService._sync_inventory_movements(
                other, list(other.lines.all()), self.channel, self.actor,
            )

    def test_confirm_succeeds_even_when_stock_unavailable(self):
        """Confirm is a plain status move, so a stock shortage no longer blocks
        it — the shortfall only surfaces later, at the reserve/delivery step."""
        self.inv.reserved_quantity = 7   # only 1 available
        self.inv.save(update_fields=['reserved_quantity'])
        order = self._online_order(qty=2)
        OrderLifecycleService.confirm(order, actor=self.actor)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CONFIRMED)
        self.assertFalse(order.stock_reserved)

    def test_reserve_blocked_when_stock_unavailable(self):
        """Reserving (at delivery) without force is rejected if the stock is
        gone, so the UI shows the missing-stock warning."""
        self.inv.reserved_quantity = 7   # only 1 available
        self.inv.save(update_fields=['reserved_quantity'])
        order = self._online_order(qty=2)
        OrderLifecycleService.confirm(order, actor=self.actor)
        with self.assertRaises(LifecycleError):
            OrderStockReservationService.reserve(order, actor=self.actor)
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertFalse(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 7)   # unchanged (rolled back)

    def test_force_reserve_backorders_when_stock_unavailable(self):
        """force=True (operator acknowledged the warning at delivery) reserves
        anyway as a backorder: reserved exceeds on-hand, available floors at 0."""
        self.inv.reserved_quantity = 7   # only 1 available, order needs 2
        self.inv.save(update_fields=['reserved_quantity'])
        order = self._confirm_and_reserve(self._online_order(qty=2), force=True)
        self.inv.refresh_from_db()
        self.assertTrue(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 9)   # 7 + 2 reserved
        self.assertEqual(self.inv.available_quantity, 0)  # backorder
        mv = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            movement_type=InventoryMovement.MovementType.RESERVATION,
        ).first()
        self.assertIsNotNone(mv)
        self.assertIn('BACKORDER', mv.notes)

    @patch('apps.orders.lifecycle_service.DeliverySubmissionService.submit', return_value={'ok': True})
    def test_submit_delivery_reserves_stock(self, _mock_submit):
        """Integration: confirm leaves stock untouched; sending the order to the
        delivery API reserves it."""
        order = self._online_order(qty=2)
        OrderLifecycleService.confirm(order, actor=self.actor)
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertFalse(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 0)

        OrderLifecycleService.submit_delivery(order, actor=self.actor)
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertTrue(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 2)
        self.assertEqual(self.inv.available_quantity, 6)

    def test_editing_reserved_order_replaces_reserved_quantity(self):
        order = self._confirm_and_reserve(self._online_order(qty=2))
        line = order.lines.get()

        OrderManagementService.edit_order(
            order=order,
            actor=self.actor,
            data={
                'lines': [{
                    'id': line.id,
                    'product': self.product.id,
                    'product_name': self.product.name,
                    'barcode': self.product.barcode,
                    'quantity': 3,
                    'unit_price': Decimal('100.00'),
                }],
            },
        )

        order.refresh_from_db()
        line.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertTrue(order.stock_reserved)
        self.assertEqual(line.quantity, 3)
        self.assertEqual(self.inv.reserved_quantity, 3)
        self.assertEqual(self.inv.available_quantity, 5)

    def test_reserved_order_edit_beyond_stock_backorders(self):
        """An already-confirmed order is committed, so editing it beyond available
        stock no longer hard-fails — it re-reserves best-effort (a backorder, with
        available going negative), mirroring a force-confirmed order."""
        order = self._confirm_and_reserve(self._online_order(qty=2))
        line = order.lines.get()

        OrderManagementService.edit_order(
            order=order,
            actor=self.actor,
            data={
                'lines': [{
                    'id': line.id,
                    'product': self.product.id,
                    'product_name': self.product.name,
                    'barcode': self.product.barcode,
                    'quantity': 9,
                    'unit_price': Decimal('100.00'),
                }],
            },
        )

        order.refresh_from_db()
        line.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertTrue(order.stock_reserved)
        self.assertEqual(line.quantity, 9)
        self.assertEqual(self.inv.reserved_quantity, 9)
        # On-hand is 8; reserving 9 backorders — available floors at 0.
        self.assertEqual(self.inv.available_quantity, 0)

    # ── release on completion / cancel ──────────────────────────────────
    def test_completion_releases_reservation_and_decrements(self):
        order = self._confirm_and_reserve(self._online_order(qty=2))
        DeliverySubmissionService().update_from_provider(order, 'delivered', actor=self.actor)
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertFalse(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 0)   # reservation released
        self.assertEqual(self.inv.quantity, 6)            # on-hand decremented (sold)
        self.assertEqual(self.inv.available_quantity, 6)  # consistent through transition

    def test_packaging_converts_reservation_into_sale(self):
        """Packaging is the 'done' step in this workflow: it must release the
        reservation AND decrement on-hand (the real sale) — not leave the stock
        reserved forever with no sale."""
        order = self._confirm_and_reserve(self._online_order(qty=2))
        self.inv.refresh_from_db()
        self.assertTrue(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 2)
        self.assertEqual(self.inv.quantity, 8)

        # Packaging needs a parcel reference + a packaging-type product.
        order.in_store_pickup = True
        order.save(update_fields=['in_store_pickup'])
        box = Product.objects.create(
            brand=self.brand, name='Box', barcode='BOX-1',
            product_type=Product.ProductType.PACKAGING_ITEM, sales_price='0.00',
        )
        SalesChannelInventory.objects.create(
            sales_channel=self.channel, product=box, quantity=50,
        )

        OrderLifecycleService.package_order(
            order, actor=self.actor,
            packaging_items=[{'product_id': box.id, 'quantity': 1}],
        )
        order.refresh_from_db()
        self.inv.refresh_from_db()
        # Reservation released and the customer product actually sold (on-hand -2).
        self.assertFalse(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 0)
        self.assertEqual(self.inv.quantity, 6)
        self.assertEqual(self.inv.available_quantity, 6)
        self.assertTrue(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                movement_type=InventoryMovement.MovementType.SALE,
                product=self.product,
            ).exists()
        )

    def test_cancel_releases_reservation(self):
        order = self._confirm_and_reserve(self._online_order(qty=2))
        OrderLifecycleService.cancel(order, actor=self.actor, reason='changed mind')
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertFalse(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 0)   # back to available
        self.assertEqual(self.inv.quantity, 8)
        self.assertEqual(self.inv.available_quantity, 8)
        self.assertTrue(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                movement_type=InventoryMovement.MovementType.RELEASE,
            ).exists()
        )

    # ── idempotency ─────────────────────────────────────────────────────
    def test_reserve_release_are_idempotent(self):
        order = self._online_order(qty=2)
        OrderStockReservationService.reserve(order)
        OrderStockReservationService.reserve(order)  # second reserve is a no-op
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.reserved_quantity, 2)
        OrderStockReservationService.release(order)
        OrderStockReservationService.release(order)   # second release is a no-op
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.reserved_quantity, 0)

    def test_pos_source_does_not_reserve(self):
        order = self._online_order(qty=2)
        order.source = Order.Source.POS
        order.save(update_fields=['source'])
        OrderStockReservationService.reserve(order)
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertFalse(order.stock_reserved)
        self.assertEqual(self.inv.reserved_quantity, 0)
