"""Phase C — clean top-layer status services (STATUS_MAP.md 5.x / 6.3 / 7).

Covers the pure derivations (order_status / confirmation_status / delivery_method),
OrderPriorityService, OrderStockAvailabilityService.status_snapshot,
WooCommerceSyncService (parked / mocked success / mocked failure — never raises),
the audited manual_transition overrides (permission + reason gating, stock
re-deduction correctness), and OrderKPIService (returns/exchanges/cancels excluded
from successful sales + revenue).

Everything runs network-free: WooCommerce is patched at ``_build_client`` and the
global push gate (``WC_ORDER_PUSH_ENABLED``) defaults to False.
"""

from __future__ import annotations

from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.brands.models import Brand
from apps.clients.models import Client
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.kpi_service import OrderKPIService
from apps.orders.lifecycle_service import LifecycleError, OrderLifecycleService
from apps.orders.models import Order, OrderLine, OrderLog, SystemSetting
from apps.orders.priority_service import OrderPriorityService
from apps.orders.service import OrderIngestionService
from apps.orders.stock_service import OrderStockAvailabilityService
from apps.orders.woocommerce_sync_service import WooCommerceSyncService
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class _BaseOrderServiceTest(TestCase):
    """Shared tenant fixture: company, brand, web + POS channels, product, stock."""

    def setUp(self):
        self.company = Company.objects.create(name='Test Company', abbreviation='TST')
        self.brand = Brand.objects.create(company=self.company, name='Test Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Web Store',
            code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.pos_channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Main POS',
            code='POS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        self.product = Product.objects.create(
            brand=self.brand,
            name='Finished Perfume',
            wc_product_id=101,
            barcode='PERF-101',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='100.00',
        )
        self.inventory = SalesChannelInventory.objects.create(
            sales_channel=self.channel, product=self.product, quantity=10,
        )
        self.pos_inventory = SalesChannelInventory.objects.create(
            sales_channel=self.pos_channel, product=self.product, quantity=10,
        )
        self.actor = get_user_model().objects.create_user(
            matricule='U100', email='worker@example.com', password='test-pass',
        )
        self.service = OrderIngestionService()

    # -- helpers ----------------------------------------------------------------

    def make_order(self, **overrides) -> Order:
        """An *unsaved* Order for pure-derivation assertions (no full_clean)."""
        defaults = dict(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            source=Order.Source.WOOCOMMERCE,
        )
        defaults.update(overrides)
        return Order(**defaults)

    def persist_order(self, *, order_status=None, total='100.00', **overrides) -> Order:
        """A persisted Order with a directly-set ``order_status`` (KPI/sync tests).

        Bypasses the lifecycle recompute on purpose so the aggregation/sync code
        is exercised against a known clean status.
        """
        n = Order.objects.count() + 1
        defaults = dict(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            source=Order.Source.WOOCOMMERCE,
            order_number=f'ORD-{n:04d}',
            total=Decimal(total),
        )
        defaults.update(overrides)
        order = Order.objects.create(**defaults)
        if order_status is not None:
            # Set the derived field directly, without triggering a recompute.
            Order.objects.filter(pk=order.pk).update(order_status=order_status)
            order.refresh_from_db()
        return order

    def payload(self, *, quantity=2, order_id=5001, status='completed'):
        return {
            'id': order_id,
            'order_key': f'wc_order_{order_id}',
            'number': str(order_id),
            'status': status,
            'currency': 'TND',
            'billing': {
                'first_name': 'Test',
                'last_name': 'Client',
                'email': f'client-{order_id}@example.com',
            },
            'line_items': [{
                'id': 7001,
                'product_id': self.product.wc_product_id,
                'name': self.product.name,
                'sku': self.product.barcode,
                'quantity': quantity,
                'price': '100.00',
                'subtotal': str(quantity * 100),
                'total': str(quantity * 100),
                'total_tax': '0',
            }],
        }


class OrderStatusDerivationTests(_BaseOrderServiceTest):
    """STATUS_MAP.md 5.1 / 5.2 / 5.3 — pure functions of the mechanism fields."""

    def d(self, order):
        return OrderLifecycleService._derive_order_status(order)

    def test_new_when_no_signals(self):
        order = self.make_order(
            outcome=Order.Outcome.NONE, contact_status=Order.ContactStatus.NONE,
        )
        self.assertEqual(self.d(order), Order.OrderStatus.NEW)

    def test_awaiting_confirmation_on_first_contact(self):
        order = self.make_order(contact_status=Order.ContactStatus.ANSWERED)
        self.assertEqual(self.d(order), Order.OrderStatus.AWAITING_CONFIRMATION)

    def test_confirmed_without_fulfilment_signal(self):
        order = self.make_order(outcome=Order.Outcome.CONFIRMED)
        self.assertEqual(self.d(order), Order.OrderStatus.CONFIRMED)

    def test_preparing_when_routed_to_pos(self):
        order = self.make_order(
            outcome=Order.Outcome.CONFIRMED, sent_to_pos_at=timezone.now(),
        )
        self.assertEqual(self.d(order), Order.OrderStatus.PREPARING)

    def test_delayed(self):
        order = self.make_order(outcome=Order.Outcome.DELAYED)
        self.assertEqual(self.d(order), Order.OrderStatus.DELAYED)

    def test_not_answered_only_after_threshold(self):
        below = self.make_order(
            contact_status=Order.ContactStatus.NOT_ANSWERED, not_answered_attempts=1,
        )
        self.assertEqual(self.d(below), Order.OrderStatus.AWAITING_CONFIRMATION)
        at_threshold = self.make_order(
            contact_status=Order.ContactStatus.NOT_ANSWERED, not_answered_attempts=3,
        )
        self.assertEqual(self.d(at_threshold), Order.OrderStatus.NOT_ANSWERED)

    def test_not_answered_threshold_honours_system_setting(self):
        SystemSetting.objects.create(company=self.company, no_answer_max_attempts=2)
        order = self.make_order(
            contact_status=Order.ContactStatus.NOT_ANSWERED, not_answered_attempts=2,
        )
        self.assertEqual(self.d(order), Order.OrderStatus.NOT_ANSWERED)

    def test_canceled(self):
        order = self.make_order(status=Order.Status.CANCELLED)
        self.assertEqual(self.d(order), Order.OrderStatus.CANCELED)

    def test_done_on_delivery(self):
        order = self.make_order(delivery_status=Order.DeliveryStatus.DELIVERED)
        self.assertEqual(self.d(order), Order.OrderStatus.DONE)

    def test_returned(self):
        order = self.make_order(returned_at=timezone.now())
        self.assertEqual(self.d(order), Order.OrderStatus.RETURNED)

    def test_exchanged(self):
        order = self.make_order(return_type=Order.ReturnType.EXCHANGED)
        self.assertEqual(self.d(order), Order.OrderStatus.EXCHANGED)

    def test_precedence_exchanged_beats_returned_and_done(self):
        order = self.make_order(
            return_type=Order.ReturnType.EXCHANGED,
            returned_at=timezone.now(),
            delivery_status=Order.DeliveryStatus.DELIVERED,
        )
        self.assertEqual(self.d(order), Order.OrderStatus.EXCHANGED)

    def test_precedence_returned_beats_done(self):
        order = self.make_order(
            returned_at=timezone.now(),
            delivery_status=Order.DeliveryStatus.DELIVERED,
        )
        self.assertEqual(self.d(order), Order.OrderStatus.RETURNED)

    def test_confirmation_status_mapping(self):
        CS = Order.ConfirmationStatus
        cases = [
            (dict(outcome=Order.Outcome.CANCELLED), CS.CANCELED),
            (dict(outcome=Order.Outcome.CONFIRMED), CS.ACCEPTED),
            (dict(outcome=Order.Outcome.DELAYED), CS.DELAYED),
            (dict(contact_status=Order.ContactStatus.NOT_ANSWERED), CS.NO_ANSWER),
            (dict(), CS.PENDING),
        ]
        for fields, expected in cases:
            with self.subTest(fields=fields):
                order = self.make_order(**fields)
                self.assertEqual(
                    OrderLifecycleService._derive_confirmation_status(order), expected,
                )

    def test_delivery_method_mapping(self):
        DM = Order.DeliveryMethod
        home = self.make_order(source=Order.Source.WOOCOMMERCE)
        self.assertEqual(OrderLifecycleService._derive_delivery_method(home), DM.HOME_DELIVERY)

        pos_routed = self.make_order(pos_sales_channel=self.pos_channel)
        self.assertEqual(OrderLifecycleService._derive_delivery_method(pos_routed), DM.POS_PICKUP)

        pos_source = self.make_order(source=Order.Source.POS)
        self.assertEqual(OrderLifecycleService._derive_delivery_method(pos_source), DM.POS_PICKUP)

        pickup = self.make_order(in_store_pickup=True)
        self.assertEqual(OrderLifecycleService._derive_delivery_method(pickup), DM.POS_PICKUP)


class OrderPriorityServiceTests(_BaseOrderServiceTest):
    """STATUS_MAP.md 5.6 — top-down ladder + mapping_required hard override."""

    SS = Order.StockStatus
    PL = Order.PriorityLevel

    def test_high_requires_in_stock_and_high_total(self):
        order = self.make_order(total=Decimal('500.00'))
        self.assertEqual(
            OrderPriorityService.compute(order, stock_status=self.SS.IN_STOCK), self.PL.HIGH,
        )

    def test_high_total_but_partial_stock_is_medium(self):
        order = self.make_order(total=Decimal('500.00'))
        self.assertEqual(
            OrderPriorityService.compute(order, stock_status=self.SS.PARTIAL_STOCK), self.PL.MEDIUM,
        )

    def test_medium_band(self):
        order = self.make_order(total=Decimal('150.00'))
        self.assertEqual(
            OrderPriorityService.compute(order, stock_status=self.SS.IN_STOCK), self.PL.MEDIUM,
        )

    def test_low_below_medium_band(self):
        order = self.make_order(total=Decimal('50.00'))
        self.assertEqual(
            OrderPriorityService.compute(order, stock_status=self.SS.IN_STOCK), self.PL.LOW,
        )

    def test_out_of_stock_forces_low(self):
        order = self.make_order(total=Decimal('500.00'))
        self.assertEqual(
            OrderPriorityService.compute(order, stock_status=self.SS.OUT_OF_STOCK), self.PL.LOW,
        )

    def test_mapping_required_forces_low_even_for_big_in_stock_order(self):
        order = self.make_order(total=Decimal('999.00'))
        self.assertEqual(
            OrderPriorityService.compute(
                order, stock_status=self.SS.IN_STOCK, mapping_required=True,
            ),
            self.PL.LOW,
        )

    def test_custom_thresholds_from_system_setting(self):
        SystemSetting.objects.create(
            company=self.company,
            priority_high_min_amount=Decimal('1000.00'),
            priority_medium_min_amount=Decimal('500.00'),
        )
        order = self.make_order(total=Decimal('600.00'))
        # 600 is below the custom high (1000) but at/above custom medium (500).
        self.assertEqual(
            OrderPriorityService.compute(order, stock_status=self.SS.IN_STOCK), self.PL.MEDIUM,
        )


class OrderStockStatusTests(_BaseOrderServiceTest):
    """STATUS_MAP.md 5.5 — stock_status + mapping_required snapshot."""

    def _order_with_line(self, *, quantity, product=None, is_linked=True, link_product=True):
        order = self.persist_order(order_status=Order.OrderStatus.CONFIRMED)
        OrderLine.objects.create(
            order=order,
            product=(product if link_product else None),
            product_name='Finished Perfume',
            quantity=quantity,
            unit_price='100.00',
            subtotal=str(quantity * 100),
            total=str(quantity * 100),
            is_linked=is_linked,
        )
        return order

    def test_in_stock(self):
        order = self._order_with_line(quantity=5, product=self.product)
        snap = OrderStockAvailabilityService.status_snapshot(order)
        self.assertEqual(snap['stock_status'], Order.StockStatus.IN_STOCK)
        self.assertFalse(snap['mapping_required'])

    def test_partial_stock(self):
        order = self._order_with_line(quantity=15, product=self.product)  # only 10 available
        snap = OrderStockAvailabilityService.status_snapshot(order)
        self.assertEqual(snap['stock_status'], Order.StockStatus.PARTIAL_STOCK)

    def test_out_of_stock_when_no_inventory_row(self):
        other = Product.objects.create(
            brand=self.brand, name='No-stock item', barcode='NS-1',
            product_type=Product.ProductType.RESELL_PRODUCT, sales_price='10.00',
        )
        order = self._order_with_line(quantity=1, product=other)
        snap = OrderStockAvailabilityService.status_snapshot(order)
        self.assertEqual(snap['stock_status'], Order.StockStatus.OUT_OF_STOCK)

    def test_mapping_required_when_line_unlinked(self):
        order = self._order_with_line(quantity=1, is_linked=False, link_product=False)
        snap = OrderStockAvailabilityService.status_snapshot(order)
        self.assertTrue(snap['mapping_required'])


class WooCommerceSyncServiceTests(_BaseOrderServiceTest):
    """STATUS_MAP.md 5.8 / 5.9 / 5.11 — local stays the source of truth."""

    def _wc_order(self, *, order_status=Order.OrderStatus.DONE, sync=Order.SyncStatus.IMPORTED):
        return self.persist_order(
            order_status=order_status,
            source=Order.Source.WOOCOMMERCE,
            external_order_id='9001',
            sync_status=sync,
        )

    @staticmethod
    def _resp(status_code, text=''):
        resp = mock.Mock()
        resp.status_code = status_code
        resp.text = text
        return resp

    def test_parks_pending_sync_when_push_disabled(self):
        order = self._wc_order()
        with mock.patch.object(WooCommerceSyncService, '_build_client') as build:
            result = WooCommerceSyncService.update_order_status(order, actor=self.actor)
        build.assert_not_called()  # no network when the gate is closed
        self.assertEqual(result.sync_status, Order.SyncStatus.PENDING_SYNC)
        self.assertEqual(result.wc_status, '')

    def test_non_woocommerce_order_is_noop(self):
        order = self.persist_order(
            order_status=Order.OrderStatus.DONE, source=Order.Source.POS,
            sync_status=Order.SyncStatus.IMPORTED,
        )
        with mock.patch.object(WooCommerceSyncService, '_build_client') as build:
            WooCommerceSyncService.update_order_status(order, actor=self.actor, force=True)
        build.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.sync_status, Order.SyncStatus.IMPORTED)

    def test_forced_push_success_marks_synced(self):
        order = self._wc_order()
        fake = mock.Mock()
        fake.put.return_value = self._resp(200)
        with mock.patch.object(WooCommerceSyncService, '_build_client', return_value=fake):
            WooCommerceSyncService.update_order_status(order, actor=self.actor, force=True)
        order.refresh_from_db()
        fake.put.assert_called_once_with('orders/9001', {'status': 'completed'})
        self.assertEqual(order.sync_status, Order.SyncStatus.SYNCED)
        self.assertEqual(order.wc_status, 'completed')
        self.assertIsNotNone(order.last_sync_at)
        self.assertEqual(order.sync_error_message, '')
        self.assertTrue(
            OrderLog.objects.filter(
                order=order, action=OrderLog.Action.WOOCOMMERCE_STATUS_CHANGED,
            ).exists()
        )

    def test_cancel_push_logs_cancel_synced(self):
        order = self._wc_order(order_status=Order.OrderStatus.CANCELED)
        fake = mock.Mock()
        fake.put.return_value = self._resp(200)
        with mock.patch.object(WooCommerceSyncService, '_build_client', return_value=fake):
            WooCommerceSyncService.update_order_status(order, actor=self.actor, force=True)
        order.refresh_from_db()
        fake.put.assert_called_once_with('orders/9001', {'status': 'cancelled'})
        self.assertEqual(order.wc_status, 'cancelled')
        self.assertTrue(
            OrderLog.objects.filter(
                order=order, action=OrderLog.Action.WC_CANCEL_SYNCED,
            ).exists()
        )

    def test_failed_push_keeps_local_and_records_error(self):
        order = self._wc_order()
        fake = mock.Mock()
        fake.put.return_value = self._resp(500, 'kaboom')
        with mock.patch.object(WooCommerceSyncService, '_build_client', return_value=fake):
            # Must NOT raise — local order_status stands.
            WooCommerceSyncService.update_order_status(order, actor=self.actor, force=True)
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.DONE)  # unchanged
        self.assertEqual(order.sync_status, Order.SyncStatus.SYNC_FAILED)
        self.assertIn('500', order.sync_error_message)
        self.assertTrue(
            OrderLog.objects.filter(order=order, action=OrderLog.Action.SYNC_FAILED).exists()
        )

    def test_retry_after_failure_succeeds(self):
        order = self._wc_order(sync=Order.SyncStatus.SYNC_FAILED)
        fake = mock.Mock()
        fake.put.return_value = self._resp(200)
        with mock.patch.object(WooCommerceSyncService, '_build_client', return_value=fake):
            WooCommerceSyncService.retry(order, actor=self.actor)
        order.refresh_from_db()
        self.assertEqual(order.sync_status, Order.SyncStatus.SYNCED)
        self.assertTrue(
            OrderLog.objects.filter(
                order=order, action=OrderLog.Action.WC_SYNC_RETRIED,
            ).exists()
        )


class ManualTransitionTests(_BaseOrderServiceTest):
    """STATUS_MAP.md 6.3 — permission-gated, reason-required, audited rollbacks."""

    def setUp(self):
        super().setUp()
        self.admin = get_user_model().objects.create_user(
            matricule='ADMIN1', email='admin@example.com', password='x',
        )
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])

    def _confirmed_order(self):
        order, _ = self.service.ingest(
            self.payload(quantity=1, order_id=8100, status='pending'), self.channel,
        )
        OrderLifecycleService.confirm(order, actor=self.actor)
        order.refresh_from_db()
        return order

    def test_requires_permission(self):
        order = self._confirmed_order()
        with self.assertRaises(LifecycleError):
            OrderLifecycleService.manual_transition(
                order, target=Order.OrderStatus.AWAITING_CONFIRMATION,
                actor=self.actor, reason='nope',
            )

    def test_requires_actor(self):
        order = self._confirmed_order()
        with self.assertRaises(LifecycleError):
            OrderLifecycleService.manual_transition(
                order, target=Order.OrderStatus.AWAITING_CONFIRMATION,
                actor=None, reason='nope',
            )

    def test_requires_reason(self):
        order = self._confirmed_order()
        with self.assertRaises(LifecycleError):
            OrderLifecycleService.manual_transition(
                order, target=Order.OrderStatus.AWAITING_CONFIRMATION,
                actor=self.admin, reason='   ',
            )

    def test_disallowed_target_rejected(self):
        order = self._confirmed_order()
        with self.assertRaises(LifecycleError):
            OrderLifecycleService.manual_transition(
                order, target=Order.OrderStatus.DONE, actor=self.admin, reason='skip ahead',
            )

    def test_confirmed_to_awaiting_with_audit(self):
        order = self._confirmed_order()
        self.assertEqual(order.order_status, Order.OrderStatus.CONFIRMED)
        OrderLifecycleService.manual_transition(
            order, target=Order.OrderStatus.AWAITING_CONFIRMATION,
            actor=self.admin, reason='Customer wants to change items',
        )
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.AWAITING_CONFIRMATION)
        log = OrderLog.objects.filter(
            order=order, action=OrderLog.Action.MANUAL_STATUS_OVERRIDE,
        ).latest('id')
        self.assertEqual(log.details['reason'], 'Customer wants to change items')
        self.assertEqual(log.details['old'], Order.OrderStatus.CONFIRMED)
        self.assertEqual(log.details['new'], Order.OrderStatus.AWAITING_CONFIRMATION)

    def test_canceled_reopen_to_confirmed(self):
        order, _ = self.service.ingest(
            self.payload(quantity=1, order_id=8200, status='pending'), self.channel,
        )
        OrderLifecycleService.cancel(order, actor=self.actor, reason='Wrong address')
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.CANCELED)

        OrderLifecycleService.manual_transition(
            order, target=Order.OrderStatus.CONFIRMED, actor=self.admin, reason='Customer called back',
        )
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.CONFIRMED)
        self.assertEqual(order.status, Order.Status.PROCESSING)

    def test_returned_to_done_rededucts_stock(self):
        # MANUAL order: the sale is recorded at ingest (10 -> 8).
        order, _ = self.service.ingest(
            self.payload(quantity=2, order_id=8300), self.channel, source=Order.Source.MANUAL,
        )
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 8)
        OrderLifecycleService.confirm(order, actor=self.actor)
        order.delivery_status = Order.DeliveryStatus.DELIVERED
        order.save(update_fields=['delivery_status', 'updated_at'])
        # GOOD return restores stock (8 -> 10) and net SALE/RETURN_IN nets to 0.
        OrderLifecycleService.process_return(order, actor=self.actor, reason='changed mind')
        self.inventory.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 10)
        self.assertEqual(order.order_status, Order.OrderStatus.RETURNED)

        # Override returned -> done must re-deduct exactly once (10 -> 8).
        OrderLifecycleService.manual_transition(
            order, target=Order.OrderStatus.DONE, actor=self.admin, reason='Customer kept it',
        )
        self.inventory.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.DONE)
        self.assertEqual(self.inventory.quantity, 8)

    def test_returned_to_done_does_not_double_deduct_damaged_units(self):
        # MANUAL order: sale recorded (10 -> 8).
        order, _ = self.service.ingest(
            self.payload(quantity=2, order_id=8400), self.channel, source=Order.Source.MANUAL,
        )
        OrderLifecycleService.confirm(order, actor=self.actor)
        order.delivery_status = Order.DeliveryStatus.DELIVERED
        order.save(update_fields=['delivery_status', 'updated_at'])
        # DAMAGED return: units are NOT returned to the available bin (stays 8).
        OrderLifecycleService.process_return(
            order, actor=self.actor, reason='broken', return_type=Order.ReturnType.DAMAGED,
        )
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 8)

        # Override returned -> done: the delta engine already has the units moved,
        # so it must be a no-op (must NOT deduct again down to 6).
        OrderLifecycleService.manual_transition(
            order, target=Order.OrderStatus.DONE, actor=self.admin, reason='Re-sold as-is',
        )
        self.inventory.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(order.order_status, Order.OrderStatus.DONE)
        self.assertEqual(self.inventory.quantity, 8)


class OrderKPIServiceTests(_BaseOrderServiceTest):
    """STATUS_MAP.md 7 — only ``done`` counts as a realised sale / revenue."""

    def setUp(self):
        super().setUp()
        OS = Order.OrderStatus
        self.persist_order(order_status=OS.DONE, total='100.00')
        self.persist_order(order_status=OS.DONE, total='100.00')
        self.persist_order(order_status=OS.RETURNED, total='100.00')
        self.persist_order(order_status=OS.EXCHANGED, total='100.00')
        self.persist_order(order_status=OS.CANCELED, total='100.00')
        self.persist_order(order_status=OS.NEW, total='50.00')
        self.persist_order(order_status=OS.CONFIRMED, total='100.00')

    def test_revenue_and_buckets_exclude_returns_exchanges_cancels(self):
        kpi = OrderKPIService.compute(company=self.company)
        self.assertEqual(kpi['total_orders'], 7)
        self.assertEqual(kpi['successful_sales'], 2)
        self.assertEqual(kpi['revenue'], Decimal('200.00'))
        self.assertEqual(kpi['returned'], 1)
        self.assertEqual(kpi['exchanged'], 1)
        self.assertEqual(kpi['canceled'], 1)
        self.assertEqual(kpi['in_confirmation'], 1)   # the NEW order
        self.assertEqual(kpi['in_fulfillment'], 1)    # the CONFIRMED order

    def test_revenue_zero_when_no_successful_sales(self):
        # A separate company with only a returned order shows no revenue.
        other = Company.objects.create(name='Other Co', abbreviation='OTH')
        brand = Brand.objects.create(company=other, name='Other Brand')
        channel = SalesChannel.objects.create(
            brand=brand, name='Web', code='OWEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        Order.objects.filter(pk=Order.objects.create(
            company=other, brand=brand, sales_channel=channel,
            source=Order.Source.WOOCOMMERCE, order_number='OTH-1', total=Decimal('100.00'),
        ).pk).update(order_status=Order.OrderStatus.RETURNED)
        kpi = OrderKPIService.compute(company=other)
        self.assertEqual(kpi['successful_sales'], 0)
        self.assertEqual(kpi['revenue'], Decimal('0.00'))
        self.assertEqual(kpi['returned'], 1)
