"""
Regression tests for the order/stock oversell fixes (code-review HIGH findings).

Fix #1 — the InventoryMovement signal applies each movement's RECORDED delta
(quantity_after - quantity_before) exactly once: it must never silently drop a
decrement just because a stale ``quantity_after`` happens to equal live stock,
and it must NOT change stock for a log-only movement (before == after).

Fix #2 — a website order marked DELIVERED by the provider must decrement its
lines (previously it changed status to COMPLETED without ever moving stock →
systematic oversell), and the reconciliation is idempotent.

Run with::

    python manage.py test apps.orders.tests.test_stock_oversell_fixes
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.delivery_service import DeliverySubmissionService
from apps.orders.models import Order, OrderLine
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel

User = get_user_model()


class _Base(TestCase):
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
        self.actor = User.objects.create_user(
            matricule='U1', email='u1@x.com', password='x',
        )
        self.inv = SalesChannelInventory.objects.create(
            sales_channel=self.channel, product=self.product, quantity=8,
        )


class InventoryMovementSignalTests(_Base):
    def _movement(self, *, qty, before, after,
                  mtype=InventoryMovement.MovementType.SALE,
                  status=InventoryMovement.MovementStatus.COMPLETED):
        return InventoryMovement.objects.create(
            sales_channel=self.channel, product=self.product,
            movement_type=mtype, status=status,
            quantity=qty, quantity_before=before, quantity_after=after,
        )

    def test_applies_recorded_delta_even_when_after_equals_live_stock(self):
        """A SALE recorded against a STALE before=10 (live is 8) must still apply
        its -2 delta. The old value-guard saw store.quantity(8)==after(8) and
        silently dropped it → oversell."""
        self._movement(qty=2, before=10, after=8)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.quantity, 6)

    def test_log_only_movement_does_not_change_stock(self):
        """A write-off recording before == after must NOT move on-hand."""
        self._movement(qty=2, before=8, after=8)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.quantity, 8)

    def test_restock_applies_recorded_delta(self):
        self._movement(qty=3, before=8, after=11,
                       mtype=InventoryMovement.MovementType.RETURN_IN)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.quantity, 11)

    def test_delta_applied_once_on_completion_only(self):
        mv = self._movement(qty=2, before=8, after=6,
                            status=InventoryMovement.MovementStatus.PENDING)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.quantity, 8)  # pending → not applied
        mv.status = InventoryMovement.MovementStatus.COMPLETED
        mv.save()
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.quantity, 6)  # applied once
        mv.notes = 'touch'
        mv.save(update_fields=['notes'])  # re-save while COMPLETED
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.quantity, 6)  # not double-applied


class DeliveryDecrementTests(_Base):
    def _website_order(self):
        order = Order.objects.create(
            company=self.company, sales_channel=self.channel, brand=self.brand,
            order_number='ORD-DEL-1', external_order_id='9001',
            status=Order.Status.PROCESSING, outcome=Order.Outcome.CONFIRMED,
            delivery_status=Order.DeliveryStatus.SUBMITTED,
            billing_first_name='T', billing_last_name='C', billing_phone='+21620000000',
            total=Decimal('200.00'),
        )
        OrderLine.objects.create(
            order=order, product=self.product, product_name=self.product.name,
            barcode=self.product.barcode, quantity=2, unit_price=Decimal('100.00'),
            subtotal=Decimal('200.00'), total=Decimal('200.00'),
        )
        return order

    def test_delivered_decrements_stock(self):
        order = self._website_order()
        DeliverySubmissionService().update_from_provider(order, 'delivered', actor=self.actor)
        order.refresh_from_db()
        self.inv.refresh_from_db()
        self.assertEqual(order.status, Order.Status.COMPLETED)
        self.assertEqual(self.inv.quantity, 6)  # 8 - 2; previously never decremented
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                movement_type=InventoryMovement.MovementType.SALE,
            ).count(),
            1,
        )

    def test_delivery_decrement_is_idempotent(self):
        order = self._website_order()
        svc = DeliverySubmissionService()
        svc.update_from_provider(order, 'delivered', actor=self.actor)
        # Re-running the reconciliation must not double-decrement.
        from apps.orders.service import OrderIngestionService
        OrderIngestionService._sync_inventory_movements(
            order, list(order.lines.all()), self.channel, self.actor,
        )
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.quantity, 6)


class ServerPricingTests(_Base):
    """POS/manual lines are priced by the SERVER from the catalogue (sales_price
    = 100 here); WooCommerce imports keep the price the customer was charged."""

    def setUp(self):
        super().setUp()
        from apps.orders.service import OrderIngestionService
        self.service = OrderIngestionService()
        self.product.wc_product_id = 555
        self.product.save(update_fields=['wc_product_id'])

    def _payload(self, *, price, qty=1, order_id=7777, status='completed'):
        return {
            'id': order_id, 'number': str(order_id), 'status': status,
            'billing': {'first_name': 'T', 'last_name': 'C',
                        'email': f'c{order_id}@x.com'},
            'line_items': [{
                'id': 1, 'product_id': self.product.wc_product_id,
                'name': self.product.name, 'sku': self.product.barcode,
                'quantity': qty, 'price': str(price),
                'subtotal': str(price), 'total': str(price), 'total_tax': '0',
            }],
        }

    def test_manual_underpriced_line_is_rejected(self):
        from apps.orders.service import OrderIngestionError
        with self.assertRaises(OrderIngestionError):
            self.service.ingest(self._payload(price='1.00'), self.channel,
                                source=Order.Source.MANUAL)

    def test_manual_line_uses_catalogue_price_not_inflated_client_price(self):
        order, _ = self.service.ingest(self._payload(price='999.00'), self.channel,
                                       source=Order.Source.MANUAL)
        self.assertEqual(order.lines.get().unit_price, Decimal('100.00'))

    def test_woocommerce_import_keeps_client_price(self):
        order, _ = self.service.ingest(self._payload(price='37.50'), self.channel,
                                       source=Order.Source.WOOCOMMERCE)
        self.assertEqual(order.lines.get().unit_price, Decimal('37.50'))
