"""Phase D — API / serializers / permissions tests.

Covers the clean-status surface added in Phase D:

* OrderListSerializer / OrderDetailSerializer expose the persisted-but-derived
  clean status set (``order_status`` … ``sync_status``) plus ``*_display`` labels,
  and those fields are read-only (lifecycle service is the only writer).
* ``manual-transition`` endpoint: permission-gated, reason-required, audited
  backward override; WooCommerce orders are parked in ``pending_sync`` (no
  network in tests).
* ``retry-sync`` endpoint: WC-only, runs the push immediately (``force=True``)
  with a patched client so no real HTTP happens.
* ``summary`` endpoint exposes the additive ``order_status_kpis`` block with
  ``revenue`` serialized as a string.

These tests are network-free: ``WC_ORDER_PUSH_ENABLED`` defaults to ``False`` and
``WooCommerceSyncService._build_client`` is patched where a push is exercised.
"""

from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order, OrderLog
from apps.orders.serializers import OrderDetailSerializer
from apps.orders.woocommerce_sync_service import WooCommerceSyncService
from apps.rbac.models import AppPermission, Role, UserRole
from apps.sales_channels.models import SalesChannel


class _PhaseDAPIBase(TestCase):
    """Shared fixture: one WooCommerce order + an authenticated superuser."""

    def setUp(self):
        self.company = Company.objects.create(name='Test Company', abbreviation='TST')
        self.brand = Brand.objects.create(company=self.company, name='Test Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Web Store',
            code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.order = Order.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            order_number='ORD-PHD-001',
            status=Order.Status.NEW,
            source=Order.Source.WOOCOMMERCE,
            external_order_id='9001',
            total='150.00',
        )
        self.admin = get_user_model().objects.create_user(
            matricule='ADMINPHD',
            email='admin-phd@example.com',
            password='test-pass',
        )
        self.admin.is_staff = True
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_staff', 'is_superuser'])

        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _set_fields(self, **fields):
        """Write mechanism/derived fields straight to the row (no save hooks)."""
        Order.all_objects.filter(pk=self.order.pk).update(**fields)
        self.order.refresh_from_db()


class CleanFieldExposureTests(_PhaseDAPIBase):
    CLEAN_FIELDS = [
        'status', 'status_display',
        'delivery_method', 'delivery_method_display',
        'stock_status', 'stock_status_display',
        'priority_level', 'priority_level_display',
        'sync_status', 'sync_status_display',
        'sync_error_message', 'last_sync_at',
    ]

    def test_detail_exposes_clean_status_set_with_labels(self):
        response = self.client.get(f'/api/v1/orders/{self.order.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for field in self.CLEAN_FIELDS:
            self.assertIn(field, response.data, f'missing {field} in detail payload')
        # Human-readable label matches the choice display.
        self.assertEqual(response.data['sync_status'], Order.SyncStatus.IMPORTED)
        self.assertEqual(response.data['sync_status_display'], 'Imported')

    def test_list_exposes_clean_status_set(self):
        response = self.client.get('/api/v1/orders/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        row = response.data['results'][0]
        self.assertIn('status', row)
        self.assertIn('status_display', row)

    def test_clean_fields_are_declared_read_only(self):
        serializer = OrderDetailSerializer()
        for field in (
            'status', 'delivery_method',
            'stock_status', 'priority_level', 'sync_status',
            'sync_error_message', 'last_sync_at',
        ):
            self.assertTrue(
                serializer.fields[field].read_only,
                f'{field} must be read-only (lifecycle service is the only writer)',
            )


class ManualTransitionEndpointTests(_PhaseDAPIBase):
    def _url(self):
        return f'/api/v1/orders/{self.order.id}/manual-transition/'

    def test_canceled_to_confirmed_succeeds_and_parks_for_wc_sync(self):
        # Make the order derive as ``canceled`` (live derivation, not the stored
        # field) and start from a clean sync state.
        self._set_fields(
            status=Order.Status.CANCELED,
            sync_status=Order.SyncStatus.IMPORTED,
        )
        reason = 'Customer called back and wants the order reinstated.'

        response = self.client.post(
            self._url(),
            {'target': Order.Status.CONFIRMED, 'reason': reason},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], Order.Status.CONFIRMED)
        # WooCommerce order + WC-mappable status change => parked for a deferred push.
        self.assertEqual(response.data['sync_status'], Order.SyncStatus.PENDING_SYNC)

        log = (
            OrderLog.objects
            .filter(order=self.order, action=OrderLog.Action.MANUAL_STATUS_OVERRIDE)
            .first()
        )
        self.assertIsNotNone(log, 'manual override must be audited')
        self.assertEqual(log.details.get('reason'), reason)
        self.assertEqual(log.details.get('from'), Order.Status.CANCELED)
        self.assertEqual(log.details.get('to'), Order.Status.CONFIRMED)

    def test_disallowed_target_returns_400(self):
        # canceled -> done is not an allowed backward move.
        self._set_fields(status=Order.Status.CANCELED)

        response = self.client.post(
            self._url(),
            {'target': Order.Status.DONE, 'reason': 'should be rejected'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', response.data)

    def test_missing_reason_returns_400(self):
        self._set_fields(status=Order.Status.CANCELED)

        response = self.client.post(
            self._url(),
            {'target': Order.Status.CONFIRMED},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('reason', response.data)

    def test_viewer_without_override_permission_gets_403(self):
        # A user who CAN see the order (company-scoped view_orders) but lacks
        # manual_status_override must get a clean 403 (not a 404).
        viewer = get_user_model().objects.create_user(
            matricule='VIEWER1',
            email='viewer-phd@example.com',
            password='test-pass',
        )
        view_perm, _ = AppPermission.objects.get_or_create(
            codename='view_orders',
            defaults={'name': 'View Orders', 'category': 'orders'},
        )
        role = Role.objects.create(
            name='OrdersViewerPHD', scope_type='company', company=self.company,
        )
        role.permissions.add(view_perm)
        UserRole.objects.create(user=viewer, role=role, company=self.company)

        viewer_client = APIClient()
        viewer_client.force_authenticate(viewer)

        response = viewer_client.post(
            self._url(),
            {'target': Order.Status.CONFIRMED, 'reason': 'no permission'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class RetrySyncEndpointTests(_PhaseDAPIBase):
    def _url(self):
        return f'/api/v1/orders/{self.order.id}/retry-sync/'

    def test_non_woocommerce_order_returns_400(self):
        self._set_fields(source=Order.Source.MANUAL, external_order_id='')

        response = self.client.post(self._url(), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', response.data)

    def test_retry_pushes_status_and_records_success(self):
        # Simulate a previously failed push of a confirmed order.
        self._set_fields(
            status=Order.Status.CONFIRMED,
            sync_status=Order.SyncStatus.SYNC_FAILED,
        )

        fake_client = MagicMock()
        fake_response = MagicMock()
        fake_response.status_code = 200
        fake_client.put.return_value = fake_response

        with patch.object(
            WooCommerceSyncService, '_build_client', return_value=fake_client,
        ):
            response = self.client.post(self._url(), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['sync_status'], Order.SyncStatus.SYNCED)
        # confirmed maps to WooCommerce 'processing' by default.
        self.assertEqual(response.data['wc_status'], 'processing')
        fake_client.put.assert_called_once_with(
            'orders/9001', {'status': 'processing'},
        )


class SummaryKPITests(_PhaseDAPIBase):
    def test_summary_includes_order_status_kpi_block(self):
        # One realised sale.
        self._set_fields(
            status=Order.Status.DONE,
            total='150.00',
        )

        response = self.client.get('/api/v1/orders/summary/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('order_status_kpis', response.data)
        kpis = response.data['order_status_kpis']
        self.assertEqual(kpis['total_orders'], 1)
        self.assertEqual(kpis['successful_sales'], 1)
        # revenue is serialized as a string for safe JSON transport.
        self.assertEqual(kpis['revenue'], '150.00')
        self.assertEqual(kpis['by_status'][Order.Status.DONE], 1)
        self.assertEqual(kpis['returned'], 0)
        self.assertEqual(kpis['canceled'], 0)


class OrderStatusListFilterTests(_PhaseDAPIBase):
    """The list endpoint filters by the canonical six-state ``order_status``.

    Each OrdersPage tab sends a single ``?status=`` value (comma-joined
    unions remain supported). Rows carrying an exception overlay (cancelled /
    returned / exchanged) are EXCLUDED from specific-status queries — they left
    the live pipeline. Mirrors ``OrderFilterSet.filter_order_status``.
    """

    def setUp(self):
        super().setUp()
        # Pin the base order to a known status, then spread a few more across
        # the lifecycle (written straight to the row, same as _set_fields).
        self._set_fields(status=Order.Status.DELAYED)
        self.new_order = self._make_order('ORD-PHD-002', Order.Status.NEW)
        self.packaging = self._make_order('ORD-PHD-003', Order.Status.PACKAGING)
        self.confirmed = self._make_order('ORD-PHD-004', Order.Status.CONFIRMED)
        self.returned = self._make_order(
            'ORD-PHD-005', Order.Status.RETURNED, returned_at=timezone.now(),
        )
        self.done = self._make_order('ORD-PHD-006', Order.Status.DONE)

    def _make_order(self, number, order_status, **extra):
        order = Order.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            order_number=number,
            status=Order.Status.NEW,
            source=Order.Source.WOOCOMMERCE,
            total='10.00',
        )
        Order.all_objects.filter(pk=order.pk).update(status=order_status, **extra)
        order.refresh_from_db()
        return order

    @staticmethod
    def _ids(response):
        return {row['id'] for row in response.data['results']}

    def test_single_value_filter_returns_only_that_status(self):
        """The Delayed tab (?status=delayed) returns exactly the 1 delayed order."""
        response = self.client.get('/api/v1/orders/?status=delayed')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(self._ids(response), {self.order.id})

    def test_comma_separated_group_unions_statuses(self):
        """Comma-joined values union statuses in one query param."""
        response = self.client.get(
            '/api/v1/orders/?status=new,confirmed'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 2)
        self.assertEqual(self._ids(response), {self.new_order.id, self.confirmed.id})

    def test_returned_is_its_own_tab(self):
        """Returned orders live under ?status=returned, not Done."""
        response = self.client.get('/api/v1/orders/?status=done')
        self.assertEqual(self._ids(response), {self.done.id})
        response = self.client.get('/api/v1/orders/?status=returned')
        self.assertEqual(self._ids(response), {self.returned.id})

    def test_blank_filter_is_ignored(self):
        """An empty value is a no-op (the All tab sends no order_status at all)."""
        response = self.client.get('/api/v1/orders/?status=')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 6)

    def test_whitespace_and_empty_segments_are_trimmed(self):
        """Stray spaces / empty segments don't break the IN-filter."""
        response = self.client.get(
            '/api/v1/orders/?status=%20delayed%20,,'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self._ids(response), {self.order.id})


class SummaryRevenueGatingTests(_PhaseDAPIBase):
    """``/summary`` revenue aggregates are gated on ``can_view_financial_reports``.

    Super Admin / CEO / company Manager (anyone holding the permission) see the
    ``revenue`` and ``order_status_kpis.revenue`` figures. Everyone else gets a
    payload with those two keys stripped — per-order ``total`` is never touched.
    Defence-in-depth behind the frontend hiding the dashboard cards.
    """

    SUMMARY_URL = '/api/v1/orders/summary/'

    def setUp(self):
        super().setUp()
        # A non-superuser staffer who can view orders but is NOT a financial role.
        self.view_orders_perm, _ = AppPermission.objects.get_or_create(
            codename='view_orders',
            defaults={'name': 'View Orders', 'category': 'orders', 'description': ''},
        )
        self.financial_perm, _ = AppPermission.objects.get_or_create(
            codename='can_view_financial_reports',
            defaults={
                'name': 'View Financial Reports',
                'category': 'reports',
                'description': '',
            },
        )
        self.ops_role = Role.objects.create(
            name='Ops (test)', company=self.company,
            scope_type='company', is_system=False,
        )
        self.ops_role.permissions.add(self.view_orders_perm)

        self.staffer = get_user_model().objects.create_user(
            matricule='OPSPHD', email='ops-phd@example.com', password='test-pass',
        )
        self.staffer.current_company = self.company
        self.staffer.save()
        UserRole.objects.create(
            user=self.staffer, role=self.ops_role, company=self.company,
        )

        self.staff_client = APIClient()
        self.staff_client.force_authenticate(self.staffer)

    def test_superuser_sees_revenue_aggregates(self):
        response = self.client.get(self.SUMMARY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('revenue', response.data)
        self.assertIn('revenue', response.data['order_status_kpis'])

    def test_user_without_financial_permission_has_revenue_stripped(self):
        response = self.staff_client.get(self.SUMMARY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Order management still works: the rest of the payload is intact.
        self.assertIn('total_orders', response.data)
        self.assertIn('order_status_kpis', response.data)
        # …but the sensitive money aggregates are gone.
        self.assertNotIn('revenue', response.data)
        self.assertNotIn('revenue', response.data['order_status_kpis'])

    def test_user_with_financial_permission_sees_revenue(self):
        self.ops_role.permissions.add(self.financial_perm)
        response = self.staff_client.get(self.SUMMARY_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('revenue', response.data)
        self.assertIn('revenue', response.data['order_status_kpis'])
