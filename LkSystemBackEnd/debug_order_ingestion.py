#!/usr/bin/env python
"""
Debug script: Test order ingestion with WooCommerce-like payload.
This simulates what happens when a webhook is received.
"""
import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from apps.orders.service import OrderIngestionService, OrderIngestionError
from apps.sales_channels.models import SalesChannel
from apps.orders.models import Order
from apps.clients.models import Client
from apps.company.models import Company

print("\n" + "="*80)
print("DEBUG: ORDER INGESTION WITH WOOCOMMERCE PAYLOAD")
print("="*80)

# Get a WooCommerce sales channel
wc_channels = SalesChannel.objects.filter(channel_type=SalesChannel.ChannelType.WOOCOMMERCE, is_active=True)
if not wc_channels.exists():
    print("❌ No active WooCommerce sales channels found!")
    exit(1)

channel = wc_channels.first()
print(f"\n1. USING SALES CHANNEL")
print(f"   Channel: {channel.name} (ID: {channel.id})")
print(f"   Brand: {channel.brand.name}")
print(f"   Company: {channel.brand.company.name}")

# Create a test payload
test_payload = {
    "id": 999999,
    "status": "pending",
    "total": "100.00",
    "billing": {
        "customer_id": 555555,
        "email": "test.wc.client@test.com",
        "first_name": "Test",
        "last_name": "WCClient",
        "phone": "555-1234",
        "address_1": "123 Test St",
        "city": "Test City",
        "state": "TS",
        "postcode": "12345",
        "country": "TN"
    },
    "line_items": [
        {
            "id": 1,
            "product_id": 10,
            "quantity": 1,
            "subtotal": "100.00",
            "total": "100.00"
        }
    ]
}

print(f"\n2. TEST PAYLOAD")
print(f"   WC Order ID: {test_payload['id']}")
print(f"   WC Customer ID: {test_payload['billing']['customer_id']}")
print(f"   Email: {test_payload['billing']['email']}")
print(f"   Status: {test_payload['status']}")

# Check initial state
print(f"\n3. INITIAL STATE")
initial_clients = Client.objects.count()
print(f"   Clients in DB: {initial_clients}")

# Ingest the order
print(f"\n4. INGESTING ORDER...")
service = OrderIngestionService()

try:
    order, created = service.ingest(
        payload=test_payload,
        sales_channel=channel,
        source=Order.Source.WOOCOMMERCE
    )
    print(f"   ✅ Order ingested successfully")
    print(f"      Order ID: {order.id}")
    print(f"      Order Number: {order.order_number}")
    print(f"      Created: {created}")
    print(f"      Status: {order.status}")
    print(f"      Client ID: {order.client_id}")
    print(f"      Client: {order.client}")
    
except OrderIngestionError as e:
    print(f"   ❌ OrderIngestionError: {e.message}")
    print(f"      Details: {e.details}")
except Exception as e:
    print(f"   ❌ Exception: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()

# Check final state
print(f"\n5. FINAL STATE")
final_clients = Client.objects.count()
print(f"   Clients in DB: {final_clients}")
if final_clients > initial_clients:
    print(f"   ✅ {final_clients - initial_clients} new client created")
    new_client = Client.objects.order_by('-created_at').first()
    print(f"      Email: {new_client.email}")
    print(f"      WC Customer ID: {new_client.wc_customer_id}")
    print(f"      Brand: {new_client.brand}")
    print(f"      Company: {new_client.company}")
else:
    print(f"   ❌ NO NEW CLIENT CREATED!")

# Check if order got the client
order_fresh = Order.objects.get(id=order.id)
print(f"\n6. ORDER STATE (REFRESHED)")
print(f"   Client ID: {order_fresh.client_id}")
print(f"   Client: {order_fresh.client}")

print("\n" + "="*80 + "\n")
