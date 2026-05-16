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
            product_type=Product.ProductType.FINISHED,
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

    def refresh_inventory(self):
        self.inventory.refresh_from_db()
        return self.inventory

    def test_completed_order_sync_is_idempotent(self):
        self.service.ingest(self.payload(quantity=2), self.channel)
        self.assertEqual(self.refresh_inventory().quantity, 8)

        self.service.ingest(self.payload(quantity=2), self.channel)

        self.assertEqual(self.refresh_inventory().quantity, 8)
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference__startswith='ORD-',
                movement_type=InventoryMovement.MovementType.SALE,
            ).count(),
            1,
        )

    def test_order_quantity_update_adjusts_only_delta(self):
        self.service.ingest(self.payload(quantity=2), self.channel)
        self.service.ingest(self.payload(quantity=4), self.channel)

        self.assertEqual(self.refresh_inventory().quantity, 6)
        self.assertEqual(
            InventoryMovement.objects.filter(
                movement_type=InventoryMovement.MovementType.SALE,
            ).count(),
            2,
        )

    def test_cancelled_order_reverses_previous_sale_movement(self):
        self.service.ingest(self.payload(quantity=3), self.channel)
        self.assertEqual(self.refresh_inventory().quantity, 7)

        self.service.ingest(self.payload(status='cancelled', quantity=3), self.channel)

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
            self.service.ingest(self.payload(quantity=11), self.channel)

        self.assertEqual(self.refresh_inventory().quantity, 10)
        self.assertFalse(InventoryMovement.objects.exists())
