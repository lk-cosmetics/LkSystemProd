"""
Regression tests for sales-point (``assigned_sales_channel``) handling and CIN
normalisation — covering the issues found in the user-management code review:

* ``/users/me/`` must not let a user change their own sales-point pin;
* ``UpdateUserSerializer`` validates the channel against company, the user's
  brands (even when they have none), and the editing actor's reach;
* the channel-scoped role row is re-pointed coherently (company+brand+channel);
* ``set-role`` clears the pin for a non-operational role and keeps it for a
  Cashier; a tenant move drops a stale cross-tenant pin;
* the create path normalises blank/whitespace CIN to NULL and returns a clean
  400 (not a 500) on a duplicate CIN.

Run with::

    python manage.py test apps.users.tests.test_user_sales_point
"""

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.brands.models import Brand
from apps.company.models import Company
from apps.rbac.api.views import AssignmentViewSet
from apps.rbac.models import Role, UserRole
from apps.rbac.provisioning import provision_company_roles
from apps.sales_channels.models import SalesChannel
from apps.users.api.serializers import CreateEmployeeSerializer, UpdateUserSerializer
from apps.users.api.views import UserViewSet
from apps.users.models.profile import normalize_cin

User = get_user_model()


def _ctx(actor):
    """Serializer context carrying ``actor`` as request.user."""
    req = APIRequestFactory().patch('/api/v1/users/x/')
    req.user = actor
    return {'request': req}


class SalesPointAndCinTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_rbac', verbosity=0)
        cls.company = Company.objects.create(name='Alpha', abbreviation='ALP')
        cls.other = Company.objects.create(name='Beta', abbreviation='BET')
        provision_company_roles(cls.company)
        provision_company_roles(cls.other)

        cls.brand1 = Brand.objects.create(company=cls.company, name='B1')
        cls.brand2 = Brand.objects.create(company=cls.company, name='B2')
        cls.other_brand = Brand.objects.create(company=cls.other, name='OB')

        cls.ch1 = SalesChannel.objects.create(brand=cls.brand1, name='POS1', channel_type='POS')
        cls.ch2 = SalesChannel.objects.create(brand=cls.brand2, name='POS2', channel_type='POS')
        cls.other_ch = SalesChannel.objects.create(brand=cls.other_brand, name='OPOS', channel_type='POS')

        cls.cashier_role = Role.objects.get(name='Cashier', company=cls.company)
        cls.manager_role = Role.objects.get(name='Manager', company=cls.company)

        # Platform admin actor (skips the actor-scope check, isolating the
        # company/brand validation under test).
        cls.admin = User.objects.create(
            matricule='ADM', email='admin@x.com',
            is_superuser=True, is_staff=True, current_company=cls.company,
        )

    _seq = 0

    def _make_user(self, brands=(), channel=None):
        type(self)._seq += 1
        u = User.objects.create(
            matricule=f'U{self._seq}', email=f'u{self._seq}@x.com',
            current_company=self.company,
        )
        if brands:
            u.allowed_brands.set(brands)
        if channel is not None:
            u.assigned_sales_channel = channel
            u.save(update_fields=['assigned_sales_channel'])
        return u

    # ── UpdateUserSerializer validation ─────────────────────────────────
    def test_rejects_cross_company_channel(self):
        u = self._make_user(brands=[self.brand1])
        s = UpdateUserSerializer(u, data={'assigned_sales_channel': self.other_ch.id},
                                 partial=True, context=_ctx(self.admin))
        self.assertFalse(s.is_valid())
        self.assertIn('assigned_sales_channel', s.errors)

    def test_rejects_channel_outside_user_brands(self):
        u = self._make_user(brands=[self.brand1])  # only brand1
        s = UpdateUserSerializer(u, data={'assigned_sales_channel': self.ch2.id},  # ch2 ∈ brand2
                                 partial=True, context=_ctx(self.admin))
        self.assertFalse(s.is_valid())
        self.assertIn('assigned_sales_channel', s.errors)

    def test_rejects_channel_when_user_has_no_brands(self):
        u = self._make_user(brands=[])
        s = UpdateUserSerializer(u, data={'assigned_sales_channel': self.ch1.id},
                                 partial=True, context=_ctx(self.admin))
        self.assertFalse(s.is_valid())  # brand check is no longer skipped when empty

    def test_accepts_channel_in_user_brand(self):
        u = self._make_user(brands=[self.brand1])
        s = UpdateUserSerializer(u, data={'assigned_sales_channel': self.ch1.id},
                                 partial=True, context=_ctx(self.admin))
        self.assertTrue(s.is_valid(), s.errors)

    def test_non_platform_actor_cannot_pin_channel_outside_reach(self):
        # Brand Manager scoped to brand1; tries to pin a user to ch2 (brand2).
        bm = self._make_user(brands=[self.brand1])
        UserRole.objects.create(
            user=bm, role=Role.objects.get(name='Brand Manager', company=self.company),
            company=self.company, brand=self.brand1,
        )
        target = self._make_user(brands=[self.brand1, self.brand2])
        s = UpdateUserSerializer(target, data={'assigned_sales_channel': self.ch2.id},
                                 partial=True, context=_ctx(bm))
        self.assertFalse(s.is_valid())
        self.assertIn('assigned_sales_channel', s.errors)

    # ── update() re-targets channel-scoped roles coherently ─────────────
    def test_update_repoints_channel_role_coherently(self):
        u = self._make_user(brands=[self.brand1, self.brand2], channel=self.ch1)
        ur = UserRole.objects.create(
            user=u, role=self.cashier_role, company=self.company,
            brand=self.brand1, sales_channel=self.ch1,
        )
        s = UpdateUserSerializer(u, data={'assigned_sales_channel': self.ch2.id},
                                 partial=True, context=_ctx(self.admin))
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        ur.refresh_from_db()
        self.assertEqual(ur.sales_channel_id, self.ch2.id)
        self.assertEqual(ur.brand_id, self.brand2.id)
        self.assertEqual(ur.company_id, self.company.id)

    # ── /users/me/ may not change the sales-point pin ───────────────────
    def test_me_cannot_set_assigned_sales_channel(self):
        u = self._make_user(brands=[self.brand1])
        req = APIRequestFactory().patch(
            '/api/v1/users/me/', {'assigned_sales_channel': self.ch1.id}, format='json')
        force_authenticate(req, user=u)
        resp = UserViewSet.as_view({'patch': 'me'})(req)
        self.assertEqual(resp.status_code, 200)
        u.refresh_from_db()
        self.assertIsNone(u.assigned_sales_channel_id)

    # ── set-role owns the sales-point lifecycle ─────────────────────────
    def _set_role(self, target, role):
        req = APIRequestFactory().post(
            '/api/v1/rbac/assignments/set-role/',
            {'user_id': target.id, 'role_id': role.id}, format='json')
        force_authenticate(req, user=self.admin)
        return AssignmentViewSet.as_view({'post': 'set_role'})(req)

    def test_set_role_clears_sales_point_for_managerial_role(self):
        u = self._make_user(brands=[self.brand1], channel=self.ch1)
        UserRole.objects.create(user=u, role=self.cashier_role,
                                company=self.company, sales_channel=self.ch1)
        resp = self._set_role(u, self.manager_role)
        self.assertEqual(resp.status_code, 200, resp.data)
        u.refresh_from_db()
        self.assertIsNone(u.assigned_sales_channel_id)

    def test_set_role_keeps_sales_point_for_cashier(self):
        u = self._make_user(brands=[self.brand1], channel=self.ch1)
        resp = self._set_role(u, self.cashier_role)
        self.assertEqual(resp.status_code, 200, resp.data)
        u.refresh_from_db()
        self.assertEqual(u.assigned_sales_channel_id, self.ch1.id)

    # ── tenant move drops a stale cross-tenant pin ──────────────────────
    def test_company_move_clears_stale_sales_point(self):
        u = self._make_user(brands=[self.brand1], channel=self.ch1)
        s = UpdateUserSerializer(
            u, data={'current_company': self.other.id, 'allowed_brands': [self.other_brand.id]},
            partial=True, context=_ctx(self.admin))
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        u.refresh_from_db()
        self.assertEqual(u.current_company_id, self.other.id)
        self.assertIsNone(u.assigned_sales_channel_id)

    # ── CIN normalisation + duplicate handling ──────────────────────────
    def test_normalize_cin_helper(self):
        self.assertIsNone(normalize_cin(None))
        self.assertIsNone(normalize_cin(''))
        self.assertIsNone(normalize_cin('   '))
        self.assertEqual(normalize_cin('  AB12  '), 'AB12')

    def test_profile_save_normalises_whitespace_cin(self):
        u = self._make_user()
        p = u.profile  # auto-created by signal
        p.cin_number = '   '
        p.save()
        p.refresh_from_db()
        self.assertIsNone(p.cin_number)

    def _create_payload(self, **over):
        data = {
            'email': over.pop('email', 'new@x.com'),
            'password': 'Str0ng!Passw0rd', 'password_confirm': 'Str0ng!Passw0rd',
            'first_name': 'New', 'last_name': 'User',
            'current_company': self.company.id,
        }
        data.update(over)
        return data

    def test_create_employee_duplicate_cin_returns_400(self):
        existing = self._make_user()
        existing.profile.cin_number = 'AB12345'
        existing.profile.save()
        s = CreateEmployeeSerializer(
            data=self._create_payload(cin_number='AB12345'), context=_ctx(self.admin))
        self.assertFalse(s.is_valid())
        self.assertIn('cin_number', s.errors)

    def test_create_employee_whitespace_cin_stored_null(self):
        s = CreateEmployeeSerializer(
            data=self._create_payload(email='ws@x.com', cin_number='   '),
            context=_ctx(self.admin))
        self.assertTrue(s.is_valid(), s.errors)
        user = s.save()
        self.assertIsNone(user.profile.cin_number)
