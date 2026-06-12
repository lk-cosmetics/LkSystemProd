"""
Tests for the company invoice/billing fields that drive the invoice header and
the editable footer.

    python manage.py test apps.company.test_invoice_billing
"""
from django.test import TestCase

from apps.company.models import Company
from apps.company.serializers import CompanySerializer


class CompanyInvoiceBillingTests(TestCase):
    def test_serializer_exposes_invoice_billing_fields(self):
        fields = CompanySerializer().fields
        for name in (
            'legal_name', 'logo', 'matricule_fiscale', 'registre_commerce',
            'bank_name', 'rib', 'invoice_footer',
        ):
            self.assertIn(name, fields)

    def test_invoice_footer_and_matricule_roundtrip(self):
        company = Company.objects.create(name='Inv Co', abbreviation='INV')
        ser = CompanySerializer(
            company,
            data={
                'name': 'Inv Co',
                'matricule_fiscale': '1234567A',
                'invoice_footer': 'Merci. Paiement à réception.',
            },
            partial=True,
        )
        self.assertTrue(ser.is_valid(), ser.errors)
        ser.save()
        company.refresh_from_db()
        self.assertEqual(company.matricule_fiscale, '1234567A')
        self.assertEqual(company.invoice_footer, 'Merci. Paiement à réception.')

    def test_invoice_footer_defaults_blank(self):
        company = Company.objects.create(name='Blank Co', abbreviation='BLK')
        self.assertEqual(company.invoice_footer, '')
