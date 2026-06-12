"""
Tests for ``GET /orders/{id}/pos-destinations/`` — the channels an order may be
routed to as a POS destination. The rule mirrors ``send_to_pos``: every ACTIVE
channel of the SAME BRAND, regardless of the caller's pinned-channel visibility.

    python manage.py test apps.orders.tests.test_pos_destinations
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.brands.models import Brand
from apps.company.models import Company
from apps.orders.models import Order
from apps.sales_channels.models import SalesChannel

User = get_user_model()


def _ch(brand, name, code, *, active=True, kind=SalesChannel.ChannelType.POS):
    return SalesChannel.objects.create(
        brand=brand, name=name, code=code, channel_type=kind, is_active=active,
    )


class PosDestinationsEndpointTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(name='PD Co', abbreviation='PDC')
        self.brand_a = Brand.objects.create(company=self.company, name='Brand A')
        self.brand_b = Brand.objects.create(company=self.company, name='Brand B')

        self.a1 = _ch(self.brand_a, 'A1', 'A1')
        self.a2 = _ch(self.brand_a, 'A2', 'A2')
        self.a_web = _ch(self.brand_a, 'A-Web', 'AWEB', kind=SalesChannel.ChannelType.WOOCOMMERCE)
        self.a_inactive = _ch(self.brand_a, 'A-Old', 'AOLD', active=False)
        self.b1 = _ch(self.brand_b, 'B1', 'B1')  # other brand → must be excluded

        self.order = Order.objects.create(
            company=self.company, brand=self.brand_a, sales_channel=self.a1,
            order_number='PD-1', status=Order.Status.NEW, source=Order.Source.POS,
        )

        self.admin = User.objects.create_user(
            matricule='PD-ADMIN', email='pd@example.com', password='x',
        )
        self.admin.is_staff = True
        self.admin.is_superuser = True
        self.admin.current_company = self.company
        self.admin.save()

        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def test_returns_active_same_brand_channels_only(self):
        res = self.api.get(f'/api/v1/orders/{self.order.id}/pos-destinations/')
        self.assertEqual(res.status_code, 200)
        ids = {c['id'] for c in res.json()}
        # Active, same-brand (POS + WooCommerce both qualify as destinations).
        self.assertEqual(ids, {self.a1.id, self.a2.id, self.a_web.id})
        # Inactive same-brand and active other-brand are excluded.
        self.assertNotIn(self.a_inactive.id, ids)
        self.assertNotIn(self.b1.id, ids)

    def test_requires_authentication(self):
        anon = APIClient()
        res = anon.get(f'/api/v1/orders/{self.order.id}/pos-destinations/')
        self.assertIn(res.status_code, (401, 403))
