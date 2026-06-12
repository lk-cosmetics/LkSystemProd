"""
Tests for editing role permissions via Role Management.

Two layers:
  * A company admin (``edit_roles``) tunes the permissions of their company's
    own role copy (the common case — e.g. add/remove send-to-POS).
  * A SYSTEM template's permissions may be tuned too, but its IDENTITY (name,
    scope, system flag) is pinned — the fix that stopped "System roles cannot
    be edited" from blocking permission changes outright.

    python manage.py test apps.rbac.tests.test_system_role_edit
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


def _codes(role):
    return set(role.permissions.values_list('codename', flat=True))


class RolePermissionEditTests(TestCase):
    def setUp(self):
        call_command('seed_rbac', verbosity=0)
        self.company = Company.objects.create(name='Gamma', abbreviation='GAM')
        provision_company_roles(self.company)

        self.ceo_role = Role.objects.get(name='CEO', company=self.company)
        self.employee_role = Role.objects.get(name='Employee', company=self.company)

        self.ceo = User.objects.create(
            matricule='GAM-CEO', email='ceo@gam.test',
            current_company=self.company, is_active=True,
        )
        UserRole.objects.create(user=self.ceo, role=self.ceo_role, company=self.company)
        self.api = APIClient()
        self.api.force_authenticate(self.ceo)

        self.superuser = User.objects.create(
            matricule='SU-1', email='su@test', is_superuser=True,
            is_staff=True, is_active=True,
        )
        self.su_api = APIClient()
        self.su_api.force_authenticate(self.superuser)

    # ── The company-owned role (is_system=False) — the user's real scenario ──
    def test_employee_role_carries_send_to_pos(self):
        self.assertIn('send_to_pos_orders', _codes(self.employee_role))

    def test_ceo_can_edit_employee_role_permissions(self):
        codes = list(
            self.employee_role.permissions
            .exclude(codename='send_to_pos_orders')
            .values_list('codename', flat=True)
        )
        res = self.api.patch(
            f'{ROLES_URL}{self.employee_role.id}/', {'permissions': codes}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.employee_role.refresh_from_db()
        self.assertNotIn('send_to_pos_orders', _codes(self.employee_role))

    # ── The system template (is_system=True) — permissions editable, ID pinned ──
    def _system_template(self):
        return Role.objects.get(name='Employee', company__isnull=True, is_system=True)

    def test_system_template_permissions_editable_but_identity_pinned(self):
        tmpl = self._system_template()
        original_scope = tmpl.scope_type
        codes = list(
            tmpl.permissions.exclude(codename='send_to_pos_orders')
            .values_list('codename', flat=True)
        )
        res = self.su_api.patch(
            f'{ROLES_URL}{tmpl.id}/',
            {'permissions': codes, 'scope_type': 'platform'}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        tmpl.refresh_from_db()
        self.assertNotIn('send_to_pos_orders', _codes(tmpl))   # permissions changed
        self.assertTrue(tmpl.is_system)                         # identity pinned
        self.assertEqual(tmpl.scope_type, original_scope)       # scope not repurposed

    def test_system_template_cannot_be_renamed(self):
        tmpl = self._system_template()
        res = self.su_api.patch(
            f'{ROLES_URL}{tmpl.id}/', {'name': 'Hacked'}, format='json',
        )
        self.assertEqual(res.status_code, 400)
        tmpl.refresh_from_db()
        self.assertEqual(tmpl.name, 'Employee')
