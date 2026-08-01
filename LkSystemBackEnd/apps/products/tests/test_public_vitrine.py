"""Tests for the public POS vitrine catalogue endpoint."""

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.brands.models import Brand
from apps.categories.models import Category
from apps.company.models import Company
from apps.inventory.models import SalesChannelInventory
from apps.products.models import Product
from apps.promotions.models import Promotion, PromotionChannelRule, PromotionStatus
from apps.sales_channels.models import SalesChannel


class PublicVitrineEndpointTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Vitrine Co', abbreviation='VTC')
        self.brand = Brand.objects.create(company=self.company, name='Therapy')
        self.pos = SalesChannel.objects.create(
            brand=self.brand,
            name='Carfour',
            code='CF',
            channel_type=SalesChannel.ChannelType.POS,
            is_active=True,
        )
        self.category = Category.objects.create(
            sales_channel=self.pos,
            name='Face Therapy',
            slug='face-therapy',
            display_order=1,
        )

        self.product = Product.objects.create(
            brand=self.brand,
            name='Creme hydratante',
            barcode='6190001',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price=Decimal('50.000'),
            status=Product.ProductStatus.PUBLISH,
        )
        self.product.categories.add(self.category)
        SalesChannelInventory.objects.create(
            sales_channel=self.pos,
            product=self.product,
            quantity=8,
            reserved_quantity=2,
        )

        self.component_a = Product.objects.create(
            brand=self.brand,
            name='Serum',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price=Decimal('35.000'),
            status=Product.ProductStatus.PUBLISH,
        )
        self.component_b = Product.objects.create(
            brand=self.brand,
            name='Mask',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price=Decimal('20.000'),
            status=Product.ProductStatus.PUBLISH,
        )
        self.pack = Product.objects.create(
            brand=self.brand,
            name='Pack Face',
            product_type=Product.ProductType.PACK,
            is_pack=True,
            pack_items=[
                {'product_id': self.component_a.id, 'quantity': 1},
                {'product_id': self.component_b.id, 'quantity': 2},
            ],
            sales_price=Decimal('60.000'),
            status=Product.ProductStatus.PUBLISH,
        )
        self.pack.categories.add(self.category)
        SalesChannelInventory.objects.create(
            sales_channel=self.pos,
            product=self.component_a,
            quantity=5,
        )
        SalesChannelInventory.objects.create(
            sales_channel=self.pos,
            product=self.component_b,
            quantity=6,
        )

        promotion = Promotion.objects.create(
            brand=self.brand,
            product=self.product,
            name='Promo vitrine',
            start_date=timezone.now() - timezone.timedelta(days=1),
            status=PromotionStatus.ACTIVE,
            is_active=True,
            discount_type='percentage',
            default_discount_value=Decimal('20.00'),
        )
        PromotionChannelRule.objects.create(
            promotion=promotion,
            sales_channel=self.pos,
            discount_value=Decimal('20.00'),
            is_enabled=True,
        )

        self.api = APIClient()

    def test_public_vitrine_requires_no_auth_and_includes_sellable_catalogue(self):
        res = self.api.get(
            f'/api/v1/products/public-vitrine/?sales_channel={self.pos.id}'
        )

        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['sales_channel']['id'], self.pos.id)
        self.assertEqual(body['categories'][0]['name'], 'Face Therapy')

        products = {product['id']: product for product in body['products']}
        self.assertIn(self.product.id, products)
        self.assertIn(self.pack.id, products)

        normal_product = products[self.product.id]
        self.assertEqual(normal_product['available_quantity'], 6)
        self.assertEqual(normal_product['effective_price'], '40.000')
        self.assertEqual(normal_product['promotion']['discount_value'], '20.00')

        pack = products[self.pack.id]
        self.assertEqual(pack['product_type'], Product.ProductType.PACK)
        self.assertEqual(pack['available_quantity'], 3)
        self.assertEqual(len(pack['pack_components']), 2)
        self.assertEqual(pack['pack_components_total'], '75.000')
        self.assertEqual(pack['pack_savings'], '15.000')

    def test_public_vitrine_resolves_brand_woocommerce_channel_to_active_pos(self):
        web = SalesChannel.objects.create(
            brand=self.brand,
            name='Website',
            code='WEB',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
            is_active=True,
        )
        res = self.api.get(f'/api/v1/products/public-vitrine/?sales_channel={web.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['sales_channel']['id'], self.pos.id)

    def test_public_vitrine_rejects_brand_without_active_pos_channel(self):
        other_brand = Brand.objects.create(company=self.company, name='No POS Brand')
        web = SalesChannel.objects.create(
            brand=other_brand,
            name='Website',
            code='WEB2',
            channel_type=SalesChannel.ChannelType.WOOCOMMERCE,
            is_active=True,
        )
        res = self.api.get(f'/api/v1/products/public-vitrine/?sales_channel={web.id}')
        self.assertEqual(res.status_code, 404)
