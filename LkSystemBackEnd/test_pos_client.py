#!/usr/bin/env python
"""
Test script to verify the create-from-pos endpoint properly saves brand and sales_channel.
"""
import os
import sys
import json
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
sys.path.insert(0, '/app')
django.setup()

from django.test import Client as DjangoTestClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.users.models import User
from apps.clients.models import Client as ClientModel
from apps.sales_channels.models import SalesChannel

def test_create_client_from_pos():
    """Test creating a client via the POS endpoints"""
    
    # Get auth token
    user = User.objects.first()
    if not user:
        print("ERROR: No user found in database!")
        return
    
    refresh = RefreshToken.for_user(user)
    token = str(refresh.access_token)
    
    # Create Django test client
    client = DjangoTestClient()
    
    # Get a sales channel with brand
    sales_channel = SalesChannel.objects.select_related('brand').filter(brand__isnull=False).first()
    if not sales_channel:
        print("ERROR: No sales channel with brand found!")
        print("Available channels:")
        for sc in SalesChannel.objects.select_related('brand').all():
            print(f"  - {sc.id}: {sc.name} (Brand: {sc.brand})")
        return
    
    print("\n" + "="*70)
    print("TEST: Create Client from POS")
    print("="*70)
    print(f"Sales Channel: {sales_channel.id} ({sales_channel.name})")
    print(f"Sales Channel Brand: {sales_channel.brand_id} ({sales_channel.brand})")
    print(f"Authenticated User: {user.matricule}")
    
    # Make API request
    request_data = {
        'sales_channel': sales_channel.id,
        'email': f'test-pos-{ClientModel.objects.count()}_fixed@example.com',
        'first_name': 'Test',
        'last_name': 'POS',
        'phone': f'+216 99 {ClientModel.objects.count():06d}',  # Unique phone
        'city': 'Tunis',
    }
    
    print(f"\nRequest Body:")
    print(json.dumps(request_data, indent=2))
    
    response = client.post(
        '/api/v1/clients/create-from-pos/',
        data=json.dumps(request_data),
        content_type='application/json',
        HTTP_AUTHORIZATION=f'Bearer {token}'
    )
    
    print(f"\nResponse Status: {response.status_code}")
    
    if response.status_code == 201:
        data = json.loads(response.content)
        client_id = data.get('id')
        
        print("\n✅ CLIENT CREATED SUCCESSFULLY!")
        print("-" * 70)
        print(f"  Client ID: {client_id}")
        print(f"  Email: {data.get('email')}")
        print(f"  Name: {data.get('full_name')}")
        print(f"\n  🎯 CRITICAL FIELDS:")
        print(f"  ├─ Brand ID: {data.get('brand')} {'✓ SET' if data.get('brand') else '✗ NULL'}")
        print(f"  ├─ Brand Name: {data.get('brand_name')}")
        print(f"  ├─ Sales Channel ID: {data.get('sales_channel_id')} {'✓ SET' if data.get('sales_channel_id') else '✗ NULL'}")
        print(f"  ├─ Sales Channel Name: {data.get('sales_channel_name')}")
        print(f"  └─ Source: {data.get('source')}")
        
        print(f"\n  📋 AUDIT TRAIL:")
        print(f"  ├─ Created By: {data.get('created_by_username')}")
        print(f"  ├─ Created At: {data.get('created_at')}")
        print(f"  └─ Company: {data.get('company_name')}")
        
        # Verify in database
        print(f"\n  🔍 VERIFYING IN DATABASE:")
        db_client = ClientModel.objects.get(id=client_id)
        print(f"  ├─ DB Brand ID: {db_client.brand_id} {'✓ CORRECT' if db_client.brand_id == sales_channel.brand_id else '✗ MISMATCH'}")
        print(f"  ├─ DB Sales Channel ID: {db_client.sales_channel_id} {'✓ CORRECT' if db_client.sales_channel_id == sales_channel.id else '✗ MISMATCH'}")
        print(f"  ├─ DB Source: {db_client.source} {'✓ POS' if db_client.source == 'POS' else '✗ WRONG'}")
        print(f"  └─ DB Created By: {db_client.created_by} {'✓ SET' if db_client.created_by else '✗ NULL'}")
        
        if (db_client.brand_id and db_client.sales_channel_id and 
            db_client.source == 'POS' and db_client.created_by):
            print("\n✅✅✅ ALL FIELDS CORRECTLY SAVED TO DATABASE! ✅✅✅")
        else:
            print("\n❌ SOME FIELDS ARE MISSING!")
            
    else:
        print("\n❌ FAILED TO CREATE CLIENT")
        print(f"Response Content:\n{response.content.decode()}")

if __name__ == '__main__':
    test_create_client_from_pos()
