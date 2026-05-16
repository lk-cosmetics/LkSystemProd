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
            product_type=Product.ProductType.RESELL,
            sales_price='100.00',
        )
        self.component = Product.objects.create(
            brand=self.brand,
            name='Bottle',
            product_type=Product.ProductType.PACKAGING,
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
