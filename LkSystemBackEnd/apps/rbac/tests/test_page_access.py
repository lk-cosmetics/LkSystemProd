"""
Tests for the page-access feature:

  * ``GET /api/v1/rbac/pages/`` exposes the page catalogue in the exact shape the
    frontend ``PageDefinition`` type expects, and every codename in every bundle
    is a real, seeded permission.
  * Page access rides on the role's permission set: enabling a page means the
    role holds the page's ``view_codename``; disabling a page (done by the UI
    stripping the page's whole bundle) is persisted by the normal role-save path
    and leaves other pages untouched.

    python manage.py test apps.rbac.tests.test_page_access
"""
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.company.models import Company
from apps.rbac.constants import get_page_definitions
from apps.rbac.models import AppPermission, Role, UserRole
from apps.rbac.provisioning import provision_company_roles
from apps.rbac.services import PermissionService

User = get_user_model()
PAGES_URL = '/api/v1/rbac/pages/'
ROLES_URL = '/api/v1/rbac/roles/'

PAGE_FIELDS = {'key', 'label', 'group', 'icon', 'description', 'view_codename', 'codenames'}


def _codes(role):
    return set(role.permissions.values_list('codename', flat=True))


class PageCatalogTests(TestCase):
    def setUp(self):
        call_command('seed_rbac', verbosity=0)
        self.company = Company.objects.create(name='PageCo', abbreviation='PGC')
        provision_company_roles(self.company)
        self.ceo_role = Role.objects.get(name='CEO', company=self.company)
        self.ceo = User.objects.create(
            matricule='PGC-CEO', email='ceo@pgc.test',
            current_company=self.company, is_active=True,
        )
        UserRole.objects.create(user=self.ceo, role=self.ceo_role, company=self.company)
        self.api = APIClient()
        self.api.force_authenticate(self.ceo)

    def test_catalog_endpoint_returns_pages_in_contract_shape(self):
        res = self.api.get(PAGES_URL)
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertGreaterEqual(len(data), 10)
        for p in data:
            self.assertEqual(set(p.keys()), PAGE_FIELDS, p)
            self.assertIsInstance(p['codenames'], list)
            # The page's gate is always part of its bundle (and first).
            self.assertEqual(p['codenames'][0], p['view_codename'])

    def test_catalog_requires_authentication(self):
        anon = APIClient()
        res = anon.get(PAGES_URL)
        self.assertIn(res.status_code, (401, 403))

    def test_catalog_forbidden_without_view_roles(self):
        # A Cashier (no view_roles) must not be able to enumerate the page/
        # permission map — it's part of the security model.
        cashier_role = Role.objects.get(name='Cashier', company=self.company)
        cashier = User.objects.create(
            matricule='PGC-CASH', email='cash@pgc.test',
            current_company=self.company, is_active=True,
        )
        UserRole.objects.create(user=cashier, role=cashier_role, company=self.company)
        api = APIClient()
        api.force_authenticate(cashier)
        res = api.get(PAGES_URL)
        self.assertEqual(res.status_code, 403, res.content)

    def test_every_bundle_codename_is_a_real_permission(self):
        real = set(AppPermission.objects.values_list('codename', flat=True))
        for p in get_page_definitions():
            unknown = set(p['codenames']) - real
            self.assertFalse(unknown, f"{p['key']} references unknown codenames: {unknown}")

    def test_page_keys_and_gates_are_unique(self):
        pages = get_page_definitions()
        keys = [p['key'] for p in pages]
        self.assertEqual(len(keys), len(set(keys)), 'duplicate page keys')
        gates = [p['view_codename'] for p in pages]
        self.assertEqual(len(gates), len(set(gates)), 'two pages share a gate codename')


class PageAccessSemanticsTests(TestCase):
    """Enable/disable a page over the real role-save path."""

    def setUp(self):
        call_command('seed_rbac', verbosity=0)
        self.company = Company.objects.create(name='SemCo', abbreviation='SEM')
        provision_company_roles(self.company)
        self.ceo_role = Role.objects.get(name='CEO', company=self.company)
        self.ceo = User.objects.create(
            matricule='SEM-CEO', email='ceo@sem.test',
            current_company=self.company, is_active=True,
        )
        UserRole.objects.create(user=self.ceo, role=self.ceo_role, company=self.company)
        self.api = APIClient()
        self.api.force_authenticate(self.ceo)
        self.role = Role.objects.create(
            name='Ops', company=self.company, scope_type='company',
        )
        self.orders = next(p for p in get_page_definitions() if p['key'] == 'orders')
        self.clients = next(p for p in get_page_definitions() if p['key'] == 'clients')

    def _patch_role(self, payload):
        res = self.api.patch(
            f'{ROLES_URL}{self.role.id}/', payload, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.role.refresh_from_db()

    def test_deny_page_does_not_remove_permissions(self):
        """The core fix: denying a page never strips a capability.

        A till role keeps ``create_orders`` (needed for POS) even when the
        Orders page is denied.
        """
        self.role.permissions.set(
            AppPermission.objects.filter(
                codename__in=['view_orders', 'create_orders', 'use_pos'],
            )
        )
        self._patch_role({'hidden_pages': ['orders']})
        self.assertEqual(self.role.hidden_pages, ['orders'])
        # Every capability is intact — POS can still create orders.
        codes = _codes(self.role)
        self.assertIn('create_orders', codes)
        self.assertIn('view_orders', codes)
        self.assertIn('use_pos', codes)

    def test_hidden_page_resolution_and_payload(self):
        from apps.users.api.workspace_views import _build_user_payload
        self.role.permissions.set(
            AppPermission.objects.filter(codename__in=['view_orders', 'use_pos'])
        )
        self.role.hidden_pages = ['orders']
        self.role.save(update_fields=['hidden_pages'])
        worker = User.objects.create(
            matricule='SEM-TILL', email='till@sem.test',
            current_company=self.company, is_active=True,
        )
        UserRole.objects.create(user=worker, role=self.role, company=self.company)
        hidden = PermissionService.hidden_page_keys(worker)
        self.assertIn('orders', hidden)
        self.assertNotIn('pos', hidden)  # POS page still reachable
        payload = _build_user_payload(worker)
        self.assertIn('orders', payload['hidden_pages'])

    def test_invalid_page_keys_are_dropped(self):
        self._patch_role({'hidden_pages': ['orders', 'not_a_real_page']})
        self.assertEqual(self.role.hidden_pages, ['orders'])

    def test_ceo_cannot_hide_roles_page_on_own_role(self):
        res = self.api.patch(
            f'{ROLES_URL}{self.ceo_role.id}/',
            {'hidden_pages': ['roles']}, format='json',
        )
        self.assertEqual(res.status_code, 403, res.content)

    # ── Self-lockout guard ──────────────────────────────────────────────
    def test_ceo_cannot_strip_edit_roles_from_own_role(self):
        """Disabling the Roles page on your own role is blocked server-side."""
        roles_page = next(p for p in get_page_definitions() if p['key'] == 'roles')
        self.assertIn('edit_roles', roles_page['codenames'])
        before = _codes(self.ceo_role)
        self.assertIn('edit_roles', before)
        # Simulate "disable Roles page" on the actor's own CEO role.
        remaining = sorted(before - set(roles_page['codenames']))
        res = self.api.patch(
            f'{ROLES_URL}{self.ceo_role.id}/',
            {'permissions': remaining}, format='json',
        )
        self.assertEqual(res.status_code, 403, res.content)
        self.ceo_role.refresh_from_db()
        self.assertIn('edit_roles', _codes(self.ceo_role))  # unchanged

    def test_ceo_can_strip_edit_roles_from_a_role_they_do_not_hold(self):
        """Removing edit_roles from someone else's role is fine."""
        other = Role.objects.create(
            name='Helper', company=self.company, scope_type='company',
        )
        other.permissions.set(
            AppPermission.objects.filter(
                codename__in=['view_roles', 'edit_roles', 'view_orders'],
            )
        )
        res = self.api.patch(
            f'{ROLES_URL}{other.id}/',
            {'permissions': ['view_roles', 'view_orders']}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        other.refresh_from_db()
        self.assertNotIn('edit_roles', _codes(other))

    def test_superuser_can_strip_edit_roles_from_own_role(self):
        """A platform admin is exempt — they can always recover."""
        su = User.objects.create(
            matricule='SEM-SU', email='su@sem.test',
            is_superuser=True, is_staff=True, is_active=True,
        )
        su_api = APIClient()
        su_api.force_authenticate(su)
        # Assign the superuser a normal company role carrying edit_roles, then
        # strip it — the guard must not block a platform admin.
        UserRole.objects.create(user=su, role=self.ceo_role, company=self.company)
        remaining = sorted(_codes(self.ceo_role) - {'edit_roles'})
        res = su_api.patch(
            f'{ROLES_URL}{self.ceo_role.id}/',
            {'permissions': remaining}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
