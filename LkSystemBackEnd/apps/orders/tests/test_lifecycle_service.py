from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.brands.models import Brand
from apps.clients.models import Client
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.lifecycle_service import LifecycleError, OrderLifecycleService
from apps.orders.models import Order, OrderLine
from apps.orders.service import OrderIngestionService
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class OrderLifecycleServiceTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Test Company', abbreviation='TST')
        self.brand = Brand.objects.create(company=self.company, name='Test Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Web Store',
            code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Main POS',
            code='POS',
            channel_type=SalesChannel.ChannelType.POS,
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
        self.pos_inventory = SalesChannelInventory.objects.create(
            sales_channel=self.pos_channel,
            product=self.product,
            quantity=10,
        )
        self.actor = get_user_model().objects.create_user(
            matricule='U100',
            email='worker@example.com',
            password='test-pass',
        )
        self.service = OrderIngestionService()

    def payload(self, *, quantity=2, order_id=5001):
        return {
            'id': order_id,
            'order_key': f'wc_order_{order_id}',
            'number': str(order_id),
            'status': 'completed',
            'currency': 'TND',
            'billing': {
                'first_name': 'Test',
                'last_name': 'Client',
                'email': f'client-{order_id}@example.com',
            },
            'line_items': [
                {
                    'id': 7001,
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

    def test_reimport_updates_order_line_in_place(self):
        order, _ = self.service.ingest(self.payload(quantity=2), self.channel)
        first_line_id = OrderLine.objects.get(order=order).id

        self.service.ingest(self.payload(quantity=4), self.channel)

        lines = list(OrderLine.objects.filter(order=order))
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].id, first_line_id)
        self.assertEqual(lines[0].quantity, 4)

    def test_return_restores_stock_once(self):
        order, _ = self.service.ingest(self.payload(quantity=2), self.channel)
        OrderLifecycleService.confirm(order, actor=self.actor)
        order.delivery_status = Order.DeliveryStatus.DELIVERED
        order.save(update_fields=['delivery_status', 'updated_at'])

        OrderLifecycleService.process_return(order, actor=self.actor, reason='Customer returned package')

        self.inventory.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 10)
        self.assertIsNotNone(order.stock_restored_at)
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                movement_type=InventoryMovement.MovementType.RETURN_IN,
            ).count(),
            1,
        )

        with self.assertRaises(LifecycleError):
            OrderLifecycleService.restore_stock_from_return(order, actor=self.actor)

    def test_pos_return_restores_stock_without_counting_client_return(self):
        client = Client.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=self.pos_channel,
            email='pos-client@example.com',
            first_name='POS',
            last_name='Client',
            source=Client.Source.POS,
        )
        order = Order.objects.create(
            company=self.company,
            sales_channel=self.pos_channel,
            brand=self.brand,
            client=client,
            order_number='POS-RETURN-001',
            ticket_id='150520260001',
            source=Order.Source.POS,
            status=Order.Status.COMPLETED,
            outcome=Order.Outcome.CONFIRMED,
            payment_status=Order.PaymentStatus.PAID,
            total='100.00',
            pos_validated_at=timezone.now(),
        )
        OrderLine.objects.create(
            order=order,
            product=self.product,
            product_name=self.product.name,
            quantity=2,
            unit_price='50.00',
            subtotal='100.00',
            total='100.00',
        )
        InventoryMovement.objects.create(
            sales_channel=self.pos_channel,
            product=self.product,
            movement_type=InventoryMovement.MovementType.SALE,
            status=InventoryMovement.MovementStatus.COMPLETED,
            quantity=2,
            quantity_before=10,
            quantity_after=8,
            external_reference=order.order_number,
            created_by=self.actor,
        )

        OrderLifecycleService.process_return(order, actor=self.actor, reason='POS return')

        self.pos_inventory.refresh_from_db()
        client.refresh_from_db()
        self.assertEqual(self.pos_inventory.quantity, 10)
        self.assertEqual(client.number_of_returns, 0)
        self.assertFalse(client.is_blocked)

    def test_pos_validation_checks_out_waiting_pickup_order_once(self):
        payload = self.payload(quantity=2, order_id=6001)
        payload['status'] = 'pending'
        order, _ = self.service.ingest(payload, self.channel)

        OrderLifecycleService.confirm(order, actor=self.actor)
        OrderLifecycleService.send_to_pos(
            order,
            pos_sales_channel=self.pos_channel,
            actor=self.actor,
        )

        checked_out = OrderLifecycleService.validate_pos(
            order,
            actor=self.actor,
            payment_method='cash',
            payment_method_title='Cash',
            customer_note='Paid in store',
        )

        self.inventory.refresh_from_db()
        self.pos_inventory.refresh_from_db()
        checked_out.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 10)
        self.assertEqual(self.pos_inventory.quantity, 8)
        self.assertEqual(checked_out.outcome, Order.Outcome.CONFIRMED)
        self.assertEqual(checked_out.status, Order.Status.COMPLETED)
        self.assertEqual(checked_out.payment_status, Order.PaymentStatus.PAID)
        self.assertIsNotNone(checked_out.pos_validated_at)
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference=checked_out.order_number,
                movement_type=InventoryMovement.MovementType.SALE,
            ).count(),
            1,
        )

        with self.assertRaises(LifecycleError):
            OrderLifecycleService.validate_pos(
                checked_out,
                actor=self.actor,
                payment_method='cash',
            )

        self.pos_inventory.refresh_from_db()
        self.assertEqual(self.pos_inventory.quantity, 8)

    def test_send_to_pos_rejects_other_brand_location(self):
        other_brand = Brand.objects.create(company=self.company, name='Other Brand')
        other_pos = SalesChannel.objects.create(
            brand=other_brand,
            name='Other POS',
            code='OPOS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        order, _ = self.service.ingest(self.payload(quantity=1, order_id=7001), self.channel)
        OrderLifecycleService.confirm(order, actor=self.actor)

        with self.assertRaises(LifecycleError):
            OrderLifecycleService.send_to_pos(
                order,
                pos_sales_channel=other_pos,
                actor=self.actor,
            )
