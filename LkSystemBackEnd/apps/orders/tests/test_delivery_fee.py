"""
Tests for the optional delivery fee on orders.

The fee defaults to 0, is rolled into ``total`` by ``recalculate_totals``, and
is exposed (with the bill-to client's Matricule Fiscale) on the order
serializer so the invoice can render it.

    python manage.py test apps.orders.tests.test_delivery_fee
"""
from decimal import Decimal

from django.test import TestCase

from apps.brands.models import Brand
from apps.clients.models import Client
from apps.company.models import Company
from apps.orders.models import Order, OrderLine
from apps.orders.serializers import OrderDetailSerializer
from apps.sales_channels.models import SalesChannel


class DeliveryFeeTotalsTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='DF Co', abbreviation='DFC')
        self.brand = Brand.objects.create(company=self.company, name='DF Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='DF POS', code='DFPOS',
            channel_type=SalesChannel.ChannelType.POS,
        )

    def _order_with_line(self, *, line_total, delivery_fee, number):
        order = Order.objects.create(
            company=self.company, brand=self.brand, sales_channel=self.channel,
            order_number=number, status=Order.Status.NEW,
            source=Order.Source.POS, delivery_fee=Decimal(delivery_fee),
        )
        OrderLine.objects.create(
            order=order, product_name='Widget', quantity=1,
            unit_price=Decimal(line_total), subtotal=Decimal(line_total),
            tax=Decimal('0.00'), total=Decimal(line_total),
        )
        return order

    def test_delivery_fee_is_added_to_total(self):
        order = self._order_with_line(line_total='20.00', delivery_fee='7.00', number='DF-1')
        order.recalculate_totals(save=True)
        self.assertEqual(order.total, Decimal('27.00'))

    def test_zero_delivery_fee_leaves_total_at_lines(self):
        order = self._order_with_line(line_total='20.00', delivery_fee='0.00', number='DF-2')
        order.recalculate_totals(save=True)
        self.assertEqual(order.total, Decimal('20.00'))

    def test_delivery_fee_stacks_after_discount(self):
        order = self._order_with_line(line_total='100.00', delivery_fee='7.00', number='DF-3')
        order.discount_type = Order.DiscountType.PERCENTAGE
        order.discount_value = Decimal('10.00')  # 10% off → 90, then +7 delivery
        order.recalculate_totals(save=True)
        self.assertEqual(order.discount_total, Decimal('10.00'))
        self.assertEqual(order.total, Decimal('97.00'))

    def test_delivery_fee_defaults_to_zero(self):
        order = Order.objects.create(
            company=self.company, brand=self.brand, sales_channel=self.channel,
            order_number='DF-DEFAULT', status=Order.Status.NEW,
            source=Order.Source.POS,
        )
        self.assertEqual(order.delivery_fee, Decimal('0.00'))


class OrderInvoiceSerializerFieldTests(TestCase):
    def test_serializer_exposes_delivery_fee_and_client_billing_identity(self):
        fields = OrderDetailSerializer().fields
        self.assertIn('delivery_fee', fields)
        self.assertIn('client_type', fields)
        self.assertIn('client_matricule_fiscale', fields)

    def test_serializer_returns_company_type_and_fiscal_number(self):
        company = Company.objects.create(name='B2B Invoice Co', abbreviation='B2BI')
        brand = Brand.objects.create(company=company, name='B2B Invoice Brand')
        channel = SalesChannel.objects.create(
            brand=brand,
            name='B2B Invoice POS',
            code='B2B-INVOICE-POS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        client = Client.objects.create(
            company=company,
            brand=brand,
            email='billing-company@example.com',
            first_name='Contact',
            last_name='Company',
            client_type=Client.ClientType.COMPANY,
            matricule_fiscale='MF-TEST-2026',
        )
        order = Order.objects.create(
            company=company,
            brand=brand,
            sales_channel=channel,
            client=client,
            order_number='B2B-INVOICE-1',
        )

        data = OrderDetailSerializer(order).data

        self.assertEqual(data['client_type'], Client.ClientType.COMPANY)
        self.assertEqual(data['client_matricule_fiscale'], 'MF-TEST-2026')


class WooCommerceShippingFeeIngestionTests(TestCase):
    """WooCommerce payloads (webhook + REST sync) carry the courier fee as
    ``shipping_total`` and never send ``delivery_fee``. Ingestion must fold the
    WC fee into ``delivery_fee`` so the recomputed total includes it — without
    that, every WC order's total silently drops its shipping fee."""

    def setUp(self):
        from apps.orders.service import OrderIngestionService
        self.ingestion = OrderIngestionService()
        self.company = Company.objects.create(name='WCF Co', abbreviation='WCF')
        self.brand = Brand.objects.create(company=self.company, name='WCF Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='WCF Store', code='WCFSTORE',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )

    def _payload(self, wc_id, **overrides):
        payload = {
            'id': wc_id, 'number': str(wc_id), 'status': 'processing',
            'currency': 'TND',
            'total': '57.00', 'shipping_total': '8.00',
            'discount_total': '0.00', 'total_tax': '0.00',
            'payment_method': 'cod', 'payment_method_title': 'Cash on delivery',
            'billing': {
                'first_name': 'Fee', 'last_name': 'Test',
                'email': f'fee-{wc_id}@example.com', 'phone': '+21699000111',
                'address_1': 'Rue 1', 'city': 'Tunis', 'state': 'Tunis',
                'postcode': '1000', 'country': 'TN',
            },
            'shipping': {},
            'line_items': [{
                'id': 1, 'name': 'Widget', 'product_id': 0, 'sku': '',
                'quantity': 1, 'price': '49.00',
                'subtotal': '49.00', 'total': '49.00', 'total_tax': '0.00',
            }],
            'date_created': '2026-06-11T10:00:00',
        }
        payload.update(overrides)
        return payload

    def test_wc_shipping_total_lands_in_delivery_fee_and_total(self):
        order, created = self.ingestion.ingest(
            self._payload(910001), sales_channel=self.channel,
            source=Order.Source.WOOCOMMERCE,
        )
        self.assertTrue(created)
        self.assertEqual(order.shipping_total, Decimal('8.00'))
        self.assertEqual(order.delivery_fee, Decimal('8.00'))
        self.assertEqual(order.total, Decimal('57.00'))

    def test_explicit_delivery_fee_wins_over_shipping_total(self):
        order, _ = self.ingestion.ingest(
            self._payload(910002, delivery_fee='5.00'),
            sales_channel=self.channel, source=Order.Source.WOOCOMMERCE,
        )
        self.assertEqual(order.delivery_fee, Decimal('5.00'))
        self.assertEqual(order.total, Decimal('54.00'))

    def test_free_shipping_keeps_fee_zero(self):
        order, _ = self.ingestion.ingest(
            self._payload(910003, shipping_total='0.00', total='49.00'),
            sales_channel=self.channel, source=Order.Source.WOOCOMMERCE,
        )
        self.assertEqual(order.delivery_fee, Decimal('0.00'))
        self.assertEqual(order.total, Decimal('49.00'))
