#!/usr/bin/env python
"""Create test data for inventory testing."""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from apps.company.models import Company
from apps.brands.models import Brand
from apps.sales_channels.models import SalesChannel
from apps.products.models import Product
from apps.inventory.models import SalesChannelInventory
from decimal import Decimal

# Create Company
company, _ = Company.objects.get_or_create(
    name='Test Company',
    defaults={
        'legal_name': 'Test Company LLC',
        'abbreviation': 'TEST',
        'email': 'test@testcompany.com',
        'phone': '+216 71 123 456',
        'city': 'Tunis',
    }
)
print(f'✓ Company: {company.name}')

# Create Brand
brand, _ = Brand.objects.get_or_create(
    company=company,
    name='Test Brand',
)
print(f'✓ Brand: {brand.name}')

# Create Sales Channel (POS - no WooCommerce)
sales_channel, _ = SalesChannel.objects.get_or_create(
    brand=brand,
    name='Test POS',
    defaults={
        'channel_type': SalesChannel.ChannelType.POS,
        'is_active': True,
    }
)
print(f'✓ Sales Channel: {sales_channel.name}')

# Create Products
products_data = [
    {'name': 'Dell Laptop XPS 13', 'barcode': 'DEL-XPS13-001', 'price': Decimal('999.99')},
    {'name': 'Apple iPhone 15', 'barcode': 'APP-IP15-001', 'price': Decimal('899.99')},
    {'name': 'Samsung Galaxy S24', 'barcode': 'SAM-S24-001', 'price': Decimal('799.99')},
]

for prod in products_data:
    product, created = Product.objects.get_or_create(
        sales_channel=sales_channel,
        barcode=prod['barcode'],
        defaults={
            'name': prod['name'],
            'wc_product_id': 0,
            'slug': prod['name'].lower().replace(' ', '-'),
            'sales_price': prod['price'],
            'purchase_price': prod['price'] * Decimal('0.6'),
            'manage_stock': True,
        }
    )
    if created:
        print(f'  ✓ Product: {product.name}')

# Create Inventory
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
        print(f'  ✓ Inventory: {product.name} @ {sales_channel.name}')

print('\n✅ Test data created successfully!')
print('You can now test the inventory module in the frontend.')
