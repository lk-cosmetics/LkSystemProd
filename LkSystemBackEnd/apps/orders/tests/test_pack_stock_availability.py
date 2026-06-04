"""
Pack stock availability in order management.

A PACK product carries no inventory row of its own — its availability is the
stock of the *components* it expands into. The order-detail stock views
(``channel_breakdown`` / ``status_snapshot`` / ``build``) and the delivery/POS
gate (``shortfalls_for_channel``) must therefore check COMPONENT stock for a
pack line, exactly as the sale engine does when it decrements.

Regression: a pack whose components were in stock used to show
"Short / No inventory row in this channel" in the order Stock tab because the
availability service aggregated by the pack's own product id (which has no
stock row) instead of expanding it into its components.

Run with::

    python manage.py test apps.orders.tests.test_pack_stock_availability
"""

from decimal import Decimal

from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import SalesChannelInventory
from apps.orders.models import Order, OrderLine
from apps.orders.stock_service import OrderStockAvailabilityService
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class PackStockAvailabilityTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Co', abbreviation='CO')
        self.brand = Brand.objects.create(company=self.company, name='Br')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='Woo', code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        # A pack consumes 1x comp_a and 2x comp_b per unit.
        self.comp_a = Product.objects.create(
            brand=self.brand, name='Beurre Capillaire', barcode='COMP-A',
            product_type=Product.ProductType.RESELL_PRODUCT, sales_price='10.00',
        )
        self.comp_b = Product.objects.create(
            brand=self.brand, name='Brume Visage', barcode='COMP-B',
            product_type=Product.ProductType.RESELL_PRODUCT, sales_price='15.00',
        )
        self.pack = Product.objects.create(
            brand=self.brand, name='Pack Summer Essentials', barcode='PACK-1',
            product_type=Product.ProductType.RESELL_PRODUCT, is_pack=True,
            pack_items=[
                {'product_id': self.comp_a.id, 'quantity': 1},
                {'product_id': self.comp_b.id, 'quantity': 2},
            ],
            sales_price='35.00',
        )
        # Components are in stock; the PACK itself has NO inventory row (by design).
        self.inv_a = SalesChannelInventory.objects.create(
            sales_channel=self.channel, product=self.comp_a, quantity=227,
        )
        self.inv_b = SalesChannelInventory.objects.create(
            sales_channel=self.channel, product=self.comp_b, quantity=493,
        )

    def _order_with_pack(self, qty=1):
        order = Order.objects.create(
            company=self.company, sales_channel=self.channel, brand=self.brand,
            order_number=f'ORD-PACK-{Order.objects.count()}',
            external_order_id=f'PK{Order.objects.count()}',
            source=Order.Source.WOOCOMMERCE,
            status=Order.Status.PROCESSING,
            billing_first_name='T', billing_last_name='C', billing_phone='+21620000000',
            total=Decimal('35.00') * qty,
        )
        OrderLine.objects.create(
            order=order, product=self.pack, product_name=self.pack.name,
            barcode=self.pack.barcode, is_linked=True, quantity=qty,
            unit_price=Decimal('35.00'),
            subtotal=Decimal('35.00') * qty, total=Decimal('35.00') * qty,
        )
        return order

    # ── components in stock: the pack is fulfillable ────────────────────
    def test_channel_breakdown_expands_pack_into_components(self):
        order = self._order_with_pack(qty=1)
        data = OrderStockAvailabilityService.channel_breakdown(order)

        # The pack is expanded into its two components — its own id never appears.
        self.assertEqual(data['tracked_product_count'], 2)
        order_tab = next(c for c in data['channels'] if c['is_order_channel'])
        listed = {it['product_id']: it for it in order_tab['items']}
        self.assertEqual(set(listed), {self.comp_a.id, self.comp_b.id})
        self.assertNotIn(self.pack.id, listed)

        self.assertEqual(listed[self.comp_a.id]['required_quantity'], 1)
        self.assertEqual(listed[self.comp_b.id]['required_quantity'], 2)
        self.assertEqual(listed[self.comp_a.id]['available_quantity'], 227)
        self.assertEqual(listed[self.comp_b.id]['available_quantity'], 493)
        self.assertTrue(listed[self.comp_a.id]['is_sufficient'])
        self.assertTrue(listed[self.comp_b.id]['is_sufficient'])
        self.assertTrue(listed[self.comp_a.id]['has_inventory_row'])
        self.assertTrue(order_tab['can_fulfill'])

    def test_status_snapshot_in_stock_for_pack(self):
        snap = OrderStockAvailabilityService.status_snapshot(self._order_with_pack(qty=1))
        self.assertEqual(snap['stock_status'], Order.StockStatus.IN_STOCK)
        self.assertFalse(snap['mapping_required'])

    def test_no_shortfalls_when_components_in_stock(self):
        order = self._order_with_pack(qty=1)
        self.assertEqual(
            OrderStockAvailabilityService.shortfalls_for_channel(order, self.channel.id),
            [],
        )

    def test_build_can_fulfill_from_website_with_pack(self):
        data = OrderStockAvailabilityService.build(self._order_with_pack(qty=1))
        self.assertTrue(data['can_fulfill_from_website'])
        self.assertEqual(
            {it['product_id'] for it in data['items']},
            {self.comp_a.id, self.comp_b.id},
        )

    def test_pack_quantity_multiplies_component_requirements(self):
        order = self._order_with_pack(qty=3)  # 3x comp_a, 6x comp_b
        required, _meta, _unlinked = (
            OrderStockAvailabilityService._required_customer_quantities(order)
        )
        self.assertEqual(required[self.comp_a.id], 3)
        self.assertEqual(required[self.comp_b.id], 6)
        self.assertNotIn(self.pack.id, required)

    # ── a short component makes the whole pack unfulfillable ────────────
    def test_component_shortfall_blocks_pack(self):
        self.inv_b.quantity = 1   # need 2, only 1 available
        self.inv_b.save(update_fields=['quantity'])
        order = self._order_with_pack(qty=1)

        shortfalls = OrderStockAvailabilityService.shortfalls_for_channel(order, self.channel.id)
        self.assertEqual(len(shortfalls), 1)
        self.assertEqual(shortfalls[0]['product_id'], self.comp_b.id)
        self.assertEqual(shortfalls[0]['missing'], 1)

        snap = OrderStockAvailabilityService.status_snapshot(order)
        self.assertEqual(snap['stock_status'], Order.StockStatus.PARTIAL_STOCK)

        order_tab = next(
            c for c in OrderStockAvailabilityService.channel_breakdown(order)['channels']
            if c['is_order_channel']
        )
        self.assertFalse(order_tab['can_fulfill'])

    def test_component_out_of_stock_marks_pack_out(self):
        self.inv_b.quantity = 0
        self.inv_b.save(update_fields=['quantity'])
        snap = OrderStockAvailabilityService.status_snapshot(self._order_with_pack(qty=1))
        self.assertEqual(snap['stock_status'], Order.StockStatus.OUT_OF_STOCK)

    # ── a misconfigured pack degrades to a warning, never crashes a read ─
    def test_misconfigured_pack_degrades_without_crashing(self):
        order = self._order_with_pack(qty=1)
        # Inject a dangling component reference WITHOUT model validation
        # (``.update()`` bypasses ``Product.save``/``clean``).
        Product.objects.filter(pk=self.pack.pk).update(
            pack_items=[{'product_id': 9_999_999, 'quantity': 1}],
        )

        # No read path may raise just because a pack is misconfigured.
        snap = OrderStockAvailabilityService.status_snapshot(order)
        self.assertTrue(snap['mapping_required'])

        breakdown = OrderStockAvailabilityService.channel_breakdown(order)
        self.assertEqual(breakdown['tracked_product_count'], 0)
        self.assertEqual(len(breakdown['unlinked_lines']), 1)
        self.assertEqual(breakdown['unlinked_lines'][0]['reason'], 'pack_invalid')

        built = OrderStockAvailabilityService.build(order)
        self.assertFalse(built['can_fulfill_from_website'])
        self.assertEqual(len(built['unlinked_lines']), 1)
