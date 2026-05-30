"""
Tests for the dynamic, per-company RBAC layer:

* every company owns its own editable copy of each business role;
* editing one company's role never affects another company's same-named role;
* the privilege ceiling blocks granting permissions the actor does not hold.

Run with::

    python manage.py test apps.rbac.tests.test_per_company_rbac
"""

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.exceptions import PermissionDenied

from apps.company.models import Company
from apps.rbac.models import AppPermission, Role, UserRole
from apps.rbac.provisioning import (
    COMPANY_ROLE_TEMPLATES,
    assert_within_ceiling,
    permission_ceiling,
    provision_company_roles,
)

User = get_user_model()


class PerCompanyProvisioningTests(TestCase):
    """Per-company role copies and tenant isolation."""

    def setUp(self):
        # Seed the permission catalogue and the global business templates.
        call_command('seed_rbac', verbosity=0)
        self.company_a = Company.objects.create(name='Alpha Cosmetics', abbreviation='ALP')
        self.company_b = Company.objects.create(name='Beta Beauty', abbreviation='BET')

    def test_provisioning_creates_one_copy_per_template(self):
        created = provision_company_roles(self.company_a)
        self.assertEqual(len(created), len(COMPANY_ROLE_TEMPLATES))

        for name in COMPANY_ROLE_TEMPLATES:
            role = Role.objects.get(name=name, company=self.company_a)
            self.assertFalse(role.is_system)          # editable by the CEO
            self.assertEqual(role.company_id, self.company_a.id)

    def test_provisioning_is_idempotent(self):
        provision_company_roles(self.company_a)
        again = provision_company_roles(self.company_a)
        self.assertEqual(again, [])  # nothing re-created on a second run
        self.assertEqual(
            Role.objects.filter(company=self.company_a).count(),
            len(COMPANY_ROLE_TEMPLATES),
        )

    def test_each_company_gets_distinct_role_rows(self):
        provision_company_roles(self.company_a)
        provision_company_roles(self.company_b)

        a_bm = Role.objects.get(name='Brand Manager', company=self.company_a)
        b_bm = Role.objects.get(name='Brand Manager', company=self.company_b)
        self.assertNotEqual(a_bm.id, b_bm.id)

    def test_editing_one_company_role_does_not_touch_another(self):
        provision_company_roles(self.company_a)
        provision_company_roles(self.company_b)

        a_bm = Role.objects.get(name='Brand Manager', company=self.company_a)
        b_bm = Role.objects.get(name='Brand Manager', company=self.company_b)
        b_perms_before = set(b_bm.permissions.values_list('codename', flat=True))

        # CEO of company A strips every permission from their Brand Manager.
        a_bm.permissions.clear()

        b_perms_after = set(
            Role.objects.get(pk=b_bm.pk).permissions.values_list('codename', flat=True)
        )
        self.assertEqual(b_perms_before, b_perms_after)
        self.assertGreater(len(b_perms_after), 0)

    def test_manager_role_grants_financial_reports(self):
        """Company Managers can see revenue: the Manager template now grants
        ``can_view_financial_reports`` (alongside Super Admin and CEO)."""
        provision_company_roles(self.company_a)
        manager = Role.objects.get(name='Manager', company=self.company_a)
        self.assertIn(
            'can_view_financial_reports',
            set(manager.permissions.values_list('codename', flat=True)),
        )


class PrivilegeCeilingTests(TestCase):
    """A non-platform actor can never grant a permission they do not hold."""

    def setUp(self):
        self.company = Company.objects.create(name='Gamma', abbreviation='GAM')
        self.perm_a = AppPermission.objects.create(
            codename='demo_perm_a', name='Demo A', category='demo'
        )
        self.perm_b = AppPermission.objects.create(
            codename='demo_perm_b', name='Demo B', category='demo'
        )

        # A company-scoped role holding only perm_a.
        self.role = Role.objects.create(
            name='Limited Manager', company=self.company, scope_type='company'
        )
        self.role.permissions.set([self.perm_a])

        self.ceo = User.objects.create(
            matricule='GAM-0001', email='ceo@gamma.test',
            current_company=self.company, is_active=True,
        )
        UserRole.objects.create(
            user=self.ceo, role=self.role, company=self.company
        )

        self.root = User.objects.create(
            matricule='ROOT-0001', email='root@gamma.test',
            is_active=True, is_superuser=True, is_staff=True,
        )

    def test_ceiling_is_the_actors_own_permissions(self):
        self.assertEqual(permission_ceiling(self.ceo), {'demo_perm_a'})

    def test_superuser_has_no_ceiling(self):
        self.assertIsNone(permission_ceiling(self.root))

    def test_grant_within_ceiling_passes(self):
        # Should not raise.
        assert_within_ceiling(self.ceo, ['demo_perm_a'])

    def test_grant_above_ceiling_is_blocked(self):
        with self.assertRaises(PermissionDenied):
            assert_within_ceiling(self.ceo, ['demo_perm_a', 'demo_perm_b'])

    def test_superuser_can_grant_anything(self):
        # Should not raise even for a permission no role holds.
        assert_within_ceiling(self.root, ['demo_perm_a', 'demo_perm_b'])
