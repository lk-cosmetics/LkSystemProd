from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order
from apps.rbac.models import AppPermission, Role, UserRole
from apps.sales_channels.models import SalesChannel


class InvoiceNumberTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Invoice Company', abbreviation='INV')
        self.brand = Brand.objects.create(company=self.company, name='Main Brand')
        self.other_brand = Brand.objects.create(company=self.company, name='Other Brand')
        self.channel = SalesChannel.objects.create(
            brand=self.brand,
            name='Main Shop',
            code='INV-MAIN',
            channel_type=SalesChannel.ChannelType.POS,
        )
        self.other_channel = SalesChannel.objects.create(
            brand=self.other_brand,
            name='Other Shop',
            code='INV-OTHER',
            channel_type=SalesChannel.ChannelType.POS,
        )
        User = get_user_model()
        self.admin = User.objects.create_user(
            matricule='INVADMIN',
            email='invoice-admin@example.com',
            password='test-pass',
            current_company=self.company,
            is_staff=True,
            is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def create_order(self, *, channel=None, name='Client One', phone='20111222'):
        target_channel = channel or self.channel
        first_name, _, last_name = name.partition(' ')
        return Order.objects.create(
            company=self.company,
            brand=target_channel.brand,
            sales_channel=target_channel,
            billing_first_name=first_name,
            billing_last_name=last_name,
            billing_email='order-client@example.com',
            billing_phone=phone,
            billing_address_1='Original order address',
            billing_city='Tunis',
            total='120.00',
        )

    def create_user_with_permissions(self, codenames, *, brand=None):
        User = get_user_model()
        suffix = User.objects.count() + 1
        user = User.objects.create_user(
            matricule=f'INV{suffix:04d}',
            email=f'invoice{suffix}@example.com',
            password='test-pass',
            current_company=self.company,
        )
        role = Role.objects.create(
            name=f'Invoice Test Role {suffix}',
            company=self.company,
            scope_type='brand' if brand else 'company',
        )
        permissions = []
        for codename in codenames:
            permission, _ = AppPermission.objects.get_or_create(
                codename=codename,
                defaults={
                    'name': codename.replace('_', ' ').title(),
                    'category': 'invoices',
                },
            )
            permissions.append(permission)
        role.permissions.add(*permissions)
        UserRole.objects.create(
            user=user,
            role=role,
            company=self.company,
            brand=brand,
        )
        return user

    def issue(self, order, payload=None):
        return self.client.post(
            f'/api/v1/orders/{order.id}/invoice/',
            payload or {},
            format='json',
        )

    def test_new_orders_do_not_receive_an_invoice_automatically(self):
        first = self.create_order()
        second = self.create_order()

        self.assertEqual(first.invoice_number, '')
        self.assertEqual(second.invoice_number, '')
        self.assertIsNone(first.invoice_date)

    def test_only_explicitly_selected_order_enters_invoice_registry(self):
        selected = self.create_order(name='Sonia Ben Salem', phone='+216 20 111 222')
        not_selected = self.create_order(name='No Invoice Client')

        issued = self.issue(selected)
        registry = self.client.get('/api/v1/orders/invoices/')

        self.assertEqual(issued.status_code, status.HTTP_200_OK)
        self.assertEqual(issued.data['invoice_number'], f'{timezone.localdate().year}/001')
        self.assertEqual(registry.status_code, status.HTTP_200_OK)
        self.assertEqual(registry.data['count'], 1)
        self.assertEqual(registry.data['results'][0]['id'], selected.id)
        not_selected.refresh_from_db()
        self.assertEqual(not_selected.invoice_number, '')

    def test_issue_copies_client_snapshot_then_invoice_edits_are_isolated(self):
        order = self.create_order(name='Original Client', phone='20111222')
        issued = self.issue(order)
        self.assertEqual(issued.status_code, status.HTTP_200_OK)
        self.assertEqual(issued.data['invoice_client_name'], 'Original Client')

        response = self.client.patch(
            f'/api/v1/orders/{order.id}/invoice/',
            {
                'invoice_number': issued.data['invoice_number'],
                'invoice_date': '2026-06-01',
                'invoice_client_name': 'Invoice Only Client',
                'invoice_client_type': 'COMPANY',
                'invoice_client_matricule_fiscale': 'MF-2026-55',
                'invoice_client_phone': '99888777',
                'invoice_client_email': 'invoice-only@example.com',
                'invoice_client_address': 'Invoice address',
                'invoice_client_city': 'Ariana',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['invoice_date'], '2026-06-01')
        self.assertEqual(response.data['invoice_client_name'], 'Invoice Only Client')
        self.assertEqual(response.data['invoice_client_matricule_fiscale'], 'MF-2026-55')
        order.refresh_from_db()
        self.assertEqual(order.billing_first_name, 'Original')
        self.assertEqual(order.billing_last_name, 'Client')
        self.assertEqual(order.billing_phone, '20111222')
        self.assertEqual(order.billing_address_1, 'Original order address')

    def test_manual_number_advances_the_next_explicit_invoice(self):
        year = timezone.localdate().year
        first = self.create_order()
        second = self.create_order()

        manual = self.issue(first, {
            'invoice_number': f'{year}/012',
            'invoice_date': f'{year}-06-11',
        })
        automatic = self.issue(second)

        self.assertEqual(manual.status_code, status.HTTP_200_OK)
        self.assertEqual(automatic.status_code, status.HTTP_200_OK)
        self.assertEqual(automatic.data['invoice_number'], f'{year}/013')

    def test_registry_searches_invoice_snapshot_phone_name_and_number(self):
        order = self.create_order()
        issued = self.issue(order, {
            'invoice_client_name': 'Sonia Invoice',
            'invoice_client_phone': '+216 98 765 432',
        })

        for query in ('Sonia', '98 765 432', issued.data['invoice_number']):
            response = self.client.get('/api/v1/orders/invoices/', {'search': query})
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data['count'], 1, query)
            self.assertEqual(response.data['results'][0]['id'], order.id)

    def test_brand_manager_invoice_registry_is_brand_scoped(self):
        visible = self.create_order(channel=self.channel)
        hidden = self.create_order(channel=self.other_channel)
        self.issue(visible)
        self.issue(hidden)
        user = self.create_user_with_permissions(['view_invoices'], brand=self.brand)
        client = APIClient()
        client.force_authenticate(user)

        response = client.get('/api/v1/orders/invoices/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['id'], visible.id)

    def test_user_without_invoice_permission_is_denied(self):
        user = self.create_user_with_permissions(['view_orders'])
        client = APIClient()
        client.force_authenticate(user)

        response = client.get('/api/v1/orders/invoices/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_duplicate_number_and_edit_before_issue_are_rejected(self):
        year = timezone.localdate().year
        first = self.create_order()
        second = self.create_order()
        self.issue(first, {
            'invoice_number': f'{year}/012',
            'invoice_date': f'{year}-06-11',
        })

        duplicate = self.issue(second, {
            'invoice_number': f'{year}/012',
            'invoice_date': f'{year}-06-11',
        })
        edit_unissued = self.client.patch(
            f'/api/v1/orders/{second.id}/invoice/',
            {'invoice_client_name': 'Not issued'},
            format='json',
        )

        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(edit_unissued.status_code, status.HTTP_400_BAD_REQUEST)
