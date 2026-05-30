"""
Tests for workspace switching and tenant isolation.

Run with::

    python manage.py test apps.users.tests.test_workspace
"""

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.rbac.models import Role, UserRole
from apps.rbac.services import visible_brand_ids
from apps.users.workspace import WorkspaceService, WorkspaceError

User = get_user_model()


class WorkspaceSwitchTests(TestCase):
    def setUp(self):
        self.company_a = Company.objects.create(name='Alpha', abbreviation='ALP')
        self.company_b = Company.objects.create(name='Beta', abbreviation='BET')
        self.brand_a1 = Brand.objects.create(company=self.company_a, name='A1')
        self.brand_b1 = Brand.objects.create(company=self.company_b, name='B1')

        # A CEO of company A (company-scoped role assigned at company A).
        self.ceo_role = Role.objects.create(
            name='CEO', company=self.company_a, scope_type='company'
        )
        self.ceo = User.objects.create(
            matricule='ALP-0001', email='ceo@alpha.test',
            current_company=self.company_a, is_active=True,
        )
        UserRole.objects.create(
            user=self.ceo, role=self.ceo_role, company=self.company_a
        )

        self.root = User.objects.create(
            matricule='ROOT-0001', email='root@test.test',
            is_active=True, is_superuser=True, is_staff=True,
        )

    # ── Switchable set derivation ──────────────────────────────────────

    def test_ceo_can_only_switch_into_own_company(self):
        ids = WorkspaceService.switchable_company_ids(self.ceo)
        self.assertEqual(ids, {self.company_a.id})

    def test_superuser_can_switch_into_any_company(self):
        self.assertIsNone(WorkspaceService.switchable_company_ids(self.root))

    # ── Switch validation ──────────────────────────────────────────────

    def test_switch_into_own_company_succeeds(self):
        WorkspaceService.switch(self.ceo, company_id=self.company_a.id)
        self.ceo.refresh_from_db()
        self.assertEqual(self.ceo.current_company_id, self.company_a.id)

    def test_switch_into_foreign_company_is_blocked(self):
        with self.assertRaises(WorkspaceError):
            WorkspaceService.switch(self.ceo, company_id=self.company_b.id)

    def test_switch_to_foreign_brand_is_blocked(self):
        with self.assertRaises(WorkspaceError):
            WorkspaceService.switch(
                self.ceo, company_id=self.company_a.id, brand_id=self.brand_b1.id
            )

    # ── Brand focus narrows data scope ─────────────────────────────────

    def test_brand_focus_narrows_visible_brands(self):
        WorkspaceService.switch(
            self.ceo, company_id=self.company_a.id, brand_id=self.brand_a1.id
        )
        self.ceo.refresh_from_db()
        self.assertEqual(visible_brand_ids(self.ceo), {self.brand_a1.id})

    def test_clearing_brand_focus_restores_company_scope(self):
        WorkspaceService.switch(
            self.ceo, company_id=self.company_a.id, brand_id=self.brand_a1.id
        )
        WorkspaceService.switch(self.ceo, company_id=self.company_a.id, brand_id=None)
        self.ceo.refresh_from_db()
        # Company-scoped CEO sees every brand of company A (only A1 here).
        self.assertEqual(visible_brand_ids(self.ceo), {self.brand_a1.id})

    def test_superuser_brand_focus_narrows_even_root(self):
        WorkspaceService.switch(
            self.root, company_id=self.company_a.id, brand_id=self.brand_a1.id
        )
        self.root.refresh_from_db()
        self.assertEqual(visible_brand_ids(self.root), {self.brand_a1.id})

    # ── Super Admin company context ────────────────────────────────────

    def test_superuser_company_scope_without_brand(self):
        # Super Admin who selected company A (no brand) sees ONLY A's brands.
        WorkspaceService.switch(self.root, company_id=self.company_a.id, brand_id=None)
        self.root.refresh_from_db()
        self.assertEqual(visible_brand_ids(self.root), {self.brand_a1.id})

    def test_superuser_without_company_is_global(self):
        # Super Admin with no company selected keeps the global (all) view.
        self.root.current_company = None
        self.root.current_brand = None
        self.root.save()
        self.root.refresh_from_db()
        self.assertIsNone(visible_brand_ids(self.root))
