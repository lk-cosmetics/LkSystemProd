from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import InventoryMovement
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel


class InventoryMovementReferenceTests(TestCase):
    def test_rapid_movements_receive_unique_references(self):
        company = Company.objects.create(name='Movement Co', abbreviation='MVC')
        brand = Brand.objects.create(company=company, name='Movement Brand')
        channel = SalesChannel.objects.create(
            brand=brand,
            name='Movement POS',
            code='MV-POS',
            channel_type=SalesChannel.ChannelType.POS,
        )
        product = Product.objects.create(
            brand=brand,
            name='Movement Product',
            barcode='MV-001',
            product_type=Product.ProductType.RESELL_PRODUCT,
            sales_price='10.00',
        )

        references = {
            InventoryMovement.objects.create(
                sales_channel=channel,
                product=product,
                movement_type=InventoryMovement.MovementType.ADJUSTMENT_IN,
                quantity=1,
                quantity_before=0,
                quantity_after=1,
            ).reference_number
            for _ in range(100)
        }

        self.assertEqual(len(references), 100)
        self.assertTrue(all(reference.startswith('MOV-') for reference in references))
