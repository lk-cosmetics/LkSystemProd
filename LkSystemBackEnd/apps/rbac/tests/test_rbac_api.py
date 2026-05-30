"""
API-layer security tests for the dynamic RBAC endpoints.

The service-level invariants (per-company isolation, privilege ceiling) are
covered in ``test_per_company_rbac``. These tests exercise the HTTP surface
(``/api/v1/rbac/roles/``) to prove the ViewSet wiring actually enforces them:

* a CEO's role list is scoped to their own company;
* a CEO can create a role, but it is pinned to their company and downgraded
  from any platform scope they try to request;
* a CEO cannot grant a permission they do not themselves hold (ceiling);
* a CEO cannot reach or edit a role owned by another company.

Run with::

    python manage.py test apps.rbac.tests.test_rbac_api
"""

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.company.models import Company
from apps.rbac.models import Role, UserRole
from apps.rbac.provisioning import provision_company_roles

User = get_user_model()

ROLES_URL = '/api/v1/rbac/roles/'


def _rows(response):
    data = response.json()
    if isinstance(data, dict) and 'results' in data:
        return data['results']
    return data


class RoleApiSecurityTests(TestCase):
    def setUp(self):
        call_command('seed_rbac', verbosity=0)
        self.company_a = Company.objects.create(name='Alpha', abbreviation='ALP')
        self.company_b = Company.objects.create(name='Beta', abbreviation='BET')
        provision_company_roles(self.company_a)
        provision_company_roles(self.company_b)

        self.ceo_role_a = Role.objects.get(name='CEO', company=self.company_a)
        self.ceo = User.objects.create(
            matricule='ALP-CEO', email='ceo@alp.test',
            current_company=self.company_a, is_active=True,
        )
        UserRole.objects.create(
            user=self.ceo, role=self.ceo_role_a, company=self.company_a
        )

        self.client = APIClient()
        self.client.force_authenticate(self.ceo)

    def test_role_list_is_scoped_to_own_company(self):
        res = self.client.get(ROLES_URL)
        self.assertEqual(res.status_code, 200)
        returned_ids = {r['id'] for r in _rows(res)}
        company_a_ids = set(
            Role.objects.filter(company=self.company_a).values_list('id', flat=True)
        )
        self.assertGreater(len(returned_ids), 0)
        # Every visible role belongs to company A — no global templates, no B.
        self.assertTrue(returned_ids.issubset(company_a_ids), returned_ids)

    def test_create_role_is_pinned_to_company_and_downgraded(self):
        payload = {
            'name': 'Shift Lead',
            'description': 'Floor supervisor',
            'scope_type': 'platform',          # CEO is not allowed to mint this
            'permissions': ['view_products'],   # within the CEO's ceiling
        }
        res = self.client.post(ROLES_URL, payload, format='json')
        self.assertEqual(res.status_code, 201, res.content)

        role = Role.objects.get(name='Shift Lead', company=self.company_a)
        self.assertEqual(role.company_id, self.company_a.id)   # pinned to A
        self.assertEqual(role.scope_type, 'company')           # platform downgraded
        self.assertFalse(role.is_system)

    def test_cannot_grant_permission_outside_ceiling(self):
        # create_company is platform-only and is NOT part of the CEO role,
        # so the CEO must not be able to put it on a new role.
        payload = {
            'name': 'Over-Privileged',
            'scope_type': 'company',
            'permissions': ['create_company'],
        }
        res = self.client.post(ROLES_URL, payload, format='json')
        self.assertEqual(res.status_code, 403, res.content)
        self.assertFalse(
            Role.objects.filter(name='Over-Privileged').exists()
        )

    def test_cannot_reach_or_edit_another_companys_role(self):
        b_role = Role.objects.get(name='Brand Manager', company=self.company_b)
        res = self.client.patch(
            f'{ROLES_URL}{b_role.id}/', {'description': 'tampered'}, format='json'
        )
        # Either hidden by the queryset (404) or blocked by the guard (403).
        self.assertIn(res.status_code, (403, 404), res.content)
        b_role.refresh_from_db()
        self.assertNotEqual(b_role.description, 'tampered')
