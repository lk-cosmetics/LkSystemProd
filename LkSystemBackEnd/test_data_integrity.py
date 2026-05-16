#!/usr/bin/env python
"""
Test script to verify data integrity with Company → Brand → SalesChannel hierarchy.
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

def test_company_data_integrity():
    """
    Verify that client company is derived from sales_channel.brand.company,
    NOT from request.user.current_company.
    """
    
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
    sales_channel = SalesChannel.objects.select_related('brand', 'brand__company').filter(brand__isnull=False).first()
    if not sales_channel:
        print("ERROR: No sales channel with brand found!")
        return
    
    print("\n" + "="*80)
    print("DATA INTEGRITY TEST: Company → Brand → SalesChannel Hierarchy")
    print("="*80)
    
    print(f"\n📊 TEST SETUP:")
    print(f"  User: {user.matricule}")
    print(f"  User Company: {user.current_company}")
    print(f"\n  Sales Channel: {sales_channel.id} ({sales_channel.name})")
    print(f"  Sales Channel Brand: {sales_channel.brand.id} ({sales_channel.brand.name})")
    print(f"  Sales Channel Brand Company: {sales_channel.brand.company.id} ({sales_channel.brand.company.name})")
    
    # Make API request
    request_data = {
        'sales_channel': sales_channel.id,
        'email': f'integrity-test-{ClientModel.objects.count()}@example.com',
        'first_name': 'Integrity',
        'last_name': 'Test',
        'phone': f'+216 99 {ClientModel.objects.count():06d}',
        'city': 'Tunis',
    }
    
    print(f"\n📤 API REQUEST:")
    print(f"  Endpoint: POST /api/v1/clients/create-from-pos/")
    print(f"  Body: {json.dumps(request_data, indent=4)}")
    
    response = client.post(
        '/api/v1/clients/create-from-pos/',
        data=json.dumps(request_data),
        content_type='application/json',
        HTTP_AUTHORIZATION=f'Bearer {token}'
    )
    
    print(f"\n📥 API RESPONSE: {response.status_code}")
    
    if response.status_code == 201:
        data = json.loads(response.content)
        client_id = data.get('id')
        
        print("\n✅ CLIENT CREATED")
        print("-" * 80)
        print(f"  Client ID: {client_id}")
        print(f"  Email: {data.get('email')}")
        print(f"  Name: {data.get('full_name')}")
        
        # Get from database
        db_client = ClientModel.objects.get(id=client_id)
        
        print(f"\n🔍 DATA INTEGRITY VERIFICATION:")
        print(f"\n  ✨ Brand Assignment:")
        print(f"    └─ Response brand_id: {data.get('brand')} ({data.get('brand_name')})")
        print(f"    └─ DB brand_id: {db_client.brand_id} ({db_client.brand.name})")
        if db_client.brand_id == sales_channel.brand_id:
            print(f"    ✅ Correctly auto-assigned from sales_channel.brand")
        else:
            print(f"    ❌ MISMATCH! Expected {sales_channel.brand_id}, got {db_client.brand_id}")
        
        print(f"\n  ✨ Company Assignment (CRITICAL):")
        print(f"    └─ User current_company: {user.current_company.id} ({user.current_company.name})")
        print(f"    └─ Sales Channel Brand Company: {sales_channel.brand.company.id} ({sales_channel.brand.company.name})")
        print(f"    └─ DB Client Company: {db_client.company_id} ({db_client.company.name})")
        
        if db_client.company_id == sales_channel.brand.company_id:
            print(f"    ✅ Correctly auto-assigned from sales_channel.brand.company")
            print(f"    ✅ Data integrity preserved!")
        else:
            print(f"    ❌ MISMATCH!")
            print(f"       Expected: {sales_channel.brand.company_id}")
            print(f"       Got: {db_client.company_id}")
        
        print(f"\n  ✨ Sales Channel Assignment:")
        print(f"    └─ DB sales_channel_id: {db_client.sales_channel_id}")
        if db_client.sales_channel_id == sales_channel.id:
            print(f"    ✅ Correctly set to requested sales_channel")
        else:
            print(f"    ❌ MISMATCH!")
        
        print(f"\n  ✨ Source & Audit Trail:")
        print(f"    └─ Source: {db_client.source} ({'✅ POS' if db_client.source == 'POS' else '❌ WRONG'})")
        print(f"    └─ Created By: {db_client.created_by}")
        
        # Final verdict
        if (db_client.brand_id == sales_channel.brand_id and
            db_client.company_id == sales_channel.brand.company_id and
            db_client.sales_channel_id == sales_channel.id and
            db_client.source == 'POS'):
            print(f"\n{'='*80}")
            print("✅✅✅ DATA INTEGRITY TEST PASSED ✅✅✅")
            print("All fields correctly auto-assigned from sales_channel hierarchy!")
            print(f"{'='*80}\n")
        else:
            print(f"\n{'='*80}")
            print("❌ DATA INTEGRITY TEST FAILED")
            print(f"{'='*80}\n")
            
    else:
        print(f"\n❌ FAILED TO CREATE CLIENT")
        print(f"Error: {response.content.decode()}")

if __name__ == '__main__':
    test_company_data_integrity()
