"""
Company deletion tests.

1. ``ProtectedDeleteHandlerTests`` — Django's ``ProtectedError`` is translated
   into a clean 409 by ``core.exceptions.custom_exception_handler`` (so a
   blocked delete never surfaces as a raw 500).
2. ``CompanyCascadeDeletionTests`` — the platform-admin tenant wipe
   (``CompanyDeletionService``) removes EVERY row belonging to a company, leaves
   other companies untouched, and unlinks (never deletes) platform admins.

Run with::

    python manage.py test apps.company.tests
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models.deletion import ProtectedError
from django.test import TestCase

from apps.brands.models import Brand
from apps.company.models import Company
from apps.inventory.models import InventoryMovement, SalesChannelInventory
from apps.orders.models import Order, OrderLine
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel
from core.exceptions import custom_exception_handler

User = get_user_model()


class ProtectedDeleteHandlerTests(TestCase):
    def test_protected_error_becomes_409_with_summary(self):
        company = Company.objects.create(name='Co', abbreviation='CO')
        brand = Brand.objects.create(company=company, name='Br')

        exc = ProtectedError('blocked', {brand})
        resp = custom_exception_handler(exc, {'request': None, 'view': None})

        self.assertIsNotNone(resp)
        self.assertEqual(resp.status_code, 409)
        detail = resp.data['detail']
        self.assertIn("can't be deleted", detail)
        self.assertIn('brand', detail.lower())

    def test_non_protected_errors_are_left_to_default_handler(self):
        resp = custom_exception_handler(ValueError('boom'), {'request': None, 'view': None})
        self.assertIsNone(resp)


class CompanyCascadeDeletionTests(TestCase):
    """A full tenant carries data across ~all apps; deleting it must wipe its
    own rows and only its own rows."""

    def _full_company(self, label):
        company = Company.objects.create(name=f'Co{label}', abbreviation=f'C{label}')
        brand = Brand.objects.create(company=company, name=f'Brand{label}')
        channel = SalesChannel.objects.create(
            brand=brand, name=f'Ch{label}', code=f'CH{label}',
            channel_type=SalesChannel.ChannelType.POS,
        )
        product = Product.objects.create(
            brand=brand, name=f'Prod{label}', barcode=f'BC{label}',
            product_type=Product.ProductType.RESELL_PRODUCT, sales_price='10.00',
        )
        inv = SalesChannelInventory.objects.create(
            sales_channel=channel, product=product, quantity=5,
        )
        movement = InventoryMovement.objects.create(
            sales_channel=channel, product=product,
            movement_type=InventoryMovement.MovementType.PURCHASE,
            status=InventoryMovement.MovementStatus.COMPLETED,
            quantity=5, quantity_before=0, quantity_after=5,
        )
        order = Order.objects.create(
            company=company, sales_channel=channel, brand=brand,
            order_number=f'ORD-{label}', external_order_id=f'EX{label}',
            source=Order.Source.POS, status=Order.Status.COMPLETED,
            billing_first_name='T', billing_last_name='C', billing_phone='+21620000000',
            total=Decimal('10.00'),
        )
        line = OrderLine.objects.create(
            order=order, product=product, product_name=product.name,
            barcode=product.barcode, is_linked=True, quantity=1,
            unit_price=Decimal('10.00'), subtotal=Decimal('10.00'), total=Decimal('10.00'),
        )
        employee = User.objects.create_user(
            matricule=f'U{label}', email=f'u{label}@x.com', password='x',
            current_company=company,
        )
        return {
            'company': company, 'brand': brand, 'channel': channel,
            'product': product, 'inv': inv, 'movement': movement,
            'order': order, 'line': line, 'employee': employee,
        }

    def test_cascade_deletes_all_tenant_data_and_spares_others(self):
        a = self._full_company('A')
        b = self._full_company('B')

        # A platform admin who happens to point at company A must SURVIVE.
        admin = User.objects.create_user(
            matricule='ADMIN', email='admin@x.com', password='x',
            current_company=a['company'],
        )
        admin.is_superuser = True
        admin.save(update_fields=['is_superuser'])

        from apps.company.services import CompanyDeletionService
        CompanyDeletionService.delete(a['company'], actor=admin)

        # ── Company A and every row under it is gone ──
        self.assertFalse(Company.objects.filter(pk=a['company'].pk).exists())
        self.assertFalse(Brand.objects.filter(pk=a['brand'].pk).exists())
        self.assertFalse(SalesChannel.objects.filter(pk=a['channel'].pk).exists())
        self.assertFalse(Product.objects.filter(pk=a['product'].pk).exists())
        self.assertFalse(SalesChannelInventory.objects.filter(pk=a['inv'].pk).exists())
        self.assertFalse(InventoryMovement.objects.filter(pk=a['movement'].pk).exists())
        self.assertFalse(Order.all_objects.filter(pk=a['order'].pk).exists())
        self.assertFalse(OrderLine.objects.filter(pk=a['line'].pk).exists())
        self.assertFalse(User.objects.filter(pk=a['employee'].pk).exists())

        # ── The platform admin survives, merely unlinked ──
        admin.refresh_from_db()
        self.assertIsNone(admin.current_company_id)

        # ── Company B is completely untouched ──
        self.assertTrue(Company.objects.filter(pk=b['company'].pk).exists())
        self.assertTrue(Brand.objects.filter(pk=b['brand'].pk).exists())
        self.assertTrue(SalesChannel.objects.filter(pk=b['channel'].pk).exists())
        self.assertTrue(Product.objects.filter(pk=b['product'].pk).exists())
        self.assertTrue(SalesChannelInventory.objects.filter(pk=b['inv'].pk).exists())
        self.assertTrue(Order.all_objects.filter(pk=b['order'].pk).exists())
        self.assertTrue(User.objects.filter(pk=b['employee'].pk).exists())

    def test_non_platform_admin_is_rejected(self):
        from apps.company.services import CompanyDeletionError, CompanyDeletionService
        data = self._full_company('X')
        regular = data['employee']  # a plain employee, not a platform admin
        with self.assertRaises(CompanyDeletionError):
            CompanyDeletionService.delete(data['company'], actor=regular)
        # Nothing was deleted.
        self.assertTrue(Company.objects.filter(pk=data['company'].pk).exists())
