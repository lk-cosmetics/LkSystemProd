"""
Management command to populate test/demo data.
"""

from django.core.management.base import BaseCommand
from apps.company.models import Company
from apps.brands.models import Brand
from apps.sales_channels.models import SalesChannel
from apps.products.models import Product
from apps.inventory.models import SalesChannelInventory
from decimal import Decimal


class Command(BaseCommand):
    help = 'Populate test/demo data for inventory management'

    def handle(self, *args, **options):
        self.stdout.write("🚀 Creating test inventory data...")

        try:
            # Create Company
            company, created = Company.objects.get_or_create(
                name='Test Company',
                defaults={
                    'legal_name': 'Test Company LLC',
                    'abbreviation': 'TEST',
                    'email': 'test@testcompany.com',
                    'phone': '+216 71 123 456',
                    'city': 'Tunis',
                }
            )
            status = "✓ created" if created else "✓ already exists"
            self.stdout.write(self.style.SUCCESS(f'{status}: Company "{company.name}"'))

            # Create Brand
            brand, created = Brand.objects.get_or_create(
                company=company,
                name='Test Brand',
            )
            status = "✓ created" if created else "✓ already exists"
            self.stdout.write(self.style.SUCCESS(f'{status}: Brand "{brand.name}"'))

            # Create Sales Channel (POS - no WooCommerce requirement)
            sales_channel, created = SalesChannel.objects.get_or_create(
                brand=brand,
                name='Test POS Channel',
                defaults={
                    'channel_type': SalesChannel.ChannelType.POS,
                    'is_active': True,
                }
            )
            status = "✓ created" if created else "✓ already exists"
            self.stdout.write(self.style.SUCCESS(f'{status}: Sales Channel "{sales_channel.name}"'))

            # Create test products
            products_data = [
                {'name': 'Dell Laptop XPS 13', 'barcode': 'DEL-XPS13-001', 'price': Decimal('999.99')},
                {'name': 'Apple iPhone 15', 'barcode': 'APP-IP15-001', 'price': Decimal('899.99')},
                {'name': 'Samsung Galaxy S24', 'barcode': 'SAM-S24-001', 'price': Decimal('799.99')},
            ]

            for prod_data in products_data:
                product, created = Product.objects.get_or_create(
                    sales_channel=sales_channel,
                    barcode=prod_data['barcode'],
                    defaults={
                        'name': prod_data['name'],
                        'slug': prod_data['name'].lower().replace(' ', '-'),
                        'wc_product_id': 0,
                        'purchase_price': prod_data['price'] * Decimal('0.6'),
                        'sales_price': prod_data['price'],
                        'inventory_status': Product.InventoryStatus.IN_STOCK,
                        'manage_stock': True,
                    }
                )
                if created:
                    self.stdout.write(f'  ✓ Product: "{product.name}"')

            # Create channel inventory for all products
            for product in Product.objects.filter(sales_channel=sales_channel):
                inv, created = SalesChannelInventory.objects.get_or_create(
                    sales_channel=sales_channel,
                    product=product,
                    defaults={
                        'quantity': 100,
                        'reserved_quantity': 0,
                        'minimum_quantity': 10,
                        'maximum_quantity': 500,
                    }
                )
                if created:
                    self.stdout.write(f'    ✓ Inventory: {product.name} @ {sales_channel.name}')

            self.stdout.write(self.style.SUCCESS('\n✅ Test data created successfully!'))
            self.stdout.write('📍 You can now test the inventory module in the frontend.')

        except Exception as e:
            self.stdout.write(self.style.ERROR(f'❌ Error: {str(e)}'))
            raise
