"""
Tests for the notifications app.

Covered behaviour (the hard requirements from the brief):

* **Role targeting** — a notification reaches exactly the mapped roles, never
  "everyone".
* **Tenant isolation** — audiences are resolved within the notification's
  company; another company's users never receive a row.
* **Platform admins** — Super Admins are included when asked, excluded when not.
* **Per-user read state** — mark-read / mark-all-read / unread-count all act on
  the current user only.
* **API scoping** — the list shows only the caller's inbox; a user cannot mark
  another user's row.
* **Event mapping** — each event helper targets the right roles, category and
  priority.

Run with::

    python manage.py test apps.notifications
"""

from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.company.models import Company
from apps.rbac.models import Role, UserRole
from apps.rbac.provisioning import provision_company_roles

from apps.notifications.models import Notification, NotificationRecipient
from apps.notifications.services import (
    AUDIENCE_ADMIN,
    AUDIENCE_MANAGEMENT,
    AUDIENCE_OPERATIONS,
    NotificationService,
)

User = get_user_model()


def _order_stub(company_id, *, pk=1, number='ORD-1', return_type=''):
    return SimpleNamespace(
        id=pk, company_id=company_id, order_number=number, return_type=return_type,
    )


class NotificationTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_rbac', verbosity=0)

        cls.company_a = Company.objects.create(name='Alpha', abbreviation='ALP')
        cls.company_b = Company.objects.create(name='Beta', abbreviation='BET')
        provision_company_roles(cls.company_a)
        provision_company_roles(cls.company_b)

        def role(name, company):
            return Role.objects.get(name=name, company=company)

        def user(matricule, email, company):
            return User.objects.create(
                matricule=matricule, email=email,
                current_company=company, is_active=True,
            )

        # Company A users
        cls.ceo_a = user('A-CEO', 'ceo@a.test', cls.company_a)
        cls.manager_a = user('A-MGR', 'mgr@a.test', cls.company_a)
        cls.employee_a = user('A-EMP', 'emp@a.test', cls.company_a)
        UserRole.objects.create(user=cls.ceo_a, role=role('CEO', cls.company_a), company=cls.company_a)
        UserRole.objects.create(user=cls.manager_a, role=role('Manager', cls.company_a), company=cls.company_a)
        UserRole.objects.create(user=cls.employee_a, role=role('Employee', cls.company_a), company=cls.company_a)

        # Company B user (must never receive company A notifications)
        cls.ceo_b = user('B-CEO', 'ceo@b.test', cls.company_b)
        UserRole.objects.create(user=cls.ceo_b, role=role('CEO', cls.company_b), company=cls.company_b)

        # Platform Super Admin (company NULL)
        sa_role, _ = Role.objects.get_or_create(
            name='Super Admin', company=None,
            defaults={'scope_type': 'platform', 'is_system': True},
        )
        cls.super_admin = User.objects.create(
            matricule='ROOT', email='root@platform.test',
            is_active=True, is_staff=True, is_superuser=True,
        )
        UserRole.objects.create(user=cls.super_admin, role=sa_role, company=None)


class AudienceResolutionTests(NotificationTestBase):
    def test_management_is_ceo_and_manager_only(self):
        users = set(
            NotificationService.resolve_users(
                self.company_a.id, AUDIENCE_MANAGEMENT, include_platform_admins=False,
            ).values_list('id', flat=True)
        )
        self.assertEqual(users, {self.ceo_a.id, self.manager_a.id})

    def test_operations_is_employee_only(self):
        users = set(
            NotificationService.resolve_users(
                self.company_a.id, AUDIENCE_OPERATIONS, include_platform_admins=False,
            ).values_list('id', flat=True)
        )
        self.assertEqual(users, {self.employee_a.id})

    def test_tenant_isolation(self):
        users = set(
            NotificationService.resolve_users(
                self.company_a.id, AUDIENCE_MANAGEMENT, include_platform_admins=True,
            ).values_list('id', flat=True)
        )
        self.assertNotIn(self.ceo_b.id, users)

    def test_platform_admins_included_only_when_requested(self):
        with_admins = set(
            NotificationService.resolve_users(
                self.company_a.id, AUDIENCE_MANAGEMENT, include_platform_admins=True,
            ).values_list('id', flat=True)
        )
        without_admins = set(
            NotificationService.resolve_users(
                self.company_a.id, AUDIENCE_MANAGEMENT, include_platform_admins=False,
            ).values_list('id', flat=True)
        )
        self.assertIn(self.super_admin.id, with_admins)
        self.assertNotIn(self.super_admin.id, without_admins)


class FanOutTests(NotificationTestBase):
    def test_notify_creates_one_row_per_resolved_user(self):
        with self.captureOnCommitCallbacks(execute=True):
            NotificationService.notify(
                company=self.company_a.id,
                category=Notification.Category.ORDER,
                title='hi', role_names=AUDIENCE_MANAGEMENT,
                include_platform_admins=False,
            )
        notif = Notification.objects.get()
        recipients = set(notif.recipients.values_list('user_id', flat=True))
        self.assertEqual(recipients, {self.ceo_a.id, self.manager_a.id})
        self.assertEqual(notif.company_id, self.company_a.id)

    def test_company_b_user_never_receives_company_a_event(self):
        with self.captureOnCommitCallbacks(execute=True):
            NotificationService.notify(
                company=self.company_a.id,
                category=Notification.Category.ORDER,
                title='hi', role_names=AUDIENCE_MANAGEMENT,
                include_platform_admins=True,
            )
        self.assertFalse(
            NotificationRecipient.objects.filter(user=self.ceo_b).exists()
        )

    def test_exclude_actor(self):
        with self.captureOnCommitCallbacks(execute=True):
            NotificationService.notify(
                company=self.company_a.id,
                category=Notification.Category.ORDER,
                title='hi', role_names=AUDIENCE_MANAGEMENT,
                include_platform_admins=False, created_by=self.ceo_a,
                exclude_actor=True,
            )
        recipients = set(
            NotificationRecipient.objects.values_list('user_id', flat=True)
        )
        self.assertEqual(recipients, {self.manager_a.id})

    def test_no_recipients_creates_nothing(self):
        empty_company = Company.objects.create(name='Empty', abbreviation='EMP')
        provision_company_roles(empty_company)
        with self.captureOnCommitCallbacks(execute=True):
            NotificationService.notify(
                company=empty_company.id,
                category=Notification.Category.ORDER,
                title='hi', role_names=AUDIENCE_MANAGEMENT,
                include_platform_admins=False,
            )
        self.assertEqual(Notification.objects.count(), 0)


class EventMappingTests(NotificationTestBase):
    def _run(self, fn, *args, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            fn(*args, **kwargs)
        return Notification.objects.latest('id')

    def test_order_imported_targets_management_and_operations(self):
        notif = self._run(NotificationService.order_imported, _order_stub(self.company_a.id))
        recipients = set(notif.recipients.values_list('user_id', flat=True))
        self.assertEqual(
            recipients,
            {self.ceo_a.id, self.manager_a.id, self.employee_a.id, self.super_admin.id},
        )
        self.assertEqual(notif.category, Notification.Category.ORDER)

    def test_order_confirmed_targets_operations(self):
        notif = self._run(NotificationService.order_confirmed, _order_stub(self.company_a.id))
        recipients = set(notif.recipients.values_list('user_id', flat=True))
        self.assertEqual(recipients, {self.employee_a.id})

    def test_wc_sync_failed_is_high_priority_management(self):
        notif = self._run(NotificationService.wc_sync_failed, _order_stub(self.company_a.id))
        self.assertEqual(notif.category, Notification.Category.SYNC)
        self.assertEqual(notif.priority, Notification.Priority.HIGH)
        recipients = set(notif.recipients.values_list('user_id', flat=True))
        self.assertEqual(recipients, {self.ceo_a.id, self.manager_a.id, self.super_admin.id})

    def test_settings_changed_targets_admin_only(self):
        setting = SimpleNamespace(id=5, company_id=self.company_a.id)
        notif = self._run(NotificationService.settings_changed, setting)
        self.assertEqual(notif.category, Notification.Category.SYSTEM)
        recipients = set(notif.recipients.values_list('user_id', flat=True))
        # CEO + platform Super Admin, but NOT the Manager.
        self.assertIn(self.ceo_a.id, recipients)
        self.assertNotIn(self.manager_a.id, recipients)

    def test_exchange_uses_exchange_category(self):
        notif = self._run(
            NotificationService.order_return_created,
            _order_stub(self.company_a.id), is_exchange=True,
        )
        self.assertEqual(notif.category, Notification.Category.EXCHANGE)


class PerUserStateAndApiTests(NotificationTestBase):
    def setUp(self):
        self.client = APIClient()

    def _make(self, users, *, category='order', priority='normal', is_read=False):
        notif = Notification.objects.create(
            company=self.company_a, category=category, priority=priority,
            title='t', body='b', target_type='multi_role',
        )
        for u in users:
            NotificationRecipient.objects.create(
                notification=notif, user=u, category=category,
                priority=priority, created_at=notif.created_at, is_read=is_read,
            )
        return notif

    def test_list_is_scoped_to_current_user(self):
        self._make([self.ceo_a, self.manager_a])
        self._make([self.manager_a])  # ceo_a not a recipient

        self.client.force_authenticate(self.ceo_a)
        resp = self.client.get('/api/v1/notifications/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 1)

    def test_unread_count_is_per_user(self):
        self._make([self.ceo_a, self.manager_a])
        self._make([self.ceo_a])

        self.client.force_authenticate(self.ceo_a)
        resp = self.client.get('/api/v1/notifications/unread-count/')
        self.assertEqual(resp.data['unread'], 2)

        self.client.force_authenticate(self.manager_a)
        resp = self.client.get('/api/v1/notifications/unread-count/')
        self.assertEqual(resp.data['unread'], 1)

    def test_mark_read_affects_only_current_user(self):
        notif = self._make([self.ceo_a, self.manager_a])
        ceo_row = notif.recipients.get(user=self.ceo_a)
        mgr_row = notif.recipients.get(user=self.manager_a)

        self.client.force_authenticate(self.ceo_a)
        resp = self.client.post(f'/api/v1/notifications/{ceo_row.id}/mark-read/')
        self.assertEqual(resp.status_code, 200)

        ceo_row.refresh_from_db()
        mgr_row.refresh_from_db()
        self.assertTrue(ceo_row.is_read)
        self.assertFalse(mgr_row.is_read)  # the other user is untouched

    def test_cannot_mark_another_users_row(self):
        notif = self._make([self.manager_a])
        mgr_row = notif.recipients.get(user=self.manager_a)

        self.client.force_authenticate(self.ceo_a)
        resp = self.client.post(f'/api/v1/notifications/{mgr_row.id}/mark-read/')
        self.assertEqual(resp.status_code, 404)

        mgr_row.refresh_from_db()
        self.assertFalse(mgr_row.is_read)

    def test_mark_all_read_only_current_user(self):
        self._make([self.ceo_a, self.manager_a])
        self._make([self.ceo_a, self.manager_a])

        self.client.force_authenticate(self.ceo_a)
        resp = self.client.post('/api/v1/notifications/mark-all-read/')
        self.assertEqual(resp.data['updated'], 2)

        self.assertEqual(
            NotificationRecipient.objects.filter(user=self.ceo_a, is_read=False).count(), 0,
        )
        self.assertEqual(
            NotificationRecipient.objects.filter(user=self.manager_a, is_read=False).count(), 2,
        )

    def test_filters_unread_and_category(self):
        self._make([self.ceo_a], category='order', is_read=False)
        self._make([self.ceo_a], category='stock', is_read=True)

        self.client.force_authenticate(self.ceo_a)

        resp = self.client.get('/api/v1/notifications/?is_read=false')
        self.assertEqual(resp.data['count'], 1)

        resp = self.client.get('/api/v1/notifications/?category=stock')
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['category'], 'stock')

    def test_requires_authentication(self):
        resp = self.client.get('/api/v1/notifications/')
        self.assertIn(resp.status_code, (401, 403))
