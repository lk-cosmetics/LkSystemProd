"""
Regression tests for pack-aware order returns.

Selling a pack creates SALE movements for its component products. Returning a
GOOD pack must create matching RETURN_IN movements for those components, while
a DAMAGED pack records component-level DAMAGE movements without changing
available stock.

    python manage.py test apps.orders.tests.test_pack_return_stock
"""
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.lifecycle_service import LifecycleError, OrderLifecycleService
from apps.orders.models import Order, OrderLine
from apps.orders.serializers import OrderLineSerializer
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class PackReturnStockTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='PR Co', abbreviation='PRC')
        self.brand = Brand.objects.create(company=self.company, name='PR Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='PR POS',
            code='PRPOS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        self.component_a = Product.objects.create(
            brand=self.brand,
            name='Component A',
            barcode='COMP-A',
            sales_price=Decimal('10.00'),
            product_type=Product.ProductType.RESELL_PRODUCT,
        )
        self.component_b = Product.objects.create(
            brand=self.brand,
            name='Component B',
            barcode='COMP-B',
            sales_price=Decimal('12.00'),
            product_type=Product.ProductType.RESELL_PRODUCT,
        )
        self.standalone = Product.objects.create(
            brand=self.brand,
            name='Standalone',
            barcode='STD1',
            sales_price=Decimal('5.00'),
            product_type=Product.ProductType.RESELL_PRODUCT,
        )
        self.pack = Product.objects.create(
            brand=self.brand,
            name='Gift Pack',
            barcode='PACK1',
            sales_price=Decimal('25.00'),
            product_type=Product.ProductType.PACK,
            is_pack=True,
            pack_items=[
                {'product_id': self.component_a.id, 'quantity': 1},
                {'product_id': self.component_b.id, 'quantity': 2},
            ],
        )
        for product in (self.component_a, self.component_b, self.standalone):
            SalesChannelInventory.objects.create(
                sales_channel=self.channel,
                product=product,
                quantity=100,
            )

    def _order_with_pack(self, order_number='PR-1', pack_quantity=1):
        order = Order.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            order_number=order_number,
            status=Order.Status.DONE,
            source=Order.Source.POS,
            pos_validated_at=timezone.now(),
        )
        pack_line = OrderLine.objects.create(
            order=order,
            product=self.pack,
            product_name='Gift Pack',
            quantity=pack_quantity,
            unit_price=Decimal('25.00'),
            subtotal=Decimal('25.00') * pack_quantity,
            tax=Decimal('0.00'),
            total=Decimal('25.00') * pack_quantity,
        )
        standalone_line = OrderLine.objects.create(
            order=order,
            product=self.standalone,
            product_name='Standalone',
            quantity=3,
            unit_price=Decimal('5.00'),
            subtotal=Decimal('15.00'),
            tax=Decimal('0.00'),
            total=Decimal('15.00'),
        )
        return order, pack_line, standalone_line

    def _record_sale(self, order, pack_quantity=1):
        sold = (
            (self.component_a, pack_quantity),
            (self.component_b, pack_quantity * 2),
            (self.standalone, 3),
        )
        for product, quantity in sold:
            inventory = SalesChannelInventory.objects.get(
                sales_channel=self.channel,
                product=product,
            )
            InventoryMovement.objects.create(
                sales_channel=self.channel,
                product=product,
                movement_type=InventoryMovement.MovementType.SALE,
                status=InventoryMovement.MovementStatus.COMPLETED,
                quantity=quantity,
                quantity_before=inventory.quantity,
                quantity_after=inventory.quantity - quantity,
                external_reference=order.order_number,
                notes=(
                    f"Auto sale movement for order {order.order_number}"
                    + (f" (pack: {self.pack.name})" if product != self.standalone else '')
                ),
                completed_at=timezone.now(),
            )

    def test_order_line_serializer_exposes_pack_components(self):
        _, pack_line, _ = self._order_with_pack()

        data = OrderLineSerializer(pack_line).data

        self.assertTrue(data['is_pack'])
        self.assertEqual(
            [
                (item['product_id'], item['product_name'], item['quantity'])
                for item in data['pack_items_detail']
            ],
            [
                (self.component_a.id, 'Component A', 1),
                (self.component_b.id, 'Component B', 2),
            ],
        )

    def test_good_pack_return_restores_each_component_and_records_source(self):
        order, pack_line, standalone_line = self._order_with_pack(pack_quantity=2)
        self._record_sale(order, pack_quantity=2)

        OrderLifecycleService.process_return(
            order,
            reason='Pack returned in good condition',
            line_conditions=[
                {'line_id': pack_line.id, 'condition': OrderLine.ReturnCondition.GOOD},
                {'line_id': standalone_line.id, 'condition': OrderLine.ReturnCondition.DAMAGED},
            ],
        )

        inventory_a = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.component_a,
        )
        inventory_b = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.component_b,
        )
        standalone_inventory = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.standalone,
        )
        self.assertEqual(inventory_a.quantity, 100)
        self.assertEqual(inventory_b.quantity, 100)
        self.assertEqual(standalone_inventory.quantity, 97)

        component_returns = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            movement_type=InventoryMovement.MovementType.RETURN_IN,
        ).order_by('product_id')
        self.assertEqual(
            list(component_returns.values_list('product_id', 'quantity')),
            [
                (self.component_a.id, 2),
                (self.component_b.id, 4),
            ],
        )
        self.assertTrue(all('pack: Gift Pack' in movement.notes for movement in component_returns))
        self.assertFalse(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                product=self.pack,
            ).exists()
        )

    def test_damaged_pack_records_each_component_without_restocking(self):
        order, pack_line, standalone_line = self._order_with_pack(order_number='PR-2')
        self._record_sale(order)

        OrderLifecycleService.process_return(
            order,
            reason='Pack returned damaged',
            line_conditions=[
                {'line_id': pack_line.id, 'condition': OrderLine.ReturnCondition.DAMAGED},
                {'line_id': standalone_line.id, 'condition': OrderLine.ReturnCondition.GOOD},
            ],
        )

        inventory_a = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.component_a,
        )
        inventory_b = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.component_b,
        )
        standalone_inventory = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.standalone,
        )
        self.assertEqual(inventory_a.quantity, 99)
        self.assertEqual(inventory_b.quantity, 98)
        self.assertEqual(standalone_inventory.quantity, 100)

        damage_movements = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            movement_type=InventoryMovement.MovementType.DAMAGE,
        ).order_by('product_id')
        self.assertEqual(
            list(damage_movements.values_list('product_id', 'quantity')),
            [
                (self.component_a.id, 1),
                (self.component_b.id, 2),
            ],
        )
        self.assertTrue(all('pack: Gift Pack' in movement.notes for movement in damage_movements))
        self.assertFalse(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                product__in=[self.component_a, self.component_b],
                movement_type=InventoryMovement.MovementType.RETURN_IN,
            ).exists()
        )

    def test_pack_components_can_have_mixed_unit_conditions(self):
        order, pack_line, standalone_line = self._order_with_pack(order_number='PR-MIXED')
        self._record_sale(order)

        OrderLifecycleService.process_return(
            order,
            reason='One of the two Component B units is damaged',
            line_conditions=[
                {
                    'line_id': pack_line.id,
                    'condition': OrderLine.ReturnCondition.DAMAGED,
                    'component_conditions': [
                        {
                            'product_id': self.component_a.id,
                            'quantity': 1,
                            'condition': OrderLine.ReturnCondition.GOOD,
                        },
                        {
                            'product_id': self.component_b.id,
                            'quantity': 1,
                            'condition': OrderLine.ReturnCondition.GOOD,
                        },
                        {
                            'product_id': self.component_b.id,
                            'quantity': 1,
                            'condition': OrderLine.ReturnCondition.DAMAGED,
                        },
                    ],
                },
                {
                    'line_id': standalone_line.id,
                    'condition': OrderLine.ReturnCondition.GOOD,
                },
            ],
        )

        pack_line.refresh_from_db()
        inventory_a = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.component_a,
        )
        inventory_b = SalesChannelInventory.objects.get(
            sales_channel=self.channel,
            product=self.component_b,
        )
        self.assertEqual(pack_line.return_condition, OrderLine.ReturnCondition.DAMAGED)
        self.assertEqual(inventory_a.quantity, 100)
        self.assertEqual(inventory_b.quantity, 99)

        component_b_movements = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            product=self.component_b,
            movement_type__in=[
                InventoryMovement.MovementType.RETURN_IN,
                InventoryMovement.MovementType.DAMAGE,
            ],
        ).order_by('movement_type')
        self.assertEqual(
            set(component_b_movements.values_list('movement_type', 'quantity')),
            {
                (InventoryMovement.MovementType.RETURN_IN, 1),
                (InventoryMovement.MovementType.DAMAGE, 1),
            },
        )
        self.assertTrue(
            all('pack: Gift Pack' in movement.notes for movement in component_b_movements)
        )

    def test_incomplete_pack_component_classification_is_rejected_atomically(self):
        order, pack_line, standalone_line = self._order_with_pack(
            order_number='PR-INCOMPLETE',
        )
        self._record_sale(order)

        with self.assertRaisesMessage(
            LifecycleError,
            'Component B: expected 2, classified 1',
        ):
            OrderLifecycleService.process_return(
                order,
                reason='Incomplete component payload',
                line_conditions=[
                    {
                        'line_id': pack_line.id,
                        'condition': OrderLine.ReturnCondition.GOOD,
                        'component_conditions': [
                            {
                                'product_id': self.component_a.id,
                                'quantity': 1,
                                'condition': OrderLine.ReturnCondition.GOOD,
                            },
                            {
                                'product_id': self.component_b.id,
                                'quantity': 1,
                                'condition': OrderLine.ReturnCondition.GOOD,
                            },
                        ],
                    },
                    {
                        'line_id': standalone_line.id,
                        'condition': OrderLine.ReturnCondition.GOOD,
                    },
                ],
            )

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DONE)
        self.assertFalse(
            InventoryMovement.objects.filter(
                external_reference=order.order_number,
                movement_type__in=[
                    InventoryMovement.MovementType.RETURN_IN,
                    InventoryMovement.MovementType.DAMAGE,
                ],
            ).exists()
        )

    def test_legacy_whole_order_return_restores_pack_components(self):
        order, _, _ = self._order_with_pack(order_number='PR-3')
        self._record_sale(order)

        OrderLifecycleService.process_return(order, reason='Legacy whole-order return')

        for product in (self.component_a, self.component_b, self.standalone):
            inventory = SalesChannelInventory.objects.get(
                sales_channel=self.channel,
                product=product,
            )
            self.assertEqual(inventory.quantity, 100)

        component_returns = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            product__in=[self.component_a, self.component_b],
            movement_type=InventoryMovement.MovementType.RETURN_IN,
        )
        self.assertEqual(component_returns.count(), 2)
        self.assertTrue(
            all('pack component: Gift Pack' in movement.notes for movement in component_returns)
        )


class NonPackUnitReturnTests(TestCase):
    """A normal (non-pack) line returned unit by unit: some units restock as
    GOOD, the rest are written off as DAMAGED via a per-unit quantity split."""

    def setUp(self):
        self.company = Company.objects.create(name='UR Co', abbreviation='URC')
        self.brand = Brand.objects.create(company=self.company, name='UR Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='UR POS', code='URPOS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        self.product = Product.objects.create(
            brand=self.brand, name='Brume Visage', barcode='BRUME-1',
            sales_price=Decimal('40.00'),
            product_type=Product.ProductType.RESELL_PRODUCT,
        )
        self.inventory = SalesChannelInventory.objects.create(
            sales_channel=self.channel, product=self.product, quantity=100,
        )

    def _done_order(self, *, number, qty):
        order = Order.objects.create(
            company=self.company, brand=self.brand, sales_channel=self.channel,
            order_number=number, status=Order.Status.DONE,
            source=Order.Source.POS, pos_validated_at=timezone.now(),
        )
        line = OrderLine.objects.create(
            order=order, product=self.product, product_name=self.product.name,
            barcode='BRUME-1', quantity=qty, unit_price=Decimal('40.00'),
            subtotal=Decimal('40.00') * qty, tax=Decimal('0.00'),
            total=Decimal('40.00') * qty,
        )
        return order, line

    def test_mixed_units_split_good_back_to_stock_damaged_as_waste(self):
        order, line = self._done_order(number='UR-MIX', qty=3)

        OrderLifecycleService.process_return(
            order,
            return_type=Order.ReturnType.RETURNED,
            line_conditions=[{
                'line_id': line.id,
                'condition': 'DAMAGED',
                'component_conditions': [
                    {'product_id': self.product.id, 'quantity': 2, 'condition': 'GOOD'},
                    {'product_id': self.product.id, 'quantity': 1, 'condition': 'DAMAGED'},
                ],
            }],
        )

        order.refresh_from_db()
        line.refresh_from_db()
        self.inventory.refresh_from_db()
        self.assertEqual(order.status, Order.Status.RETURNED)
        self.assertEqual(line.return_condition, OrderLine.ReturnCondition.DAMAGED)
        # Only the 2 GOOD units return to stock; the damaged one is written off.
        self.assertEqual(self.inventory.quantity, 102)
        ret_in = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            product=self.product,
            movement_type=InventoryMovement.MovementType.RETURN_IN,
        )
        damage = InventoryMovement.objects.filter(
            external_reference=order.order_number,
            product=self.product,
            movement_type=InventoryMovement.MovementType.DAMAGE,
        )
        self.assertEqual([m.quantity for m in ret_in], [2])
        self.assertEqual([m.quantity for m in damage], [1])
        # Non-pack movements must NOT be tagged as pack returns.
        self.assertFalse(any('pack' in m.notes.lower() for m in ret_in))

    def test_all_units_good_uses_simple_whole_line_restock(self):
        order, line = self._done_order(number='UR-GOOD', qty=2)

        OrderLifecycleService.process_return(
            order,
            return_type=Order.ReturnType.RETURNED,
            line_conditions=[{'line_id': line.id, 'condition': 'GOOD'}],
        )

        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 102)
