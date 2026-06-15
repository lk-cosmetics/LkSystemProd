"""
Tests for order assignment — auto-assignment pool + manual (re)assignment.

  • pick_assignee balances by OPEN (non-terminal) workload, empty pool → None
  • auto_assign stamps assignment_type=auto, assigned_by=NULL (system) + audit
  • manual_assign / unassign stamp the actor + assignment_type=manual + audit
  • the ``assign`` endpoint is gated by the ``assign_orders`` permission
  • ``?assigned_to_me`` scopes the list to the caller's own orders

Run with::

    python manage.py test apps.orders.tests.test_assignment
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.assignment_service import OrderAssignmentService
from apps.orders.filters import OrderFilterSet
from apps.orders.models import (
    Order, OrderAutoAssignmentSetting, OrderLog,
)
from apps.orders.views import OrderViewSet
from apps.sales_channels.models import SalesChannel

User = get_user_model()


class AssignmentTestBase(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Co', abbreviation='CO')
        self.brand = Brand.objects.create(company=self.company, name='Br')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='Woo', code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        # Two operational employees in the company.
        self.emp1 = User.objects.create_user(
            matricule='E1', email='e1@x.com', password='x',
            first_name='Emp', last_name='One', current_company=self.company,
        )
        self.emp2 = User.objects.create_user(
            matricule='E2', email='e2@x.com', password='x',
            first_name='Emp', last_name='Two', current_company=self.company,
        )

    def _order(self, *, status=Order.Status.NEW, assigned=None, n=None):
        n = n if n is not None else Order.objects.count() + 1
        order = Order.objects.create(
            company=self.company, sales_channel=self.channel, brand=self.brand,
            order_number=f'ORD-{n}', external_order_id=f'EX{n}',
            source=Order.Source.WOOCOMMERCE, status=status,
            assigned_agent=assigned,
            billing_first_name='T', billing_last_name='C', billing_phone='+21620000000',
            total=Decimal('100.00'),
        )
        return order

    def _enable(self, *employees):
        for emp in employees:
            OrderAutoAssignmentSetting.objects.create(
                company=self.company, employee=emp, enabled=True,
            )


class PickAssigneeTests(AssignmentTestBase):
    def test_empty_pool_returns_none(self):
        self.assertIsNone(OrderAssignmentService.pick_assignee(self.company))

    def test_picks_employee_with_fewest_open_orders(self):
        self._enable(self.emp1, self.emp2)
        # emp1 already carries two OPEN orders; emp2 carries none.
        self._order(status=Order.Status.NEW, assigned=self.emp1)
        self._order(status=Order.Status.CONFIRMED, assigned=self.emp1)
        self.assertEqual(OrderAssignmentService.pick_assignee(self.company), self.emp2)

    def test_terminal_orders_do_not_count_as_workload(self):
        self._enable(self.emp1, self.emp2)
        # emp1 has 3 DONE/CANCELED/RETURNED (terminal) → workload 0, same as emp2.
        for st in (Order.Status.DONE, Order.Status.CANCELED, Order.Status.RETURNED):
            self._order(status=st, assigned=self.emp1)
        # emp2 has one OPEN → emp1 (0 open) should win.
        self._order(status=Order.Status.NEW, assigned=self.emp2)
        self.assertEqual(OrderAssignmentService.pick_assignee(self.company), self.emp1)

    def test_disabled_employee_is_excluded(self):
        self._enable(self.emp1)
        OrderAutoAssignmentSetting.objects.create(
            company=self.company, employee=self.emp2, enabled=False,
        )
        # Even though emp2 has zero workload, only emp1 is eligible.
        self.assertEqual(OrderAssignmentService.pick_assignee(self.company), self.emp1)


class AutoAssignTests(AssignmentTestBase):
    def test_auto_assign_stamps_system_metadata_and_audit(self):
        self._enable(self.emp1)
        order = self._order()
        result = OrderAssignmentService.auto_assign(order)

        self.assertEqual(result, self.emp1)
        order.refresh_from_db()
        self.assertEqual(order.assigned_agent, self.emp1)
        self.assertIsNone(order.assigned_by)  # system / auto
        self.assertEqual(order.assignment_type, Order.AssignmentType.AUTO)
        self.assertIsNotNone(order.assigned_at)
        self.assertTrue(
            order.logs.filter(action=OrderLog.Action.ASSIGNED).exists()
        )

    def test_empty_pool_leaves_order_unassigned(self):
        order = self._order()
        self.assertIsNone(OrderAssignmentService.auto_assign(order))
        order.refresh_from_db()
        self.assertIsNone(order.assigned_agent_id)
        self.assertEqual(order.assignment_type, '')

    def test_auto_assign_skips_already_assigned(self):
        self._enable(self.emp1)
        order = self._order(assigned=self.emp2)
        self.assertIsNone(OrderAssignmentService.auto_assign(order))
        order.refresh_from_db()
        self.assertEqual(order.assigned_agent, self.emp2)


class ManualAssignTests(AssignmentTestBase):
    def test_manual_assign_stamps_actor_and_audit(self):
        manager = User.objects.create_user(
            matricule='M1', email='m1@x.com', password='x', current_company=self.company,
        )
        order = self._order()
        OrderAssignmentService.manual_assign(order, self.emp1, actor=manager)

        order.refresh_from_db()
        self.assertEqual(order.assigned_agent, self.emp1)
        self.assertEqual(order.assigned_by, manager)
        self.assertEqual(order.assignment_type, Order.AssignmentType.MANUAL)
        log = order.logs.filter(action=OrderLog.Action.ASSIGNED).latest('created_at')
        self.assertEqual(log.user, manager)
        self.assertEqual(log.details.get('assignment_type'), Order.AssignmentType.MANUAL)

    def test_reassign_records_previous_employee(self):
        manager = User.objects.create_user(
            matricule='M2', email='m2@x.com', password='x', current_company=self.company,
        )
        order = self._order(assigned=self.emp1)
        OrderAssignmentService.manual_assign(order, self.emp2, actor=manager)
        log = order.logs.filter(action=OrderLog.Action.ASSIGNED).latest('created_at')
        self.assertEqual(log.details.get('previous_employee_id'), self.emp1.id)

    def test_unassign_clears_and_audits(self):
        manager = User.objects.create_user(
            matricule='M3', email='m3@x.com', password='x', current_company=self.company,
        )
        order = self._order(assigned=self.emp1)
        OrderAssignmentService.unassign(order, actor=manager)
        order.refresh_from_db()
        self.assertIsNone(order.assigned_agent_id)
        self.assertEqual(order.assignment_type, '')
        self.assertTrue(order.logs.filter(action=OrderLog.Action.UNASSIGNED).exists())


class AssignEndpointPermissionTests(AssignmentTestBase):
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.order = self._order()
        # Give emp1 a role that can VIEW orders (so the order is visible and the
        # request reaches the assign_orders gate) but cannot ASSIGN them.
        from apps.rbac.models import AppPermission, Role, UserRole
        view_perm, _ = AppPermission.objects.get_or_create(
            codename='view_orders',
            defaults={'name': 'View Orders', 'category': 'orders'},
        )
        viewer = Role.objects.create(
            name='OrdersViewerTest', company=self.company, scope_type='company',
        )
        viewer.permissions.add(view_perm)
        UserRole.objects.create(user=self.emp1, role=viewer, company=self.company)

    def _post_assign(self, user, employee_id):
        request = self.factory.post(
            f'/api/v1/orders/{self.order.id}/assign/',
            {'employee_id': employee_id}, format='json',
        )
        force_authenticate(request, user=user)
        view = OrderViewSet.as_view({'post': 'assign'})
        return view(request, pk=self.order.id)

    def test_viewer_without_assign_permission_is_denied(self):
        # emp1 can see the order (view_orders) but lacks assign_orders → 403.
        response = self._post_assign(self.emp1, self.emp2.id)
        self.assertEqual(response.status_code, 403)
        self.order.refresh_from_db()
        self.assertIsNone(self.order.assigned_agent_id)

    def test_superuser_can_assign(self):
        admin = User.objects.create_user(
            matricule='ADM', email='adm@x.com', password='x',
            current_company=self.company,
        )
        admin.is_superuser = True
        admin.save(update_fields=['is_superuser'])
        response = self._post_assign(admin, self.emp1.id)
        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.assigned_agent, self.emp1)
        self.assertEqual(self.order.assignment_type, Order.AssignmentType.MANUAL)


class BulkAssignEndpointTests(AssignmentTestBase):
    def setUp(self):
        super().setUp()
        self.factory = APIRequestFactory()
        self.admin = User.objects.create_user(
            matricule='BADM', email='badm@x.com', password='x', current_company=self.company,
        )
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.o1 = self._order()
        self.o2 = self._order()
        self.o3 = self._order()

    def _bulk(self, user, payload):
        request = self.factory.post('/api/v1/orders/bulk/', payload, format='json')
        force_authenticate(request, user=user)
        return OrderViewSet.as_view({'post': 'bulk'})(request)

    def test_bulk_auto_assign_distributes_across_pool(self):
        self._enable(self.emp1, self.emp2)
        resp = self._bulk(self.admin, {
            'ids': [self.o1.id, self.o2.id, self.o3.id], 'action': 'auto_assign',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['summary']['succeeded'], 3)
        agents = set()
        for o in (self.o1, self.o2, self.o3):
            o.refresh_from_db()
            self.assertIsNotNone(o.assigned_agent_id)
            self.assertEqual(o.assignment_type, Order.AssignmentType.AUTO)
            agents.add(o.assigned_agent_id)
        # 3 orders across 2 eligible employees → workload spreads to both.
        self.assertEqual(len(agents), 2)

    def test_bulk_auto_assign_empty_pool_is_400(self):
        resp = self._bulk(self.admin, {'ids': [self.o1.id], 'action': 'auto_assign'})
        self.assertEqual(resp.status_code, 400)

    def test_bulk_manual_assign_to_one_employee(self):
        resp = self._bulk(self.admin, {
            'ids': [self.o1.id, self.o2.id], 'action': 'assign', 'employee_id': self.emp1.id,
        })
        self.assertEqual(resp.status_code, 200)
        self.o1.refresh_from_db(); self.o2.refresh_from_db()
        self.assertEqual(self.o1.assigned_agent_id, self.emp1.id)
        self.assertEqual(self.o1.assignment_type, Order.AssignmentType.MANUAL)
        self.assertEqual(self.o2.assigned_agent_id, self.emp1.id)

    def test_bulk_assign_denied_for_viewer_without_assign_permission(self):
        from apps.rbac.models import AppPermission, Role, UserRole
        vp, _ = AppPermission.objects.get_or_create(
            codename='view_orders', defaults={'name': 'View Orders', 'category': 'orders'},
        )
        role = Role.objects.create(name='OViewerBulk', company=self.company, scope_type='company')
        role.permissions.add(vp)
        UserRole.objects.create(user=self.emp1, role=role, company=self.company)
        resp = self._bulk(self.emp1, {
            'ids': [self.o1.id], 'action': 'assign', 'employee_id': self.emp2.id,
        })
        # The per-order assign_orders gate rejects it → order stays unassigned.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['summary']['succeeded'], 0)
        self.o1.refresh_from_db()
        self.assertIsNone(self.o1.assigned_agent_id)


class AssignedToMeFilterTests(AssignmentTestBase):
    def test_assigned_to_me_scopes_to_caller(self):
        mine = self._order(assigned=self.emp1)
        self._order(assigned=self.emp2)  # someone else's
        self._order()  # unassigned

        factory = APIRequestFactory()
        request = factory.get('/api/v1/orders/', {'assigned_to_me': 'true'})
        request.user = self.emp1
        fs = OrderFilterSet(
            {'assigned_to_me': 'true'}, queryset=Order.objects.all(), request=request,
        )
        result = list(fs.qs)
        self.assertEqual(result, [mine])
