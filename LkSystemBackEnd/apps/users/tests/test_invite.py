"""
Authorization tests for the user-invitation flow (role + scope assignment).

Exercises ``InviteEmployeeSerializer`` validation directly (the security
surface) without triggering the e-mail side effect. Proves the brief's rules:

* an inviter can only invite into a company where they hold ``create_users``;
* the assigned role must belong to that company (tenant isolation);
* an inviter cannot assign a role that outranks their own (no Super Admin);
* a brand-scoped role requires a brand, and the brand must belong to the company.

Run with::

    python manage.py test apps.users.tests.test_invite
"""

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.brands.models import Brand
from apps.company.models import Company
from apps.rbac.models import Role, UserRole
from apps.rbac.provisioning import provision_company_roles
from apps.users.api.serializers import InviteEmployeeSerializer

User = get_user_model()


def _context(user):
    request = APIRequestFactory().post('/api/v1/users/invite/')
    request.user = user
    return {'request': request}


class InviteAuthorizationTests(TestCase):
    def setUp(self):
        call_command('seed_rbac', verbosity=0)
        self.company_a = Company.objects.create(name='Alpha', abbreviation='ALP')
        self.company_b = Company.objects.create(name='Beta', abbreviation='BET')
        provision_company_roles(self.company_a)
        provision_company_roles(self.company_b)

        self.brand_a1 = Brand.objects.create(company=self.company_a, name='A1')
        self.brand_b1 = Brand.objects.create(company=self.company_b, name='B1')

        self.ceo_role_a = Role.objects.get(name='CEO', company=self.company_a)
        self.employee_a = Role.objects.get(name='Employee', company=self.company_a)
        self.brand_mgr_a = Role.objects.get(name='Brand Manager', company=self.company_a)
        self.employee_b = Role.objects.get(name='Employee', company=self.company_b)
        self.super_admin = Role.objects.get(name='Super Admin', company__isnull=True)

        self.ceo = User.objects.create(
            matricule='ALP-CEO', email='ceo@alp.test',
            current_company=self.company_a, is_active=True,
        )
        UserRole.objects.create(
            user=self.ceo, role=self.ceo_role_a, company=self.company_a
        )

    def _check(self, data):
        serializer = InviteEmployeeSerializer(data=data, context=_context(self.ceo))
        return serializer.is_valid(), serializer.errors

    def test_invite_employee_into_own_company_is_valid(self):
        ok, errors = self._check({
            'email': 'e1@x.com', 'role_id': self.employee_a.id,
            'company_id': self.company_a.id,
        })
        self.assertTrue(ok, errors)

    def test_cannot_invite_into_another_company(self):
        # CEO holds create_users only in company A, not company B.
        ok, _ = self._check({
            'email': 'e2@x.com', 'role_id': self.employee_b.id,
            'company_id': self.company_b.id,
        })
        self.assertFalse(ok)

    def test_cannot_assign_role_from_another_company(self):
        # Company A target, but a role owned by company B → tenant isolation.
        ok, errors = self._check({
            'email': 'e3@x.com', 'role_id': self.employee_b.id,
            'company_id': self.company_a.id,
        })
        self.assertFalse(ok)
        self.assertIn('role_id', errors)

    def test_cannot_invite_platform_role(self):
        ok, errors = self._check({
            'email': 'e4@x.com', 'role_id': self.super_admin.id,
            'company_id': self.company_a.id,
        })
        self.assertFalse(ok)
        self.assertIn('role_id', errors)

    def test_brand_scoped_role_requires_a_brand(self):
        ok, errors = self._check({
            'email': 'e5@x.com', 'role_id': self.brand_mgr_a.id,
            'company_id': self.company_a.id,
        })
        self.assertFalse(ok)
        self.assertIn('brand_ids', errors)

    def test_brand_scoped_role_rejects_foreign_brand(self):
        ok, errors = self._check({
            'email': 'e6@x.com', 'role_id': self.brand_mgr_a.id,
            'company_id': self.company_a.id, 'brand_ids': [self.brand_b1.id],
        })
        self.assertFalse(ok)
        self.assertIn('brand_ids', errors)

    def test_brand_scoped_role_with_valid_brand_is_valid(self):
        ok, errors = self._check({
            'email': 'e7@x.com', 'role_id': self.brand_mgr_a.id,
            'company_id': self.company_a.id, 'brand_ids': [self.brand_a1.id],
        })
        self.assertTrue(ok, errors)
