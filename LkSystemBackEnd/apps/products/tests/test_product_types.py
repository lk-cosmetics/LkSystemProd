"""Tests for the canonical product/item taxonomy refactor.

Covers the four canonical types (resell_product / pack / component /
packaging_item), the sellable helper, queryset filtering, and the
is_pack <-> product_type='pack' synchronisation enforced by both the model's
clean() and the ProductSerializer.
"""

import json
import tempfile
from io import BytesIO

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from apps.products.models import Product
from apps.products.serializers import (
    ProductSerializer,
    WooCommerceProductWebhookSerializer,
)


def _tiny_png_bytes() -> bytes:
    """A valid 1×1 PNG so ImageField/Pillow validation passes in tests."""
    buf = BytesIO()
    Image.new('RGB', (1, 1), (255, 0, 0)).save(buf, format='PNG')
    return buf.getvalue()


class ProductTypeTaxonomyTests(TestCase):
    def test_four_canonical_types_are_creatable(self):
        for ptype in (
            Product.ProductType.RESELL_PRODUCT,
            Product.ProductType.COMPONENT,
            Product.ProductType.PACKAGING_ITEM,
        ):
            product = Product.objects.create(name=f'P-{ptype}', product_type=ptype)
            self.assertEqual(product.product_type, ptype)

    def test_default_type_is_resell_product(self):
        product = Product.objects.create(name='Defaulted')
        self.assertEqual(product.product_type, Product.ProductType.RESELL_PRODUCT)

    def test_is_sellable_property(self):
        resell = Product.objects.create(name='Perfume', product_type=Product.ProductType.RESELL_PRODUCT)
        component = Product.objects.create(name='Bottle', product_type=Product.ProductType.COMPONENT)
        packaging = Product.objects.create(name='Box', product_type=Product.ProductType.PACKAGING_ITEM)
        self.assertTrue(resell.is_sellable)
        self.assertFalse(component.is_sellable)
        self.assertFalse(packaging.is_sellable)

    def test_filter_by_product_type(self):
        Product.objects.create(name='Perfume', product_type=Product.ProductType.RESELL_PRODUCT)
        Product.objects.create(name='Bottle', product_type=Product.ProductType.COMPONENT)
        Product.objects.create(name='Box', product_type=Product.ProductType.PACKAGING_ITEM)

        self.assertEqual(
            Product.objects.filter(product_type=Product.ProductType.COMPONENT).count(), 1
        )
        self.assertEqual(
            Product.objects.filter(product_type=Product.ProductType.PACKAGING_ITEM).count(), 1
        )
        # Only resell_product is sellable here (no pack created in this test).
        self.assertEqual(
            Product.objects.filter(product_type__in=Product.SELLABLE_TYPES).count(), 1
        )

    # ── pack / type synchronisation ─────────────────────────────────────────

    def test_model_clean_syncs_pack_type_to_flag(self):
        child = Product.objects.create(name='Child', product_type=Product.ProductType.RESELL_PRODUCT)
        pack = Product(
            name='Promo Pack',
            product_type=Product.ProductType.PACK,
            pack_items=[{'product_id': child.id, 'quantity': 1}],
        )
        pack.clean()
        self.assertTrue(pack.is_pack)
        self.assertEqual(pack.product_type, Product.ProductType.PACK)

    def test_model_clean_syncs_flag_to_pack_type(self):
        child = Product.objects.create(name='Child', product_type=Product.ProductType.RESELL_PRODUCT)
        pack = Product(
            name='Gift Pack',
            is_pack=True,
            product_type=Product.ProductType.RESELL_PRODUCT,  # should be coerced to 'pack'
            pack_items=[{'product_id': child.id, 'quantity': 2}],
        )
        pack.clean()
        self.assertEqual(pack.product_type, Product.ProductType.PACK)

    def test_serializer_is_pack_forces_pack_type(self):
        child = Product.objects.create(name='Child', product_type=Product.ProductType.RESELL_PRODUCT)
        serializer = ProductSerializer(data={
            'name': 'Gift Pack',
            'is_pack': True,
            'product_type': Product.ProductType.RESELL_PRODUCT,  # should be overridden
            'pack_items': [{'product_id': child.id, 'quantity': 2}],
            'sales_price': '50.00',
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['product_type'], Product.ProductType.PACK)
        self.assertTrue(serializer.validated_data['is_pack'])

    def test_serializer_pack_type_forces_is_pack(self):
        child = Product.objects.create(name='Child', product_type=Product.ProductType.RESELL_PRODUCT)
        serializer = ProductSerializer(data={
            'name': 'Promo Pack',
            'product_type': Product.ProductType.PACK,
            'pack_items': [{'product_id': child.id, 'quantity': 1}],
            'sales_price': '30.00',
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertTrue(serializer.validated_data['is_pack'])
        self.assertEqual(serializer.validated_data['product_type'], Product.ProductType.PACK)

    def test_serializer_pack_requires_items(self):
        serializer = ProductSerializer(data={
            'name': 'Empty Pack',
            'product_type': Product.ProductType.PACK,
            'sales_price': '30.00',
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn('pack_items', serializer.errors)

    def test_serializer_accepts_pack_items_as_json_string(self):
        # Multipart uploads (image picker) send pack_items as a JSON string; the
        # serializer must decode it back to a list before validation.
        child = Product.objects.create(name='Child', product_type=Product.ProductType.RESELL_PRODUCT)
        serializer = ProductSerializer(data={
            'name': 'Pack via multipart',
            'product_type': Product.ProductType.PACK,
            'pack_items': json.dumps([{'product_id': child.id, 'quantity': 2}]),
            'sales_price': '30.00',
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(
            serializer.validated_data['pack_items'],
            [{'product_id': child.id, 'quantity': 2}],
        )

    def test_serializer_rejects_invalid_pack_items_json_string(self):
        serializer = ProductSerializer(data={
            'name': 'Bad multipart pack',
            'product_type': Product.ProductType.PACK,
            'pack_items': 'not-json',
            'sales_price': '30.00',
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn('pack_items', serializer.errors)


class WooCommerceInboundTypeTests(TestCase):
    """Every product synced from WooCommerce defaults to resell_product."""

    def _map(self, wc_type: str):
        serializer = WooCommerceProductWebhookSerializer()
        validated = serializer.to_internal_value({
            'id': 1234,
            'name': 'WC Item',
            'type': wc_type,
        })
        return validated['product_type']

    def test_simple_type_maps_to_resell_product(self):
        self.assertEqual(self._map('simple'), Product.ProductType.RESELL_PRODUCT)

    def test_legacy_packaging_type_now_maps_to_resell_product(self):
        # Previously 'packaging' → PACKAGING_ITEM; packaging_item is now an
        # internal-only taxonomy, so WC imports are always resell_product.
        self.assertEqual(self._map('packaging'), Product.ProductType.RESELL_PRODUCT)

    def test_unknown_type_maps_to_resell_product(self):
        self.assertEqual(self._map('variable'), Product.ProductType.RESELL_PRODUCT)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ProductImageUploadTests(TestCase):
    """Uploading a picture stores the file and mirrors its URL into image_url."""

    def test_uploaded_image_is_mirrored_into_image_url(self):
        upload = SimpleUploadedFile('p.png', _tiny_png_bytes(), content_type='image/png')
        serializer = ProductSerializer(data={
            'name': 'Photographed product',
            'sales_price': '10.00',
            'image': upload,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        product = serializer.save()
        self.assertTrue(product.image)
        self.assertTrue(product.image.url)
        # image_url now points at the uploaded file so every render path shows it.
        self.assertEqual(product.image_url, product.image.url)
        self.assertIn('products/images/', product.image_url)

    def test_no_upload_leaves_image_url_untouched(self):
        serializer = ProductSerializer(data={
            'name': 'URL-only product',
            'sales_price': '10.00',
            'image_url': 'https://example.com/x.jpg',
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        product = serializer.save()
        self.assertFalse(product.image)
        self.assertEqual(product.image_url, 'https://example.com/x.jpg')
