#!/usr/bin/env python
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
sys.path.insert(0, '/app')

django.setup()

from apps.clients.models import Client
from apps.sales_channels.models import SalesChannel

# Check the problematic client
client = Client.objects.filter(email='imen@tt.tn').first()
if client:
    print(f"\n{'='*60}")
    print(f"CURRENT CLIENT: {client.email}")
    print(f"{'='*60}")
    print(f"  Brand: {client.brand} (ID: {client.brand_id if client.brand else 'NULL'}) ❌ SHOULD NOT BE NULL")
    print(f"  Sales Channel: {client.sales_channel} (ID: {client.sales_channel_id})")
    print(f"  Source: {client.source}")
    print(f"  Created By: {client.created_by}")
    
    # Check if sales channel has a brand
    if client.sales_channel:
        print(f"\n  Sales Channel '{client.sales_channel.name}' Brand: {client.sales_channel.brand}")
else:
    print("Client imen@tt.tn not found")

# Check available sales channels with brands
print(f"\n{'='*60}")
print("AVAILABLE SALES CHANNELS")
print(f"{'='*60}")
for sc in SalesChannel.objects.select_related('brand').all():
    print(f"  - {sc.id}: {sc.name} -> Brand: {sc.brand}")
