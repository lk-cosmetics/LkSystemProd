from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from unittest.mock import patch
from rest_framework import status
from rest_framework.test import APIClient

from apps.brands.models import Brand
from apps.clients.models import Client
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.delivery_service import DeliveryError
from apps.orders.models import Order, OrderLine, OrderSyncEvent
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class OrderAPITests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Test Company', abbreviation='TST')
        self.brand = Brand.objects.create(company=self.company, name='Test Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Web Store',
            code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.order = Order.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            order_number='ORD-API-001',
            status=Order.Status.PENDING,
            source=Order.Source.WOOCOMMERCE,
            total='100.00',
        )
        self.client_record = Client.objects.create(
            company=self.company,
            brand=self.brand,
            email='amina.client@example.com',
            first_name='Amina',
            last_name='Trabelsi',
            phone='+21622123456',
        )
        self.order.client = self.client_record
        self.order.billing_phone = '+21622123456'
        self.order.save(update_fields=['client', 'billing_phone', 'updated_at'])
        self.user = get_user_model().objects.create_user(
            matricule='ADMIN100',
            email='admin@example.com',
            password='test-pass',
        )
        self.user.is_staff = True
        self.user.is_superuser = True
        self.user.save(update_fields=['is_staff', 'is_superuser'])

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_retrieve_order_keeps_default_queue_ordering_annotation(self):
        response = self.client.get(f'/api/v1/orders/{self.order.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], self.order.id)
        self.assertEqual(response.data['lifecycle_priority'], 1)

    def test_status_update_keeps_default_queue_ordering_annotation(self):
        response = self.client.patch(
            f'/api/v1/orders/{self.order.id}/status/',
            {'status': Order.Status.PROCESSING},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Order.Status.PROCESSING)

    def test_search_matches_order_id_client_name_and_phone(self):
        for query in (str(self.order.id), 'Amina', '22123456'):
            response = self.client.get('/api/v1/orders/', {'search': query})

            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data['count'], 1)
            self.assertEqual(response.data['results'][0]['id'], self.order.id)

    def test_flow_filter_and_summary_counts_use_same_bucket(self):
        response = self.client.get('/api/v1/orders/', {'flow': 'needs_confirmation'})
        summary = self.client.get('/api/v1/orders/summary/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(summary.status_code, status.HTTP_200_OK)
        self.assertEqual(summary.data['flow_counts']['needs_confirmation'], 1)

    def test_pos_completed_orders_are_done_not_client_call_priority(self):
        pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='POS Desk',
            code='POS-DESK',
            channel_type=SalesChannel.ChannelType.POS,
        )
        pos_order = Order.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=pos_channel,
            order_number='POS-API-001',
            status=Order.Status.COMPLETED,
            source=Order.Source.POS,
            total='25.00',
        )

        needs_call = self.client.get('/api/v1/orders/', {'flow': 'needs_confirmation'})
        done = self.client.get('/api/v1/orders/', {'flow': 'done'})
        detail = self.client.get(f'/api/v1/orders/{pos_order.id}/')
        summary = self.client.get('/api/v1/orders/summary/')

        self.assertEqual(needs_call.status_code, status.HTTP_200_OK)
        self.assertNotIn(pos_order.id, [row['id'] for row in needs_call.data['results']])
        self.assertEqual(done.status_code, status.HTTP_200_OK)
        self.assertIn(pos_order.id, [row['id'] for row in done.data['results']])
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data['lifecycle_priority'], 10)
        self.assertEqual(summary.data['flow_counts']['needs_confirmation'], 1)
        self.assertEqual(summary.data['flow_counts']['done'], 1)

    def test_pos_checkout_creation_marks_order_done(self):
        pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Main POS',
            code='POS-MAIN',
            channel_type=SalesChannel.ChannelType.POS,
        )
        product = Product.objects.create(
            brand=self.brand,
            name='POS Product',
            barcode='POS-001',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='25.00',
        )
        SalesChannelInventory.objects.create(
            sales_channel=pos_channel,
            product=product,
            quantity=5,
        )

        response = self.client.post(
            '/api/v1/orders/pos/',
            {
                'sales_channel': pos_channel.id,
                'billing': {'first_name': 'Walk', 'last_name': 'In'},
                'line_items': [
                    {
                        'local_product_id': product.id,
                        'name': product.name,
                        'sku': product.barcode,
                        'quantity': 1,
                        'price': '25.00',
                        'total': '25.00',
                    },
                ],
                'payment_method': 'cash',
                'payment_method_title': 'Cash',
                'status': 'completed',
                'total': '25.00',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(pk=response.data['id'])
        self.assertEqual(order.source, Order.Source.POS)
        self.assertEqual(order.status, Order.Status.COMPLETED)
        self.assertEqual(order.outcome, Order.Outcome.CONFIRMED)
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertIsNotNone(order.pos_validated_at)
        self.assertEqual(order.pos_validated_by, self.user)

    # ── Manual (Order Manager) order creation ────────────────────────────

    def _manual_channel_and_product(self, code):
        channel = SalesChannel.objects.create(
            brand=self.brand,
            name=f'Order Manager {code}',
            code=code,
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        product = Product.objects.create(
            brand=self.brand,
            name=f'Manual Product {code}',
            barcode=f'MAN-{code}',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='50.00',
        )
        SalesChannelInventory.objects.create(
            sales_channel=channel, product=product, quantity=10,
        )
        return channel, product

    def test_manual_order_defaults_to_processing_without_pos_forcing(self):
        channel, product = self._manual_channel_and_product('WEB-MAN1')

        response = self.client.post(
            '/api/v1/orders/manual/',
            {
                'sales_channel': channel.id,
                'billing': {'first_name': 'Manual', 'last_name': 'Buyer'},
                'line_items': [
                    {
                        'local_product_id': product.id,
                        'name': product.name,
                        'sku': product.barcode,
                        'quantity': 2,
                        'price': '50.00',
                        'total': '100.00',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        order = Order.objects.get(pk=response.data['id'])
        self.assertEqual(order.source, Order.Source.MANUAL)
        self.assertEqual(order.status, Order.Status.PROCESSING)
        # POS-only forcing must NOT happen for a back-office order.
        self.assertEqual(order.outcome, Order.Outcome.NONE)
        self.assertIsNone(order.pos_validated_at)
        self.assertIsNone(order.pos_sales_channel_id)

    def test_manual_order_applies_percentage_discount(self):
        channel, product = self._manual_channel_and_product('WEB-MAN2')

        response = self.client.post(
            '/api/v1/orders/manual/',
            {
                'sales_channel': channel.id,
                'billing': {'first_name': 'Discount', 'last_name': 'Buyer'},
                'line_items': [
                    {
                        'local_product_id': product.id,
                        'name': product.name,
                        'sku': product.barcode,
                        'quantity': 2,
                        'price': '50.00',
                        'total': '100.00',
                    },
                ],
                'discount_type': 'PERCENTAGE',
                'discount_value': '10',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        order = Order.objects.get(pk=response.data['id'])
        self.assertEqual(order.discount_type, Order.DiscountType.PERCENTAGE)
        self.assertEqual(order.discount_total, Decimal('10.00'))
        self.assertEqual(order.total, Decimal('90.00'))

    def test_manual_order_links_existing_client_by_derived_billing(self):
        channel, product = self._manual_channel_and_product('WEB-MAN3')

        response = self.client.post(
            '/api/v1/orders/manual/',
            {
                'sales_channel': channel.id,
                'client': self.client_record.id,
                'line_items': [
                    {
                        'local_product_id': product.id,
                        'name': product.name,
                        'sku': product.barcode,
                        'quantity': 1,
                        'price': '50.00',
                        'total': '50.00',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        order = Order.objects.get(pk=response.data['id'])
        # Ingestion re-resolved the client from the server-derived billing block.
        self.assertEqual(order.client_id, self.client_record.id)
        self.assertEqual(order.billing_email, self.client_record.email)

    def test_manual_order_rejects_cross_tenant_client(self):
        channel, product = self._manual_channel_and_product('WEB-MAN4')
        other_company = Company.objects.create(name='Other Co', abbreviation='OTH')
        other_brand = Brand.objects.create(company=other_company, name='Other Brand')
        foreign_client = Client.objects.create(
            company=other_company,
            brand=other_brand,
            email='foreign@example.com',
            first_name='Foreign',
            last_name='Client',
            phone='+21655000111',
        )

        response = self.client.post(
            '/api/v1/orders/manual/',
            {
                'sales_channel': channel.id,
                'client': foreign_client.id,
                'line_items': [
                    {
                        'local_product_id': product.id,
                        'name': product.name,
                        'sku': product.barcode,
                        'quantity': 1,
                        'price': '50.00',
                        'total': '50.00',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('client', response.data)
        self.assertFalse(Order.objects.filter(client_id=foreign_client.id).exists())

    def test_pos_offline_ticket_sync_is_idempotent(self):
        pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Main POS',
            code='POS-OFFLINE',
            channel_type=SalesChannel.ChannelType.POS,
        )
        product = Product.objects.create(
            brand=self.brand,
            name='Offline POS Product',
            barcode='OFF-001',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='25.00',
        )
        inventory = SalesChannelInventory.objects.create(
            sales_channel=pos_channel,
            product=product,
            quantity=5,
        )
        payload = {
            'sales_channel': pos_channel.id,
            'ticket_id': f"{timezone.localdate().strftime('%d%m%Y')}0001",
            'client_ticket_uuid': 'offline-ticket-uuid-001',
            'billing': {'first_name': 'Walk', 'last_name': 'In'},
            'line_items': [
                {
                    'local_product_id': product.id,
                    'name': product.name,
                    'sku': product.barcode,
                    'quantity': 1,
                    'price': '25.00',
                    'total': '25.00',
                },
            ],
            'payment_method': 'cash',
            'payment_method_title': 'Cash',
            'status': 'completed',
            'total': '25.00',
        }

        first = self.client.post('/api/v1/orders/pos/', payload, format='json')
        second = self.client.post('/api/v1/orders/pos/', payload, format='json')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data['id'], second.data['id'])
        self.assertEqual(first.data['ticket_id'], payload['ticket_id'])
        self.assertEqual(Order.objects.filter(client_ticket_uuid=payload['client_ticket_uuid']).count(), 1)
        self.assertEqual(OrderLine.objects.filter(order_id=first.data['id']).count(), 1)
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 4)

    def test_pos_ticket_id_is_short_daily_sequence_when_missing(self):
        pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Sequence POS',
            code='POS-SEQ',
            channel_type=SalesChannel.ChannelType.POS,
        )
        product = Product.objects.create(
            brand=self.brand,
            name='Sequence Product',
            barcode='SEQ-001',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='10.00',
        )
        SalesChannelInventory.objects.create(
            sales_channel=pos_channel,
            product=product,
            quantity=5,
        )

        response = self.client.post(
            '/api/v1/orders/pos/',
            {
                'sales_channel': pos_channel.id,
                'client_ticket_uuid': 'sequence-ticket-uuid-001',
                'line_items': [
                    {
                        'local_product_id': product.id,
                        'name': product.name,
                        'sku': product.barcode,
                        'quantity': 1,
                        'price': '10.00',
                        'total': '10.00',
                    },
                ],
                'payment_method': 'cash',
                'payment_method_title': 'Cash',
                'status': 'completed',
                'total': '10.00',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertRegex(response.data['ticket_id'], r'^\d{12}$')
        self.assertTrue(response.data['ticket_id'].startswith(timezone.localdate().strftime('%d%m%Y')))

    def test_pos_pack_sale_deducts_components_not_pack_stock(self):
        pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Pack POS',
            code='POS-PACK',
            channel_type=SalesChannel.ChannelType.POS,
        )
        component_a = Product.objects.create(
            brand=self.brand,
            name='Creme reparatrice',
            barcode='COMP-A',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='10.00',
        )
        component_b = Product.objects.create(
            brand=self.brand,
            name='Masque reparateur',
            barcode='COMP-B',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='15.00',
        )
        pack = Product.objects.create(
            brand=self.brand,
            name='Pack Reparateur',
            product_type=Product.ProductType.RESELL_PRODUCT,
            is_pack=True,
            pack_items=[
                {'product_id': component_a.id, 'quantity': 1},
                {'product_id': component_b.id, 'quantity': 2},
            ],
            sales_price='35.00',
        )
        inv_a = SalesChannelInventory.objects.create(
            sales_channel=pos_channel,
            product=component_a,
            quantity=5,
        )
        inv_b = SalesChannelInventory.objects.create(
            sales_channel=pos_channel,
            product=component_b,
            quantity=5,
        )

        response = self.client.post(
            '/api/v1/orders/pos/',
            {
                'sales_channel': pos_channel.id,
                'line_items': [{
                    'local_product_id': pack.id,
                    'name': pack.name,
                    'quantity': 2,
                    'price': '35.00',
                    'total': '70.00',
                }],
                'payment_method': 'cash',
                'payment_method_title': 'Cash',
                'status': 'completed',
                'total': '70.00',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        inv_a.refresh_from_db()
        inv_b.refresh_from_db()
        self.assertEqual(inv_a.quantity, 3)
        self.assertEqual(inv_b.quantity, 1)
        self.assertFalse(
            InventoryMovement.objects.filter(product=pack, movement_type=InventoryMovement.MovementType.SALE).exists()
        )
        self.assertEqual(
            InventoryMovement.objects.get(product=component_a, movement_type=InventoryMovement.MovementType.SALE).quantity,
            2,
        )
        self.assertEqual(
            InventoryMovement.objects.get(product=component_b, movement_type=InventoryMovement.MovementType.SALE).quantity,
            4,
        )

    def test_pos_pack_sale_returns_clear_component_stock_error(self):
        pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Pack POS Low',
            code='POS-PACK-LOW',
            channel_type=SalesChannel.ChannelType.POS,
        )
        component = Product.objects.create(
            brand=self.brand,
            name='Creme reparatrice',
            barcode='LOW-COMP',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='10.00',
        )
        pack = Product.objects.create(
            brand=self.brand,
            name='Pack Reparateur',
            product_type=Product.ProductType.RESELL_PRODUCT,
            is_pack=True,
            pack_items=[{'product_id': component.id, 'quantity': 2}],
            sales_price='25.00',
        )
        inventory = SalesChannelInventory.objects.create(
            sales_channel=pos_channel,
            product=component,
            quantity=1,
        )

        response = self.client.post(
            '/api/v1/orders/pos/',
            {
                'sales_channel': pos_channel.id,
                'line_items': [{
                    'local_product_id': pack.id,
                    'name': pack.name,
                    'quantity': 1,
                    'price': '25.00',
                    'total': '25.00',
                }],
                'payment_method': 'cash',
                'payment_method_title': 'Cash',
                'status': 'completed',
                'total': '25.00',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error_code'], 'PACK_STOCK_INSUFFICIENT')
        self.assertIn('pack_errors', response.data)
        self.assertIn('Pack Reparateur', response.data['detail'])
        inventory.refresh_from_db()
        self.assertEqual(inventory.quantity, 1)

    def test_detail_includes_stock_check_with_website_and_pos_warnings(self):
        product = Product.objects.create(
            brand=self.brand,
            name='Perfume Bottle',
            wc_product_id=404,
            barcode='BOT-404',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='25.00',
        )
        pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Main POS',
            code='POS-MAIN',
            channel_type=SalesChannel.ChannelType.POS,
        )
        SalesChannelInventory.objects.create(
            sales_channel=self.channel,
            product=product,
            quantity=1,
        )
        SalesChannelInventory.objects.create(
            sales_channel=pos_channel,
            product=product,
            quantity=5,
        )
        OrderLine.objects.create(
            order=self.order,
            product=product,
            product_name=product.name,
            barcode=product.barcode,
            quantity=2,
            unit_price='25.00',
            subtotal='50.00',
            total='50.00',
        )
        self.order.pos_sales_channel = pos_channel
        self.order.save(update_fields=['pos_sales_channel', 'updated_at'])

        response = self.client.get(f'/api/v1/orders/{self.order.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        stock_check = response.data['stock_check']
        self.assertTrue(stock_check['has_warnings'])
        self.assertFalse(stock_check['can_fulfill_from_website'])
        self.assertTrue(stock_check['can_fulfill_from_pos'])
        self.assertEqual(stock_check['website_channel']['id'], self.channel.id)
        self.assertEqual(stock_check['pos_channel']['id'], pos_channel.id)
        self.assertEqual(stock_check['items'][0]['required_quantity'], 2)
        self.assertEqual(stock_check['items'][0]['website_available_quantity'], 1)
        self.assertEqual(stock_check['items'][0]['pos_available_quantity'], 5)

    def test_return_lookup_finds_order_by_delivery_code_and_qr_url_value(self):
        self.order.external_order_id = '9001'
        self.order.delivery_code = 'ARI1883558443804'
        self.order.delivery_reference = 'ARI1883558443804'
        self.order.save(
            update_fields=[
                'external_order_id',
                'delivery_code',
                'delivery_reference',
                'updated_at',
            ]
        )

        by_delivery_code = self.client.post(
            '/api/v1/orders/return-lookup/',
            {'query': 'ARI1883558443804'},
            format='json',
        )
        by_qr_url = self.client.post(
            '/api/v1/orders/return-lookup/',
            {'query': 'https://returns.example.test/scan?order=9001'},
            format='json',
        )

        self.assertEqual(by_delivery_code.status_code, status.HTTP_200_OK)
        self.assertEqual(by_delivery_code.data['order']['id'], self.order.id)
        self.assertEqual(by_qr_url.status_code, status.HTTP_200_OK)
        self.assertEqual(by_qr_url.data['order']['id'], self.order.id)

    def test_delivery_validation_error_returns_clear_bad_request(self):
        message = 'Cannot map governorate "XX" to a JAX governorate ID.'

        with patch(
            'apps.orders.views.OrderLifecycleService.submit_delivery',
            side_effect=DeliveryError(message),
        ):
            response = self.client.post(f'/api/v1/orders/{self.order.id}/submit-delivery/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], message)

    def test_delivery_provider_failure_returns_bad_gateway(self):
        with patch(
            'apps.orders.views.OrderLifecycleService.submit_delivery',
            side_effect=DeliveryError('Delivery API returned HTTP 503', status_code=503),
        ):
            response = self.client.post(f'/api/v1/orders/{self.order.id}/submit-delivery/')

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(response.data['detail'], 'Delivery API returned HTTP 503')
        self.assertEqual(response.data['delivery_status_code'], 503)

    def test_preview_orders_fetches_one_woocommerce_page(self):
        self.order.external_order_id = '9001'
        self.order.save(update_fields=['external_order_id', 'updated_at'])

        page_payload = {
            'orders': [
                {
                    'id': 9001,
                    'number': '9001',
                    'status': 'processing',
                    'total': '42.00',
                    'currency': 'TND',
                    'billing': {
                        'first_name': 'Amina',
                        'last_name': 'Trabelsi',
                        'email': 'amina@example.com',
                    },
                    'line_items': [{'id': 1}, {'id': 2}],
                    'date_created': '2026-05-08T10:00:00',
                    'payment_method_title': 'Cash',
                },
                {
                    'id': 9002,
                    'number': '9002',
                    'status': 'processing',
                    'total': '55.00',
                    'currency': 'TND',
                    'billing': {
                        'first_name': 'Nour',
                        'last_name': 'Ben Ali',
                        'email': 'nour@example.com',
                    },
                    'line_items': [{'id': 3}],
                    'date_created': '2026-05-08T10:05:00',
                    'payment_method_title': 'Cash',
                },
            ],
            'total': 120,
            'total_pages': 5,
        }

        with (
            patch('apps.orders.views.OrderViewSet._wc_client', return_value=object()),
            patch(
                'apps.orders.views.OrderViewSet._fetch_wc_import_orders_page',
                return_value=page_payload,
            ) as fetch_page,
        ):
            response = self.client.post(
                '/api/v1/orders/preview/',
                {'sales_channel': self.channel.id, 'page': 2, 'page_size': 25},
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        fetch_page.assert_called_once()
        self.assertEqual(fetch_page.call_args.kwargs['page'], 2)
        self.assertEqual(fetch_page.call_args.kwargs['per_page'], 25)
        self.assertEqual(response.data['total_remote_count'], 120)
        self.assertEqual(response.data['total_pages'], 5)
        self.assertEqual(response.data['status_filter'], 'processing')
        self.assertTrue(response.data['has_next'])
        self.assertTrue(response.data['new_only'])
        self.assertEqual(response.data['existing_count'], 1)
        self.assertEqual(response.data['new_count'], 1)
        self.assertEqual(response.data['total_count'], 1)
        self.assertEqual(response.data['orders'][0]['wc_id'], 9002)
        self.assertFalse(response.data['orders'][0]['exists_locally'])

    def test_woocommerce_preview_uses_processing_status_filter(self):
        from apps.orders.views import OrderViewSet

        class FakeResponse:
            status_code = 200
            headers = {'X-WP-Total': '1', 'X-WP-TotalPages': '1'}
            text = ''

            @staticmethod
            def json():
                return []

        class FakeWooCommerceAPI:
            def __init__(self):
                self.params = None

            def get(self, resource, params=None):
                self.resource = resource
                self.params = params
                return FakeResponse()

        wc_api = FakeWooCommerceAPI()
        OrderViewSet._fetch_wc_import_orders_page(
            wc_api,
            page=1,
            per_page=25,
        )

        self.assertEqual(wc_api.resource, 'orders')
        self.assertEqual(wc_api.params['status'], 'processing')

    def test_sync_events_route_is_not_shadowed_by_order_detail_route(self):
        event = OrderSyncEvent.objects.create(
            sales_channel=self.channel,
            company=self.company,
            triggered_by=self.user,
            status=OrderSyncEvent.SyncStatus.RUNNING,
            trigger_source=OrderSyncEvent.TriggerSource.MANUAL,
            wc_statuses_synced=['processing'],
        )

        list_response = self.client.get('/api/v1/orders/sync-events/')
        detail_response = self.client.get(f'/api/v1/orders/sync-events/{event.id}/')

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['id'], event.id)
