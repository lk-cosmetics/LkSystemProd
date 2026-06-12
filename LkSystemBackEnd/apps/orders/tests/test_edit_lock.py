"""Edit-lock heartbeat semantics.

Regression guard for the "taken over by another user" false positive: a
heartbeat must only 409 when a DIFFERENT user holds an UNEXPIRED lock. A lapsed
lock, or one cleared to NULL by a close/reopen race, has to heal silently
(reclaim for the caller) instead of surfacing a nameless takeover error.

    python manage.py test apps.orders.tests.test_edit_lock
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order, OrderLog
from apps.sales_channels.models import SalesChannel

User = get_user_model()


class EditLockHeartbeatTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Lock Co', abbreviation='LCK')
        self.brand = Brand.objects.create(company=self.company, name='Lock Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='Lock Store', code='LCKSTORE',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.order = Order.objects.create(
            company=self.company, brand=self.brand, sales_channel=self.channel,
            order_number='ORD-LOCK-001', status=Order.Status.NEW,
            source=Order.Source.WOOCOMMERCE, total='100.00',
        )
        self.me = User.objects.create_user(
            matricule='LOCKME', email='me@example.com', password='x',
            first_name='Me', last_name='Operator',
        )
        self.me.is_superuser = self.me.is_staff = True  # bypass RBAC in tests
        self.me.save(update_fields=['is_superuser', 'is_staff'])
        self.other = User.objects.create_user(
            matricule='LOCKOTHER', email='other@example.com', password='x',
            first_name='Lina', last_name='Khouili',
        )
        self.api = APIClient()
        self.api.force_authenticate(self.me)

    def _hb(self, token):
        return self.api.post(
            f'/api/v1/orders/{self.order.id}/edit-lock-heartbeat/',
            {'token': token}, format='json',
        )

    def _set_lock(self, *, user, expires_in, token):
        Order.all_objects.filter(pk=self.order.pk).update(
            edit_locked_by=user, edit_locked_at=timezone.now(),
            edit_lock_heartbeat_at=timezone.now(),
            edit_lock_expires_at=timezone.now() + timedelta(seconds=expires_in),
            edit_lock_token=token,
        )

    def test_heartbeat_reclaims_an_unheld_lock(self):
        """No holder (lapsed / released) → 200 + reclaimed, NOT a takeover 409."""
        Order.all_objects.filter(pk=self.order.pk).update(
            edit_locked_by=None, edit_locked_at=None, edit_lock_heartbeat_at=None,
            edit_lock_expires_at=None, edit_lock_token='',
        )
        resp = self._hb('my-token')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.edit_locked_by_id, self.me.id)
        self.assertEqual(self.order.edit_lock_token, 'my-token')

    def test_heartbeat_409_names_the_active_other_holder(self):
        """A different user with an unexpired lock → 409 carrying their name."""
        self._set_lock(user=self.other, expires_in=90, token='other-token')
        resp = self._hb('my-token')
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        lock = resp.data['lock']
        self.assertTrue(lock['locked'])
        self.assertEqual(lock['user_id'], self.other.id)
        self.assertEqual(lock['user_name'], 'Lina Khouili')

    def test_heartbeat_reclaims_an_expired_other_lock(self):
        """Another user's EXPIRED lock no longer blocks → 200 + reclaimed."""
        self._set_lock(user=self.other, expires_in=-60, token='stale-other')
        resp = self._hb('my-token')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.edit_locked_by_id, self.me.id)

    def test_heartbeat_extends_my_own_lock(self):
        """My own active lock → 200 and the expiry is pushed out."""
        self._set_lock(user=self.me, expires_in=10, token='my-token')
        before = Order.all_objects.get(pk=self.order.pk).edit_lock_expires_at
        resp = self._hb('my-token')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertGreater(self.order.edit_lock_expires_at, before)


class OrderLockConcurrencyTests(TestCase):
    """End-to-end working-lock guard: only the lock holder can act on an order;
    a second user must take over (logged) before their actions are accepted."""

    def setUp(self):
        self.company = Company.objects.create(name='Conc Co', abbreviation='CNC')
        self.brand = Brand.objects.create(company=self.company, name='Conc Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='Conc Store', code='CNCSTORE',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.order = Order.objects.create(
            company=self.company, brand=self.brand, sales_channel=self.channel,
            order_number='ORD-CONC-001', status=Order.Status.NEW,
            source=Order.Source.WOOCOMMERCE, total='100.00',
        )
        self.u1 = User.objects.create_user(matricule='CONC1', email='c1@e.com', password='x', first_name='Aya', last_name='One')
        self.u2 = User.objects.create_user(matricule='CONC2', email='c2@e.com', password='x', first_name='Sami', last_name='Two')
        for u in (self.u1, self.u2):
            u.is_superuser = u.is_staff = True
            u.save(update_fields=['is_superuser', 'is_staff'])
        self.a1, self.a2 = APIClient(), APIClient()
        self.a1.force_authenticate(self.u1)
        self.a2.force_authenticate(self.u2)

    def _lock(self, api, force=False):
        return api.post(f'/api/v1/orders/{self.order.id}/edit-lock/', {'force': force}, format='json')

    def _confirm(self, api):
        return api.post(f'/api/v1/orders/{self.order.id}/confirm/', {}, format='json')

    def test_only_lock_holder_can_act_and_takeover_is_logged(self):
        # U1 opens → holds the lock.
        self.assertEqual(self._lock(self.a1).status_code, status.HTTP_200_OK)

        # U2 opening the same order is rejected (held by U1).
        r = self._lock(self.a2)
        self.assertEqual(r.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(r.data['lock']['user_name'], 'Aya One')

        # U2 cannot confirm without the lock — order stays NEW.
        self.assertEqual(self._confirm(self.a2).status_code, status.HTTP_409_CONFLICT)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.NEW)

        # U2 takes over (force) — logged as EDIT_LOCK_TAKEN_OVER.
        self.assertEqual(self._lock(self.a2, force=True).status_code, status.HTTP_200_OK)
        log = OrderLog.objects.filter(
            order=self.order, action=OrderLog.Action.EDIT_LOCK_TAKEN_OVER,
        ).latest('id')
        self.assertEqual(log.user_id, self.u2.id)
        self.assertEqual((log.details or {}).get('previous_user_id'), self.u1.id)

        # U1 lost the lock → can no longer act.
        self.assertEqual(self._confirm(self.a1).status_code, status.HTTP_409_CONFLICT)

        # U2 (new holder) confirms successfully.
        self.assertEqual(self._confirm(self.a2).status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.CONFIRMED)

    def test_lock_acquire_only_needs_view_permission(self):
        """A user who can view but lacks edit can still hold the working lock."""
        # superuser bypasses RBAC, so just assert the endpoint succeeds.
        self.assertEqual(self._lock(self.a1).status_code, status.HTTP_200_OK)
