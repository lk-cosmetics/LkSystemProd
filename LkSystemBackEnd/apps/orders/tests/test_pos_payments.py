from decimal import Decimal

from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order
from apps.orders.payment_service import POSPaymentError, POSPaymentService
from apps.sales_channels.models import SalesChannel


class POSPaymentServiceTests(TestCase):
    def setUp(self):
        company = Company.objects.create(name='Payment Co', abbreviation='PAY')
        brand = Brand.objects.create(company=company, name='Payment Brand')
        channel = SalesChannel.objects.create(
            brand=brand,
            name='Payment POS',
            code='PAY-POS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        self.order = Order.objects.create(
            company=company,
            brand=brand,
            sales_channel=channel,
            order_number='PAY-1',
            source=Order.Source.POS,
            total=Decimal('44.50'),
        )

    def test_cash_payment_stores_received_and_change(self):
        POSPaymentService.apply(
            self.order,
            payment_method='cash',
            amount_received='50.000',
        )
        self.order.refresh_from_db()
        self.assertEqual(self.order.cash_amount, Decimal('44.500'))
        self.assertEqual(self.order.card_amount, Decimal('0.000'))
        self.assertEqual(self.order.amount_received, Decimal('50.000'))
        self.assertEqual(self.order.change_returned, Decimal('5.500'))

    def test_split_payment_stores_each_tender(self):
        POSPaymentService.apply(
            self.order,
            payment_method='split',
            cash_amount='14.500',
            card_amount='30.000',
            amount_received='20.000',
        )
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_method, 'split')
        self.assertEqual(self.order.cash_amount, Decimal('14.500'))
        self.assertEqual(self.order.card_amount, Decimal('30.000'))
        self.assertEqual(self.order.change_returned, Decimal('5.500'))

    def test_underpaid_cash_is_rejected(self):
        with self.assertRaisesMessage(POSPaymentError, 'lower than the order total'):
            POSPaymentService.apply(
                self.order,
                payment_method='cash',
                amount_received='40.000',
            )

    def test_split_allocation_must_match_total(self):
        with self.assertRaisesMessage(POSPaymentError, 'must equal the order total'):
            POSPaymentService.apply(
                self.order,
                payment_method='split',
                cash_amount='10.000',
                card_amount='20.000',
                amount_received='10.000',
            )
