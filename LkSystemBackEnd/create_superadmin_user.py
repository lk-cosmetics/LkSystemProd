#!/usr/bin/env python
"""
Create a superadmin user for LkSystem.

This script creates a superadmin user with all necessary permissions and RBAC roles.
Safe to run multiple times — updates existing superuser if needed.

Usage:
    python create_superadmin_user.py

Or with arguments:
    python create_superadmin_user.py ADMIN-0001 admin@lksystem.com lksystem2026
"""

import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.contrib.auth import get_user_model
from apps.company.models import Company
from apps.rbac.models import Role, UserRole

User = get_user_model()


def create_superadmin(matricule, email, password, first_name='Admin', last_name='User', company_name='LkSystem Main'):
    """Create or update a superadmin user."""
    
    # Validate inputs
    if not matricule or not email or not password:
        print('❌ Error: matricule, email, and password are required.')
        return False
    
    if len(password) < 8:
        print('❌ Error: Password must be at least 8 characters long.')
        return False
    
    if '@' not in email:
        print('❌ Error: Please provide a valid email address.')
        return False
    
    # Get or create company
    company, company_created = Company.objects.get_or_create(
        name=company_name,
        defaults={
            'legal_name': f'{company_name} Legal Entity',
            'abbreviation': company_name[:3].upper(),
            'email': email,
            'phone': '+216 71 000 000',
            'city': 'Tunis',
        },
    )
    
    if company_created:
        print(f'✓ Company created: {company.name}')
    else:
        print(f'✓ Using existing company: {company.name}')
    
    # Create or update superuser
    user, created = User.objects.get_or_create(
        matricule=matricule,
        defaults={
            'email': email,
            'first_name': first_name,
            'last_name': last_name,
            'current_company': company,
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
        },
    )
    
    if created:
        user.set_password(password)
        user.save()
        print(f'✓ Superadmin created: {matricule}')
    else:
        # Update existing superuser
        user.email = email
        user.first_name = first_name
        user.last_name = last_name
        user.current_company = company
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.set_password(password)
        user.save()
        print(f'✓ Superadmin updated: {matricule}')
    
    # Assign Super Admin RBAC role
    try:
        super_admin_role = Role.objects.get(name='Super Admin', company=None)
        user_role, role_created = UserRole.objects.get_or_create(
            user=user,
            role=super_admin_role,
            defaults={'assigned_by': None},
        )
        if role_created:
            print(f'✓ Super Admin RBAC role assigned')
        else:
            print(f'✓ Super Admin RBAC role already assigned')
    except Role.DoesNotExist:
        print('⚠ Warning: Super Admin RBAC role not found. Run "python manage.py seed_rbac" first.')
        return False
    
    # Print summary
    print('\n' + '=' * 60)
    print('✅ Superadmin Setup Complete!')
    print('=' * 60)
    print(f'Matricule:  {user.matricule}')
    print(f'Email:      {user.email}')
    print(f'Name:       {user.first_name} {user.last_name}')
    print(f'Company:    {user.current_company.name}')
    print(f'Superuser:  Yes')
    print(f'Status:     Active')
    print('=' * 60)
    print('\n✅ You can now login with these credentials!')
    return True


if __name__ == '__main__':
    # Get inputs from command line or defaults
    if len(sys.argv) > 3:
        matricule = sys.argv[1]
        email = sys.argv[2]
        password = sys.argv[3]
        first_name = sys.argv[4] if len(sys.argv) > 4 else 'Admin'
        last_name = sys.argv[5] if len(sys.argv) > 5 else 'User'
        company = sys.argv[6] if len(sys.argv) > 6 else 'LkSystem Main'
    else:
        # Interactive mode
        print('Create Superadmin User for LkSystem')
        print('=' * 60)
        
        matricule = input('Enter matricule (e.g., ADMIN-0001) [default: ADMIN-0001]: ').strip() or 'ADMIN-0001'
        email = input('Enter email address [default: admin@lksystem.com]: ').strip() or 'admin@lksystem.com'
        password = input('Enter password [default: lksystem2026]: ').strip() or 'lksystem2026'
        first_name = input('Enter first name [default: Admin]: ').strip() or 'Admin'
        last_name = input('Enter last name [default: User]: ').strip() or 'User'
        company = input('Enter company name [default: LkSystem Main]: ').strip() or 'LkSystem Main'
        
        print()
    
    success = create_superadmin(matricule, email, password, first_name, last_name, company)
    sys.exit(0 if success else 1)
