"""
Tests for the client Matricule Fiscale (tax ID for B2B / company clients),
shown as the bill-to tax number on invoices.

    python manage.py test apps.clients
"""
from django.test import TestCase

from apps.brands.models import Brand
from apps.clients.models import Client
from apps.clients.serializers import ClientCreateSerializer, ClientListSerializer
from apps.company.models import Company


class ClientMatriculeFiscaleTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='CL Co', abbreviation='CLC')
        self.brand = Brand.objects.create(company=self.company, name='CL Brand')

    def test_serializers_expose_matricule_fiscale(self):
        self.assertIn('matricule_fiscale', ClientListSerializer().fields)
        self.assertIn('matricule_fiscale', ClientCreateSerializer().fields)

    def test_create_serializer_accepts_matricule_fiscale(self):
        ser = ClientCreateSerializer(data={
            'company': self.company.id,
            'email': 'biz@example.com',
            'first_name': 'Biz',
            'client_type': 'COMPANY',
            'matricule_fiscale': '9988776B',
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        client = ser.save()
        self.assertEqual(client.matricule_fiscale, '9988776B')
        self.assertEqual(client.client_type, Client.ClientType.COMPANY)

    def test_matricule_defaults_blank(self):
        client = Client.objects.create(
            company=self.company, email='person@example.com', first_name='P',
        )
        self.assertEqual(client.matricule_fiscale, '')


class POSClientCreateIdempotencyTests(TestCase):
    """create-from-pos must never dead-end on a duplicate: it selects the
    existing client (matched by normalized phone, then email) and flags
    ``existing`` so the POS auto-selects it instead of erroring."""

    def setUp(self):
        from rest_framework.test import APIRequestFactory
        from apps.sales_channels.models import SalesChannel
        self.company = Company.objects.create(name='POS Co', abbreviation='PC')
        self.brand = Brand.objects.create(company=self.company, name='PB')
        self.channel = SalesChannel.objects.create(
            brand=self.brand, name='Shop', code='SHOP',
            channel_type=SalesChannel.ChannelType.POS,
        )
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.admin = User.objects.create_user(
            matricule='PADM', email='padm@x.com', password='x',
            current_company=self.company,
        )
        self.admin.is_superuser = True
        self.admin.save(update_fields=['is_superuser'])
        self.factory = APIRequestFactory()

    def _create(self, payload):
        from rest_framework.test import force_authenticate
        from apps.clients.views import ClientViewSet
        request = self.factory.post('/api/v1/clients/create-from-pos/', payload, format='json')
        force_authenticate(request, user=self.admin)
        return ClientViewSet.as_view({'post': 'create_from_pos'})(request)

    def test_new_client_is_created(self):
        resp = self._create({'sales_channel': self.channel.id, 'first_name': 'Sam', 'phone': '24512995'})
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(resp.data.get('existing'))
        self.assertEqual(Client.objects.filter(company=self.company).count(), 1)

    def test_duplicate_phone_selects_existing_no_400(self):
        self._create({'sales_channel': self.channel.id, 'first_name': 'Sam', 'phone': '24512995'})
        # Same number in a different written form → normalized match.
        resp = self._create({'sales_channel': self.channel.id, 'first_name': 'Sam', 'phone': '+216 24 512 995'})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data.get('existing'))
        self.assertEqual(Client.objects.filter(company=self.company).count(), 1)

    def test_duplicate_email_selects_existing_no_400(self):
        self._create({'sales_channel': self.channel.id, 'first_name': 'A', 'email': 'dup@x.com'})
        resp = self._create({'sales_channel': self.channel.id, 'first_name': 'B', 'email': 'dup@x.com'})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data.get('existing'))
        self.assertEqual(Client.objects.filter(company=self.company, email='dup@x.com').count(), 1)
