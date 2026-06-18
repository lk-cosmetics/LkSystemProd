"""
Tests for the unified caisse CashMovement model + API (the merge of the old
Expense + CashDeposit models into one ``movement_type``-discriminated table).

    python manage.py test apps.sales_channels.tests.test_cash_movements
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.sales_channels.models import CashMovement, SalesChannel

User = get_user_model()
BASE = '/api/v1/sales-channels/cash-movements/'


class CashMovementTests(APITestCase):
    def setUp(self):
        self.company = Company.objects.create(name='CashCo', abbreviation='CSH')
        self.brand = Brand.objects.create(company=self.company, name='CashBrand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='Till 1', code='TILL1', channel_type='POS',
        )
        # Superuser → visible_sales_channel_ids returns None (no scoping), so the
        # caisse is reachable for any channel.
        self.admin = User.objects.create(
            matricule='CSH-1', email='admin@csh.test',
            is_superuser=True, is_staff=True, is_active=True,
        )
        self.client.force_authenticate(self.admin)

    def _post(self, **body):
        return self.client.post(BASE, body, format='json')

    # ── Create + type discriminator ─────────────────────────────────────
    def test_create_expense_and_deposit(self):
        e = self._post(sales_channel=self.channel.id, movement_type='expense',
                       category='SUPPLIES', amount='12.500', note='boxes')
        self.assertEqual(e.status_code, status.HTTP_201_CREATED, e.content)
        self.assertEqual(e.data['movement_type'], 'expense')
        self.assertEqual(e.data['category_display'], 'Supplies / Fournitures')

        d = self._post(sales_channel=self.channel.id, movement_type='deposit',
                       category='OPENING', amount='100.000')
        self.assertEqual(d.status_code, status.HTTP_201_CREATED, d.content)
        self.assertEqual(d.data['movement_type'], 'deposit')

        # ?type filter returns only one side.
        exp_list = self.client.get(BASE, {'type': 'expense', 'sales_channel': self.channel.id})
        dep_list = self.client.get(BASE, {'type': 'deposit', 'sales_channel': self.channel.id})
        self.assertEqual(len(exp_list.data.get('results', exp_list.data)), 1)
        self.assertEqual(len(dep_list.data.get('results', dep_list.data)), 1)

    def test_category_must_match_movement_type(self):
        # OPENING is a deposit category — invalid for an expense.
        bad = self._post(sales_channel=self.channel.id, movement_type='expense',
                         category='OPENING', amount='5.000')
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        # SUPPLIES is an expense category — invalid for a deposit.
        bad2 = self._post(sales_channel=self.channel.id, movement_type='deposit',
                          category='SUPPLIES', amount='5.000')
        self.assertEqual(bad2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_amount_must_be_positive(self):
        bad = self._post(sales_channel=self.channel.id, movement_type='deposit',
                         category='TOP_UP', amount='0')
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)

    # ── Balance math (no sales involved) ────────────────────────────────
    def _stats(self):
        res = self.client.get(f'{BASE}caisse-stats/', {'sales_channel': self.channel.id})
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content)
        return res.data

    def test_caisse_balance_reflects_both_sides(self):
        now = timezone.now()
        CashMovement.objects.create(company=self.company, sales_channel=self.channel,
                                    movement_type='deposit', category='OPENING',
                                    amount=Decimal('100.000'), occurred_at=now)
        CashMovement.objects.create(company=self.company, sales_channel=self.channel,
                                    movement_type='deposit', category='TOP_UP',
                                    amount=Decimal('50.000'), occurred_at=now)
        CashMovement.objects.create(company=self.company, sales_channel=self.channel,
                                    movement_type='expense', category='SUPPLIES',
                                    amount=Decimal('30.000'), occurred_at=now)
        s = self._stats()
        # funding 150 − expenses 30 (no cash sales) = 120
        self.assertEqual(Decimal(s['funding_total']), Decimal('150.000'))
        self.assertEqual(Decimal(s['opening']), Decimal('100.000'))
        self.assertEqual(Decimal(s['expenses']), Decimal('30.000'))
        self.assertEqual(Decimal(s['cash_balance']), Decimal('120.000'))

    # ── Soft delete: balance drops, history keeps a reversal ────────────
    def test_delete_is_soft_and_drops_from_balance(self):
        dep = CashMovement.objects.create(
            company=self.company, sales_channel=self.channel,
            movement_type='deposit', category='TOP_UP',
            amount=Decimal('40.000'), occurred_at=timezone.now(),
        )
        self.assertEqual(Decimal(self._stats()['funding_total']), Decimal('40.000'))

        res = self.client.delete(f'{BASE}{dep.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

        dep.refresh_from_db()
        self.assertTrue(dep.is_deleted)                       # row kept (history)
        self.assertEqual(Decimal(self._stats()['funding_total']), Decimal('0.000'))  # excluded

        # Journal shows the original IN and the reversing OUT (net zero).
        journal = self.client.get(f'{BASE}caisse-journal/', {'sales_channel': self.channel.id})
        types = [m['type'] for m in journal.data['movements']]
        self.assertIn('deposit', types)
        self.assertIn('deposit_deleted', types)

    def test_old_endpoints_are_gone(self):
        # The merge removed the separate /expenses/ and /cash-deposits/ routes.
        self.assertEqual(
            self.client.get('/api/v1/sales-channels/expenses/').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.get('/api/v1/sales-channels/cash-deposits/').status_code,
            status.HTTP_404_NOT_FOUND,
        )
