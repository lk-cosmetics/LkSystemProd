"""
LkSystem Products App - Service Layer
Simplified ProductService for the slim Product model.
"""

import logging
import mimetypes
from pathlib import PurePosixPath
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone
from django.db import transaction

from apps.categories.models import Category
from apps.products.models import Product
from apps.sales_channels.models import SalesChannel
from core.services import BaseWooCommerceService
from core.webhooks import WebhookContext
from core.webhooks.decorators import WebhookHandlerMixin

logger = logging.getLogger(__name__)


class ProductService(BaseWooCommerceService[Product], WebhookHandlerMixin):
    """
    Service for managing Product synchronization with WooCommerce.
    Stripped down to match the simplified Product model.
    """

    WEBHOOK_TOPICS = [
        'product.created',
        'product.updated',
        'product.deleted',
        'product.restored',
    ]

    @property
    def model_class(self) -> type:
        return Product

    @property
    def wc_endpoint(self) -> str:
        return 'products'

    @property
    def wc_id_field(self) -> str:
        return 'wc_product_id'

    def get_upsert_lookup(self, wc_id: int):
        return {
            'brand': self.sales_channel.brand,
            self.wc_id_field: wc_id,
        }

    @transaction.atomic
    def upsert(self, wc_data: Dict[str, Any]):
        """
        Upsert product from WooCommerce and auto-restore if it was soft-deleted.
        """
        wc_id = wc_data.get('id')
        if not wc_id:
            raise ValueError('Missing WooCommerce product ID in payload')

        transformed_data = self.transform_from_wc(wc_data)
        model_data = {k: v for k, v in transformed_data.items() if not k.startswith('_')}
        model_data.update(self.get_audit_fields(is_create=True))

        lookup = self.get_upsert_lookup(wc_id)

        instance, created = Product.all_objects.update_or_create(
            **lookup,
            defaults=model_data,
        )

        if instance.is_deleted:
            instance.is_deleted = False
            instance.deleted_at = None
            instance.deleted_by = None
            instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'updated_at'])

        self.post_upsert_hook(instance, wc_data, transformed_data, created)
        return instance, created

    # ── WooCommerce → Local ──────────────────────────────────────────────

    def transform_from_wc(self, wc_data: Dict[str, Any]) -> Dict[str, Any]:
        regular_price = self._safe_decimal(wc_data.get('regular_price', '0'))

        images = wc_data.get('images', [])
        remote_image = images[0].get('src', '') if images else ''

        data = {
            'wc_product_id': wc_data['id'],
            'name': wc_data.get('name', ''),
            'barcode': wc_data.get('sku', ''),
            # Every product imported from WooCommerce is a normal sellable good,
            # so it defaults to RESELL_PRODUCT. The internal-only taxonomies
            # (component for BOM parts, packaging_item for shipping supplies) are
            # created locally and never originate from a WooCommerce sync.
            'product_type': Product.ProductType.RESELL_PRODUCT,
            'status': wc_data.get('status', 'publish'),
            'brand': self.sales_channel.brand,
            'sales_price': regular_price,
            'product_link': wc_data.get('permalink', ''),
            'last_synced_at': timezone.now(),
            'wc_date_created': wc_data.get('date_created'),
            'wc_date_modified': wc_data.get('date_modified'),
            '_wc_category_ids': [
                category.get('id')
                for category in wc_data.get('categories', [])
                if category.get('id')
            ],
        }

        # Image localization is the slow part of a BULK SYNC — one blocking HTTP
        # download per product, repeated on every run. During a bulk sync, skip
        # it when the product already has a locally stored image: re-syncs then
        # touch no remote media (the common case the user hits). New /
        # not-yet-localized products still download once. The per-product
        # webhook path does NOT set the bulk flag, so a real product update in
        # WooCommerce still re-localizes its image. When skipping we omit
        # ``image_url`` so the upsert leaves the existing value intact.
        skip_image = False
        if getattr(self, '_bulk_sync_active', False):
            media_url = getattr(settings, 'MEDIA_URL', '/media/') or '/media/'
            existing_image_url = (
                Product.all_objects
                .filter(wc_product_id=wc_data.get('id'), brand=self.sales_channel.brand)
                .values_list('image_url', flat=True)
                .first()
            )
            skip_image = bool(existing_image_url) and existing_image_url.startswith(media_url)

        if not skip_image:
            local_image = self._download_primary_image(remote_image, wc_data.get('id'))
            data['image_url'] = local_image or remote_image

        return data

    def post_upsert_hook(
        self,
        instance: Product,
        wc_data: Dict[str, Any],
        transformed_data: Dict[str, Any],
        created: bool,
    ) -> None:
        """Attach local WooCommerce categories after the product row exists."""
        wc_category_ids = transformed_data.get('_wc_category_ids') or []
        if not wc_category_ids or not hasattr(instance, 'categories'):
            return

        categories = Category.objects.filter(
            sales_channel=self.sales_channel,
            wc_category_id__in=wc_category_ids,
        )
        instance.categories.set(categories)

    # ── Local → WooCommerce ──────────────────────────────────────────────

    # Map canonical local types back to the WooCommerce "type" wire value so the
    # export contract is unchanged (WC historically received 'packaging' / 'resell').
    _LOCAL_TO_WC_TYPE = {
        Product.ProductType.PACKAGING_ITEM: 'packaging',
        Product.ProductType.RESELL_PRODUCT: 'resell',
        Product.ProductType.PACK: 'resell',
        Product.ProductType.COMPONENT: 'component',
    }

    def transform_to_wc(self, instance: Product) -> Dict[str, Any]:
        return {
            'name': instance.name,
            'sku': instance.barcode,
            'type': self._LOCAL_TO_WC_TYPE.get(instance.product_type, 'resell'),
            'status': instance.status,
            'regular_price': str(instance.sales_price),
        }

    # ── Webhook Handlers ─────────────────────────────────────────────────

    def handle_upsert(self, context: WebhookContext) -> dict:
        payload = context.payload
        if not payload or 'id' not in payload:
            return {'detail': 'No product data in payload'}
        try:
            instance, created = self.upsert(payload)
            action = 'created' if created else 'updated'
            return {
                'detail': f'Product {action} successfully',
                'product_id': instance.id,
                'wc_product_id': instance.wc_product_id,
                'action': action,
            }
        except Exception as e:
            logger.exception(f"Error processing product webhook: {e}")
            return {'detail': f'Error processing product: {str(e)}'}

    def handle_delete(self, context: WebhookContext) -> dict:
        payload = context.payload
        wc_id = payload.get('id')
        if not wc_id:
            return {'detail': 'No product ID in payload'}

        # Soft-delete instead of hard delete
        try:
            product = Product.objects.get(
                brand=self.sales_channel.brand,
                wc_product_id=wc_id,
            )
            product.soft_delete()
            return {'detail': 'Product soft-deleted', 'wc_product_id': wc_id}
        except Product.DoesNotExist:
            return {'detail': 'Product not found locally', 'wc_product_id': wc_id}

    def handle_product_restored(self, context: WebhookContext) -> dict:
        payload = context.payload
        wc_id = payload.get('id')
        if not wc_id:
            return {'detail': 'No product ID in payload'}

        try:
            product = Product.all_objects.get(
                brand=self.sales_channel.brand,
                wc_product_id=wc_id,
            )
            if product.is_deleted:
                product.restore()
            return self.handle_upsert(context)
        except Product.DoesNotExist:
            return self.handle_upsert(context)

    # ── Helpers ──────────────────────────────────────────────────────────

    def _safe_decimal(self, value: Any) -> Decimal:
        if value is None or value == '':
            return Decimal('0.00')
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return Decimal('0.00')

    def _download_primary_image(self, image_url: str, wc_product_id: int | None) -> str:
        """Download the WooCommerce primary image into backend media storage.

        Returning a local /media path avoids hotlinking WordPress images in the
        frontend and keeps POS/product screens stable if the remote URL changes.
        """
        if not image_url or not wc_product_id:
            return ''
        parsed = urlparse(image_url)
        if parsed.scheme not in {'http', 'https'}:
            return ''

        try:
            response = requests.get(image_url, timeout=12, stream=True)
            response.raise_for_status()
        except requests.RequestException as exc:
            logger.warning(
                'Could not download WooCommerce product image wc_id=%s: %s',
                wc_product_id,
                exc,
            )
            return ''

        content_type = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
        if content_type and not content_type.startswith('image/'):
            logger.warning(
                'Skipping non-image WooCommerce media wc_id=%s content_type=%s',
                wc_product_id,
                content_type,
            )
            return ''

        max_bytes = 8 * 1024 * 1024
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                logger.warning('Skipping oversized WooCommerce image wc_id=%s', wc_product_id)
                return ''
            chunks.append(chunk)

        suffix = PurePosixPath(parsed.path).suffix.lower()
        if not suffix:
            suffix = mimetypes.guess_extension(content_type) or '.jpg'
        if suffix not in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
            suffix = '.jpg'

        relative_path = f'products/woocommerce/{self.sales_channel.brand_id}/{wc_product_id}{suffix}'
        if default_storage.exists(relative_path):
            default_storage.delete(relative_path)
        saved_path = default_storage.save(relative_path, ContentFile(b''.join(chunks)))
        return default_storage.url(saved_path)

    def search_by_barcode(self, barcode: str) -> Optional[Product]:
        try:
            return Product.objects.get(
                brand=self.sales_channel.brand,
                barcode=barcode,
            )
        except Product.DoesNotExist:
            return None
