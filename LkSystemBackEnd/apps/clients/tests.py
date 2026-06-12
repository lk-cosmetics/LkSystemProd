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
