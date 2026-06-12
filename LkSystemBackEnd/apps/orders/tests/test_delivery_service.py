from decimal import Decimal
from unittest.mock import Mock, patch

import requests
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.delivery_service import DeliveryError, DeliverySubmissionService
from apps.orders.models import Order, OrderLine
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class DeliverySubmissionServiceTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Test Company', abbreviation='TST')
        self.brand = Brand.objects.create(company=self.company, name='Test Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Woo Store',
            code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
            state='Tunis',
            city='Médina',
            address='montplaisir',
            phone='22900333',
            delivery_api_key='x' * 420,
            wc_store_url='https://example.test',
            wc_consumer_key='ck_test',
            wc_consumer_secret='cs_test',
        )
        self.product = Product.objects.create(
            brand=self.brand,
            name='Crème Coiffante - 150ML',
            wc_product_id=101,
            barcode='CREME-150',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='100.00',
        )
        self.actor = get_user_model().objects.create_user(
            matricule='U200',
            email='delivery@example.com',
            password='test-pass',
        )

    def _order(self):
        order = Order.objects.create(
            company=self.company,
            sales_channel=self.channel,
            brand=self.brand,
            order_number='ORD-JAX-1',
            external_order_id='28238',
            status=Order.Status.CONFIRMED,
            billing_first_name='Test',
            billing_last_name='Client',
            billing_phone='+21624512995',
            billing_state='Ariana',
            billing_city='Ariana Ville',
            billing_address_1='9 Rue El Milaha Menzah 8',
            total=Decimal('514.00'),
        )
        OrderLine.objects.create(
            order=order,
            product=self.product,
            product_name=self.product.name,
            barcode=self.product.barcode,
            quantity=1,
            unit_price=Decimal('100.00'),
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
        )
        return order

    def test_governorate_mapper_accepts_woocommerce_state_codes(self):
        service = DeliverySubmissionService()

        expected_codes = {
            'NB': 1,
            'GF': 2,
            'SF': 3,
            'TS': 4,
            'BZ': 5,
            'JD': 6,
            'TZ': 7,
            'TT': 8,
            'LK': 9,
            'SB': 10,
            'LM': 11,
            'BE': 12,
            'GB': 13,
            'ZG': 14,
            'AR': 15,
            'KR': 16,
            'MN': 17,
            'MH': 18,
            'SI': 19,
            'BA': 20,
            'MD': 21,
            'KS': 22,
            'SS': 23,
            'KB': 24,
        }

        for code, governorate_id in expected_codes.items():
            with self.subTest(code=code):
                self.assertEqual(service._governorate_id(code), governorate_id)

        self.assertEqual(service._governorate_id('BZ'), 5)
        self.assertEqual(service._governorate_id('biz'), 5)
        self.assertEqual(service._governorate_id('TN-23'), 5)
        self.assertEqual(service._governorate_id('TN23'), 5)
        self.assertEqual(service._governorate_id('Gabès'), 13)
        self.assertEqual(service._governorate_id('Ariana'), 15)

    @override_settings(DELIVERY_API_URL='https://core.jax-delivery.com')
    @patch('apps.orders.delivery_service.requests.post')
    def test_jax_submission_uses_channel_token_and_saves_response_fields(self, mock_post):
        response_payload = {
            'code': 'ARI1883558443804',
            'referenceExterne': 28238,
            'statut_id': 9,
            'id': 4224450,
            'client_id': 1883,
            'cod': '514.000',
        }
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = response_payload
        mock_post.return_value = mock_response

        order = self._order()
        result = DeliverySubmissionService().submit(order, actor=self.actor)

        order.refresh_from_db()
        self.assertEqual(result, response_payload)
        self.assertEqual(order.delivery_reference, 'ARI1883558443804')
        self.assertEqual(order.delivery_code, 'ARI1883558443804')
        self.assertEqual(order.delivery_external_reference, '28238')
        self.assertEqual(order.delivery_status_id, 9)
        self.assertEqual(order.delivery_order_id, 4224450)
        self.assertEqual(order.delivery_client_id, 1883)
        self.assertEqual(order.delivery_cod_amount, Decimal('514.000'))
        self.assertEqual(order.delivery_response, response_payload)

        _, kwargs = mock_post.call_args
        self.assertEqual(kwargs['url'], 'https://core.jax-delivery.com/api/user/colis/add')
        self.assertEqual(kwargs['params'], {'token': self.channel.delivery_api_key})
        self.assertNotIn('Authorization', kwargs['headers'])
        self.assertEqual(kwargs['json']['referenceExterne'], '28238')
        self.assertEqual(kwargs['json']['governorat'], 15)
        self.assertEqual(kwargs['json']['gouvernorat_pickup'], 4)

    @override_settings(DELIVERY_API_URL='https://core.jax-delivery.com')
    @patch('apps.orders.delivery_service.requests.post')
    def test_delivery_failure_does_not_store_or_raise_api_token(self, mock_post):
        mock_post.side_effect = requests.exceptions.ConnectionError(
            f'Cannot connect to https://core.jax-delivery.com/api/user/colis/add?token={self.channel.delivery_api_key}'
        )
        order = self._order()

        with self.assertRaises(DeliveryError) as ctx:
            DeliverySubmissionService().submit(order, actor=self.actor)

        order.refresh_from_db()
        self.assertNotIn(self.channel.delivery_api_key, ctx.exception.message)
        self.assertNotIn(self.channel.delivery_api_key, order.delivery_response['error'])
        self.assertIn('token=***', order.delivery_response['error'])
