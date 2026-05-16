"""
Management command: create_superadmin

Creates a superadmin user for the LkSystem application.
Automatically assigns the 'Super Admin' RBAC role.
Creates a default company if one doesn't exist.

Safe to run multiple times — updates existing superuser if needed.

Usage::

    python manage.py create_superadmin --matricule ADMIN-0001 --email admin@lksystem.com --password password123 --first-name Admin --last-name User

Or interactively (without arguments):
    python manage.py create_superadmin
"""

from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from apps.company.models import Company
from apps.rbac.models import Role, UserRole

User = get_user_model()


class Command(BaseCommand):
    help = 'Create a superadmin user with RBAC Super Admin role.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--matricule',
            type=str,
            help='Unique matricule identifier (e.g., ADMIN-0001)',
        )
        parser.add_argument(
            '--email',
            type=str,
            help='Email address for the superadmin',
        )
        parser.add_argument(
            '--password',
            type=str,
            help='Password for the superadmin',
        )
        parser.add_argument(
            '--first-name',
            type=str,
            default='Super',
            help='First name (default: Super)',
        )
        parser.add_argument(
            '--last-name',
            type=str,
            default='Admin',
            help='Last name (default: Admin)',
        )
        parser.add_argument(
            '--company',
            type=str,
            help='Company name (creates if not exists)',
        )

    def handle(self, *args, **options):
        # Get inputs interactively if not provided
        matricule = options.get('matricule') or input('Enter matricule (e.g., ADMIN-0001): ').strip()
        email = options.get('email') or input('Enter email address: ').strip()
        password = options.get('password') or input('Enter password: ').strip()
        first_name = options.get('first_name', 'Super')
        last_name = options.get('last_name', 'Admin')
        company_name = options.get('company') or 'Default Company'

        # Validate inputs
        if not matricule or not email or not password:
            raise CommandError('❌ Matricule, email, and password are required.')

        if len(password) < 8:
            raise CommandError('❌ Password must be at least 8 characters long.')

        if not email or '@' not in email:
            raise CommandError('❌ Please provide a valid email address.')

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
            self.stdout.write(f'  ✓ Company created: {company.name}')
        else:
            self.stdout.write(f'  ✓ Using existing company: {company.name}')

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
            self.stdout.write(self.style.SUCCESS(f'  ✓ Superadmin created: {matricule}'))
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
            self.stdout.write(self.style.SUCCESS(f'  ✓ Superadmin updated: {matricule}'))

        # Assign Super Admin RBAC role
        try:
            super_admin_role = Role.objects.get(name='Super Admin', company=None)
            user_role, role_created = UserRole.objects.get_or_create(
                user=user,
                role=super_admin_role,
                defaults={'assigned_by': None},
            )
            if role_created:
                self.stdout.write(f'  ✓ Super Admin RBAC role assigned')
            else:
                self.stdout.write(f'  ✓ Super Admin RBAC role already assigned')
        except Role.DoesNotExist:
            self.stdout.write(
                self.style.WARNING(
                    '  ⚠ Super Admin RBAC role not found. Run "python manage.py seed_rbac" first.'
                )
            )

        # Print summary
        self.stdout.write('\n' + '=' * 60)
        self.stdout.write(self.style.SUCCESS('✅ Superadmin Setup Complete!'))
        self.stdout.write('=' * 60)
        self.stdout.write(f'  Matricule:  {user.matricule}')
        self.stdout.write(f'  Email:      {user.email}')
        self.stdout.write(f'  Name:       {user.first_name} {user.last_name}')
        self.stdout.write(f'  Company:    {user.current_company.name}')
        self.stdout.write(f'  Superuser:  Yes')
        self.stdout.write(f'  Status:     Active')
        self.stdout.write('=' * 60)
        self.stdout.write('\n✅ You can now login with these credentials!')
