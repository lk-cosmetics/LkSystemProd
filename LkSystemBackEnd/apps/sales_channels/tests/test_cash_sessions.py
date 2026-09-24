from datetime import datetime, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order
from apps.sales_channels.cash_session_service import CashSessionService
from apps.sales_channels.models import CashSession, SalesChannel


User = get_user_model()
BASE = '/api/v1/sales-channels/cash-sessions/'


class CashSessionAPITests(APITestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Session Co', abbreviation='SES')
        self.brand = Brand.objects.create(company=self.company, name='Session Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Register 1',
            code='REG-1',
            channel_type=SalesChannel.ChannelType.POS,
        )
        self.user = User.objects.create(
            matricule='SES-1',
            email='cashier@session.test',
            is_superuser=True,
            is_staff=True,
            is_active=True,
        )
        self.client.force_authenticate(self.user)

    def open_session(self, amount='200.000'):
        return self.client.post(
            f'{BASE}open/',
            {'sales_channel': self.channel.id, 'opening_cash': amount},
            format='json',
        )

    def test_opening_cash_is_persisted_once_and_not_revenue(self):
        response = self.open_session()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(Decimal(response.data['opening_cash']), Decimal('200.000'))
        self.assertEqual(Decimal(response.data['summary']['revenue']), Decimal('0.000'))
        self.assertEqual(Decimal(response.data['summary']['cash_balance']), Decimal('200.000'))

        duplicate = self.open_session('500.000')
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CashSession.objects.count(), 1)
        self.assertEqual(CashSession.objects.get().opening_cash, Decimal('200.000'))

    def test_split_sale_and_refund_are_separate_financial_events(self):
        self.open_session('100.000')
        now = datetime.now(tz=CashSessionService.business_timezone())
        order = Order.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            pos_sales_channel=self.channel,
            order_number='SESSION-SPLIT-1',
            source=Order.Source.POS,
            status=Order.Status.DONE,
            payment_status=Order.PaymentStatus.PAID,
            payment_method='split',
            total=Decimal('120.00'),
            cash_amount=Decimal('50.000'),
            card_amount=Decimal('70.000'),
            amount_received=Decimal('60.000'),
            change_returned=Decimal('10.000'),
            pos_validated_at=now,
        )

        current = self.client.get(f'{BASE}current/', {'sales_channel': self.channel.id})
        self.assertEqual(Decimal(current.data['summary']['revenue']), Decimal('120.000'))
        self.assertEqual(Decimal(current.data['summary']['cash_sales']), Decimal('50.000'))
        self.assertEqual(Decimal(current.data['summary']['card_sales']), Decimal('70.000'))
        self.assertEqual(Decimal(current.data['summary']['cash_balance']), Decimal('150.000'))

        order.returned_at = now
        order.status = Order.Status.RETURNED
        order.save(update_fields=['returned_at', 'status', 'updated_at'])
        refunded = self.client.get(f'{BASE}current/', {'sales_channel': self.channel.id})
        self.assertEqual(Decimal(refunded.data['summary']['gross_sales']), Decimal('120.000'))
        self.assertEqual(Decimal(refunded.data['summary']['revenue']), Decimal('0.000'))
        self.assertEqual(Decimal(refunded.data['summary']['cash_refunds']), Decimal('50.000'))
        self.assertEqual(Decimal(refunded.data['summary']['card_refunds']), Decimal('70.000'))
        self.assertEqual(Decimal(refunded.data['summary']['cash_balance']), Decimal('100.000'))

    def test_close_snapshots_expected_actual_and_blocks_mutation(self):
        opened = self.open_session('80.000')
        session_id = opened.data['id']
        closed = self.client.post(
            f'{BASE}{session_id}/close/',
            {'closing_cash_actual': '75.000', 'closing_note': 'Cash count'},
            format='json',
        )
        self.assertEqual(closed.status_code, status.HTTP_200_OK, closed.content)
        self.assertEqual(closed.data['status'], CashSession.Status.CLOSED)
        self.assertEqual(Decimal(closed.data['closing_cash_expected']), Decimal('80.000'))
        self.assertEqual(Decimal(closed.data['cash_difference']), Decimal('-5.000'))

        movement = self.client.post(
            '/api/v1/sales-channels/cash-movements/',
            {
                'sales_channel': self.channel.id,
                'movement_type': 'deposit',
                'category': 'TOP_UP',
                'amount': '10.000',
            },
            format='json',
        )
        self.assertEqual(movement.status_code, status.HTTP_400_BAD_REQUEST)

    def test_each_business_day_has_an_independent_unique_session(self):
        tz = CashSessionService.business_timezone()
        today = datetime.now(tz=tz)
        yesterday = today - timedelta(days=1)
        first = CashSessionService.ensure_open(self.channel, actor=self.user, moment=yesterday)
        second = CashSessionService.ensure_open(self.channel, actor=self.user, moment=today)
        duplicate = CashSessionService.ensure_open(self.channel, actor=self.user, moment=today)

        self.assertNotEqual(first.business_date, second.business_date)
        self.assertEqual(second.pk, duplicate.pk)
        self.assertEqual(CashSession.objects.count(), 2)
