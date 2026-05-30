"""
Inventory reconciliation tests for ``OrderIngestionService``.

These exercise the stock-movement engine (``_sync_inventory_movements``),
which fires when an order reaches the local ``COMPLETED`` status. That happens
immediately for **immediate-sale** sources (POS / manual entry), whose payload
status maps straight to the local status.

A WooCommerce *import* is deliberately different: it lands as operationally
``PENDING`` (see the "status separation" rule in ``OrderIngestionService.
_map_order_fields``) and defers any stock commitment to the fulfilment
lifecycle, so the call centre can confirm/cancel before stock is touched. That
deferral is asserted separately in
``test_woocommerce_import_defers_stock_to_lifecycle`` here, and end-to-end in
``apps.orders.tests.test_lifecycle_service``.

The engine itself is source-agnostic, so we drive it with ``MANUAL`` completed
sales to test its contract in isolation: idempotency, delta adjustment,
reversal on cancellation, and the insufficient-stock guard.

Run with::

    python manage.py test apps.orders.tests.test_inventory_reconciliation
"""

from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.models import Order
from apps.orders.service import OrderIngestionError, OrderIngestionService
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class OrderInventoryReconciliationTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Test Company', abbreviation='TST')
        self.brand = Brand.objects.create(company=self.company, name='Test Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Main Warehouse',
            code='WH',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.product = Product.objects.create(
            brand=self.brand,
            name='Finished Perfume',
            wc_product_id=101,
            barcode='PERF-101',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='100.00',
        )
        self.inventory = SalesChannelInventory.objects.create(
            sales_channel=self.channel,
            product=self.product,
            quantity=10,
        )
        self.service = OrderIngestionService()

    def payload(self, *, status='completed', quantity=2, order_id=5001):
        return {
            'id': order_id,
            'order_key': f'wc_order_{order_id}',
            'number': str(order_id),
            'status': status,
            'currency': 'TND',
            'billing': {
                'first_name': 'Test',
                'last_name': 'Client',
                'email': f'client-{order_id}@example.com',
            },
            'line_items': [
                {
                    'product_id': self.product.wc_product_id,
                    'name': self.product.name,
                    'sku': self.product.barcode,
                    'quantity': quantity,
                    'price': '100.00',
                    'subtotal': str(quantity * 100),
                    'total': str(quantity * 100),
                    'total_tax': '0',
                }
            ],
        }

    def ingest_sale(self, *, source=Order.Source.MANUAL, **payload_kwargs):
        """Ingest one immediate-sale order.

        ``MANUAL`` (and ``POS``) map the payload status straight to the local
        status, so a ``completed`` sale reaches the reconciliation engine — the
        path under test here. (A ``WOOCOMMERCE`` import would land as ``PENDING``
        and skip the engine; that deferral is covered by its own test.)
        """
        return self.service.ingest(self.payload(**payload_kwargs), self.channel, source=source)

    def refresh_inventory(self):
        self.inventory.refresh_from_db()
        return self.inventory

    def test_completed_order_sync_is_idempotent(self):
        self.ingest_sale(quantity=2)
        self.assertEqual(self.refresh_inventory().quantity, 8)

        self.ingest_sale(quantity=2)

        self.assertEqual(self.refresh_inventory().quantity, 8)
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference__startswith='ORD-',
                movement_type=InventoryMovement.MovementType.SALE,
            ).count(),
            1,
        )

    def test_order_quantity_update_adjusts_only_delta(self):
        self.ingest_sale(quantity=2)
        self.ingest_sale(quantity=4)

        self.assertEqual(self.refresh_inventory().quantity, 6)
        self.assertEqual(
            InventoryMovement.objects.filter(
                movement_type=InventoryMovement.MovementType.SALE,
            ).count(),
            2,
        )

    def test_cancelled_order_reverses_previous_sale_movement(self):
        self.ingest_sale(quantity=3)
        self.assertEqual(self.refresh_inventory().quantity, 7)

        self.ingest_sale(status='cancelled', quantity=3)

        self.assertEqual(self.refresh_inventory().quantity, 10)
        self.assertEqual(
            InventoryMovement.objects.filter(
                movement_type=InventoryMovement.MovementType.RETURN_IN,
            ).count(),
            1,
        )
        order = Order.objects.get(external_order_id='5001')
        self.assertEqual(order.status, Order.Status.CANCELLED)

    def test_insufficient_stock_raises_error_and_keeps_stock_unchanged(self):
        with self.assertRaises(OrderIngestionError):
            self.ingest_sale(quantity=11)

        self.assertEqual(self.refresh_inventory().quantity, 10)
        self.assertFalse(InventoryMovement.objects.exists())

    def test_woocommerce_import_defers_stock_to_lifecycle(self):
        # A freshly-imported WooCommerce order is operationally PENDING: the call
        # centre must confirm and fulfil it before stock is committed. So the
        # import must NOT deduct stock, even when WooCommerce already marks it
        # 'completed'. (Stock is committed later through the fulfilment
        # lifecycle — see test_lifecycle_service.)
        order, _ = self.service.ingest(
            self.payload(status='completed', quantity=2),
            self.channel,
            source=Order.Source.WOOCOMMERCE,
        )

        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertEqual(order.wc_status, 'completed')
        self.assertEqual(self.refresh_inventory().quantity, 10)
        self.assertFalse(
            InventoryMovement.objects.filter(
                movement_type=InventoryMovement.MovementType.SALE,
            ).exists()
        )
