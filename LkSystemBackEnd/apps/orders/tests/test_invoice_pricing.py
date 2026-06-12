from decimal import Decimal

from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order, OrderLine
from apps.orders.serializers import OrderLineSerializer
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class InvoicePricingSerializerTests(TestCase):
    def test_order_line_exposes_catalogue_price_for_promotion_display(self):
        company = Company.objects.create(name='Invoice Co', abbreviation='INV')
        brand = Brand.objects.create(name='Invoice Brand', company=company)
        product = Product.objects.create(
            brand=brand,
            name='Promoted Pack',
            barcode='PROMO-PACK',
            product_type=Product.ProductType.PACK,
            sales_price=Decimal('225.00'),
        )
        channel = SalesChannel.objects.create(
            brand=brand,
            name='Invoice POS',
            code='INV-POS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        order = Order.objects.create(
            company=company,
            sales_channel=channel,
            order_number='INV-1',
        )
        line = OrderLine.objects.create(
            order=order,
            product=product,
            product_name=product.name,
            barcode=product.barcode,
            quantity=1,
            unit_price=Decimal('176.00'),
            subtotal=Decimal('176.00'),
            total=Decimal('176.00'),
        )

        data = OrderLineSerializer(line).data

        self.assertEqual(data['catalog_unit_price'], '225.00')
        self.assertEqual(data['unit_price'], '176.00')
