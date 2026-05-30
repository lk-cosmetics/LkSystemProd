from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import BillOfMaterials
from apps.inventory.serializers import BillOfMaterialsDetailSerializer
from apps.products.models import Product


class BillOfMaterialsSerializerTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Test Company', abbreviation='TST')
        self.brand = Brand.objects.create(company=self.company, name='Test Brand')
        self.user = get_user_model().objects.create_user(
            email='bom-user@example.com',
            matricule='BOM001',
            password='pass',
        )
        self.finished_product = Product.objects.create(
            brand=self.brand,
            name='Finished Perfume',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='100.00',
        )
        self.component = Product.objects.create(
            brand=self.brand,
            name='Bottle',
            product_type=Product.ProductType.COMPONENT,
            purchase_price='1.00',
        )

    def test_create_bom_accepts_nested_component_pk(self):
        serializer = BillOfMaterialsDetailSerializer(
            data={
                'finished_product': self.finished_product.id,
                'name': 'Perfume BOM',
                'version': 1,
                'is_active': True,
                'items': [
                    {
                        'component': self.component.id,
                        'quantity_per_unit': '1.000',
                        'waste_percent': '0.00',
                    }
                ],
            },
            context={'request': SimpleNamespace(user=self.user)},
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        bom = serializer.save()

        self.assertEqual(BillOfMaterials.objects.count(), 1)
        self.assertEqual(bom.items.get().component, self.component)

    def test_bom_rejects_non_component_component(self):
        """Only product_type='component' items may be used in a BOM."""
        packaging = Product.objects.create(
            brand=self.brand,
            name='Shipping Box',
            product_type=Product.ProductType.PACKAGING_ITEM,
        )
        serializer = BillOfMaterialsDetailSerializer(
            data={
                'finished_product': self.finished_product.id,
                'name': 'Perfume BOM',
                'version': 1,
                'is_active': True,
                'items': [
                    {
                        'component': packaging.id,
                        'quantity_per_unit': '1.000',
                        'waste_percent': '0.00',
                    }
                ],
            },
            context={'request': SimpleNamespace(user=self.user)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertEqual(BillOfMaterials.objects.count(), 0)

    def test_bom_rejects_non_resell_finished_product(self):
        """A BOM may only produce a resell_product (sellable finished good)."""
        component_as_finished = Product.objects.create(
            brand=self.brand,
            name='Cap',
            product_type=Product.ProductType.COMPONENT,
        )
        serializer = BillOfMaterialsDetailSerializer(
            data={
                'finished_product': component_as_finished.id,
                'name': 'Bad BOM',
                'version': 1,
                'is_active': True,
                'items': [
                    {
                        'component': self.component.id,
                        'quantity_per_unit': '1.000',
                        'waste_percent': '0.00',
                    }
                ],
            },
            context={'request': SimpleNamespace(user=self.user)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('finished_product', serializer.errors)
        self.assertEqual(BillOfMaterials.objects.count(), 0)
