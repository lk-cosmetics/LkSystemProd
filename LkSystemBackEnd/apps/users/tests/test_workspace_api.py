"""
API-layer tests for the workspace-switching endpoints.

Service-level rules are covered in ``test_workspace``. These exercise the HTTP
surface to prove the views enforce them and that a forged company/brand can
never be switched into:

    GET  /api/v1/auth/workspaces/
    POST /api/v1/auth/switch-workspace/

Run with::

    python manage.py test apps.users.tests.test_workspace_api
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.brands.models import Brand
from apps.company.models import Company
from apps.rbac.models import Role, UserRole

User = get_user_model()

WORKSPACES_URL = '/api/v1/auth/workspaces/'
SWITCH_URL = '/api/v1/auth/switch-workspace/'


class WorkspaceApiTests(TestCase):
    def setUp(self):
        self.company_a = Company.objects.create(name='Alpha', abbreviation='ALP')
        self.company_b = Company.objects.create(name='Beta', abbreviation='BET')
        self.brand_a1 = Brand.objects.create(company=self.company_a, name='A1')
        self.brand_b1 = Brand.objects.create(company=self.company_b, name='B1')

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

        self.client = APIClient()

    # ── GET /workspaces/ ───────────────────────────────────────────────

    def test_workspaces_list_is_scoped_for_ceo(self):
        self.client.force_authenticate(self.ceo)
        res = self.client.get(WORKSPACES_URL)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        company_ids = {w['id'] for w in body['workspaces']}
        self.assertEqual(company_ids, {self.company_a.id})
        self.assertEqual(body['active_company_id'], self.company_a.id)

    def test_workspaces_list_is_global_for_superuser(self):
        self.client.force_authenticate(self.root)
        res = self.client.get(WORKSPACES_URL)
        self.assertEqual(res.status_code, 200)
        company_ids = {w['id'] for w in res.json()['workspaces']}
        self.assertEqual(company_ids, {self.company_a.id, self.company_b.id})

    def test_workspaces_requires_auth(self):
        res = self.client.get(WORKSPACES_URL)
        self.assertEqual(res.status_code, 401)

    # ── POST /switch-workspace/ ────────────────────────────────────────

    def test_switch_into_own_company_with_brand_succeeds(self):
        self.client.force_authenticate(self.ceo)
        res = self.client.post(
            SWITCH_URL,
            {'company_id': self.company_a.id, 'brand_id': self.brand_a1.id},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertIn('access', body)
        self.assertIn('refresh', body)
        self.assertEqual(body['user']['company_id'], self.company_a.id)
        self.assertEqual(body['user']['current_brand_id'], self.brand_a1.id)
        self.ceo.refresh_from_db()
        self.assertEqual(self.ceo.current_brand_id, self.brand_a1.id)

    def test_switch_into_foreign_company_is_forbidden(self):
        self.client.force_authenticate(self.ceo)
        res = self.client.post(
            SWITCH_URL, {'company_id': self.company_b.id}, format='json'
        )
        self.assertEqual(res.status_code, 403, res.content)
        self.ceo.refresh_from_db()
        self.assertEqual(self.ceo.current_company_id, self.company_a.id)  # unchanged

    def test_switch_to_foreign_brand_is_forbidden(self):
        self.client.force_authenticate(self.ceo)
        res = self.client.post(
            SWITCH_URL,
            {'company_id': self.company_a.id, 'brand_id': self.brand_b1.id},
            format='json',
        )
        self.assertEqual(res.status_code, 403, res.content)
        self.ceo.refresh_from_db()
        self.assertIsNone(self.ceo.current_brand_id)

    def test_invalid_company_id_returns_400(self):
        self.client.force_authenticate(self.ceo)
        res = self.client.post(
            SWITCH_URL, {'company_id': 'not-a-number'}, format='json'
        )
        self.assertEqual(res.status_code, 400, res.content)
