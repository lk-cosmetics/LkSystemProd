"""
BI dashboard revenue must reflect COMPLETED (``done``) orders only.

Covers the two guarantees the dashboard makes about Total Revenue:
  1. Only ``done`` orders contribute — pending / confirmed / packaging /
     returned / canceled never inflate revenue.
  2. It self-heals: when an order leaves ``done`` (e.g. returned) a recompute
     of its day removes its amount automatically.
"""

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.bi.models import DailyBrandChannelStats
from apps.bi.services import aggregation, dashboard
from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order, OrderLine
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class DashboardRevenueDoneOnlyTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Rev Co', abbreviation='RVC')
        self.brand = Brand.objects.create(company=self.company, name='Rev Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Web Store',
            code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
        )
        self.product = Product.objects.create(
            brand=self.brand,
            name='Widget',
            barcode='REV-W-1',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='100.00',
        )

    def _order(self, *, status, total, number):
        order = Order.objects.create(
            company=self.company,
            brand=self.brand,
            sales_channel=self.channel,
            order_number=number,
            source=Order.Source.WOOCOMMERCE,
            status=status,
            payment_status=Order.PaymentStatus.PAID,
            total=total,
        )
        OrderLine.objects.create(
            order=order,
            product=self.product,
            product_name=self.product.name,
            quantity=1,
            unit_price=total,
            subtotal=total,
            total=total,
        )
        return order

    def _recompute(self, order):
        day = timezone.localtime(order.created_at).date()
        aggregation.recompute_for_company_brand_date(self.company.id, self.brand.id, day)
        return day

    def _dashboard_revenue(self):
        data = dashboard.summary(
            company_id=self.company.id, brand_id=self.brand.id, period='30d',
        )
        return Decimal(data['total_revenue'])

    def test_only_done_orders_count_toward_revenue(self):
        S = Order.Status
        # A spread of non-done statuses that must NOT contribute.
        self._order(status=S.NEW,          total='11.00', number='O-NEW')
        self._order(status=S.CONFIRMED,    total='22.00', number='O-CONF')
        self._order(status=S.NOT_ANSWERED, total='33.00', number='O-NA')
        self._order(status=S.PACKAGING,    total='44.00', number='O-PACK')
        self._order(status=S.RETURNED,     total='55.00', number='O-RET')
        self._order(status=S.CANCELED,     total='66.00', number='O-CAN')
        done = self._order(status=S.DONE,  total='100.00', number='O-DONE')

        day = self._recompute(done)

        row = DailyBrandChannelStats.objects.get(
            company=self.company, brand=self.brand,
            sales_channel=self.channel, date=day,
        )
        # Stored per-channel revenue is the single done order — nothing else.
        self.assertEqual(row.revenue, Decimal('100.00'))
        # And the dashboard KPI agrees.
        self.assertEqual(self._dashboard_revenue(), Decimal('100.00'))

    def test_revenue_drops_when_order_leaves_done(self):
        done = self._order(status=Order.Status.DONE, total='100.00', number='O-DONE-2')
        day = self._recompute(done)
        self.assertEqual(self._dashboard_revenue(), Decimal('100.00'))

        # The order is returned → after its day is recomputed, its amount is gone.
        done.status = Order.Status.RETURNED
        done.save(update_fields=['status'])
        aggregation.recompute_for_company_brand_date(self.company.id, self.brand.id, day)

        self.assertEqual(self._dashboard_revenue(), Decimal('0'))
        stored = sum(
            (r.revenue for r in DailyBrandChannelStats.objects.filter(
                company=self.company, brand=self.brand, date=day)),
            Decimal('0'),
        )
        self.assertEqual(stored, Decimal('0'))
