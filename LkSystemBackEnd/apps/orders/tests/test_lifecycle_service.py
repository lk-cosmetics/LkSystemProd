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
            product_type=Product.ProductType.RESELL_PRODUCT,
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
        # A completed sale deducts stock (10 -> 8); processing the return must
        # restore it exactly once (back to 10) and reject a second attempt.
        # MANUAL maps the payload status straight to COMPLETED, so the sale
        # movement is recorded at ingest (a WooCommerce import would defer it).
        order, _ = self.service.ingest(
            self.payload(quantity=2), self.channel, source=Order.Source.MANUAL,
        )
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 8)
        # A completed till sale lands on done at ingestion.
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DONE)

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
            status=Order.Status.DONE,
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
        self.assertEqual(checked_out.status, Order.Status.DONE)
        self.assertEqual(checked_out.status, Order.Status.DONE)
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

    def two_line_payload(self, *, order_id, product_b, quantity=2):
        """A completed two-line order: self.product + a second product."""
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
                    'id': 7101,
                    'product_id': self.product.wc_product_id,
                    'name': self.product.name,
                    'sku': self.product.barcode,
                    'quantity': quantity,
                    'price': '100.00',
                    'subtotal': str(quantity * 100),
                    'total': str(quantity * 100),
                    'total_tax': '0',
                },
                {
                    'id': 7102,
                    'product_id': product_b.wc_product_id,
                    'name': product_b.name,
                    'sku': product_b.barcode,
                    'quantity': quantity,
                    'price': '50.00',
                    'subtotal': str(quantity * 50),
                    'total': str(quantity * 50),
                    'total_tax': '0',
                },
            ],
        }

    def test_structured_return_restocks_good_and_writes_off_damaged(self):
        # Per-line return disposition (the operator picks, line by line, whether
        # each returned item goes back to stock or is written off as damaged).
        # A delivered two-line order is returned GOOD + DAMAGED: only the GOOD
        # line is restocked (RETURN_IN); the DAMAGED line is NOT restocked but
        # leaves a DAMAGE audit movement. Locks the matrix in lifecycle_service.
        product_b = Product.objects.create(
            brand=self.brand,
            name='Second Perfume',
            wc_product_id=102,
            barcode='PERF-102',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='50.00',
        )
        inventory_b = SalesChannelInventory.objects.create(
            sales_channel=self.channel,
            product=product_b,
            quantity=10,
        )

        order, _ = self.service.ingest(
            self.two_line_payload(order_id=8001, product_b=product_b),
            self.channel,
            source=Order.Source.MANUAL,
        )
        # Completed MANUAL sale deducts both lines (10 -> 8 each).
        self.inventory.refresh_from_db()
        inventory_b.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 8)
        self.assertEqual(inventory_b.quantity, 8)

        # A completed till sale lands on done at ingestion.
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DONE)

        lines = {ln.product_id: ln for ln in OrderLine.objects.filter(order=order)}
        good_line = lines[self.product.id]
        damaged_line = lines[product_b.id]

        OrderLifecycleService.process_return(
            order,
            actor=self.actor,
            reason='Mixed-condition return',
            line_conditions=[
                {'line_id': good_line.id, 'condition': 'GOOD'},
                {'line_id': damaged_line.id, 'condition': 'DAMAGED'},
            ],
        )

        self.inventory.refresh_from_db()
        inventory_b.refresh_from_db()
        good_line.refresh_from_db()
        damaged_line.refresh_from_db()

        # GOOD line: restocked 8 -> 10 with exactly one RETURN_IN movement.
        self.assertEqual(self.inventory.quantity, 10)
        self.assertEqual(good_line.return_condition, OrderLine.ReturnCondition.GOOD)
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                product=self.product,
                movement_type=InventoryMovement.MovementType.RETURN_IN,
            ).count(),
            1,
        )

        # DAMAGED line: NOT restocked (stays 8) but records a DAMAGE movement
        # and never a RETURN_IN, so the damaged unit is written off cleanly.
        self.assertEqual(inventory_b.quantity, 8)
        self.assertEqual(damaged_line.return_condition, OrderLine.ReturnCondition.DAMAGED)
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                product=product_b,
                movement_type=InventoryMovement.MovementType.DAMAGE,
            ).count(),
            1,
        )
        self.assertEqual(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                product=product_b,
                movement_type=InventoryMovement.MovementType.RETURN_IN,
            ).count(),
            0,
        )
