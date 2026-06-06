"""
Product Sync Service - Async product resolution from WooCommerce API
═════════════════════════════════════════════════════════════════════════════════
Handles fetching and creating/updating products from WooCommerce when they're
referenced in orders but don't exist locally.

Supports both sync and async (Celery) operations via get_or_fetch_product().
"""

import logging
from decimal import Decimal
from typing import Optional, Dict, Any, Tuple

from django.utils import timezone
from woocommerce import API as WooCommerceAPI

from apps.products.models import Product
from apps.sales_channels.models import SalesChannel

logger = logging.getLogger(__name__)


class ProductSyncService:
    """
    Sync products from WooCommerce API.
    
    Two modes:
    1. SYNC: Directly fetch from WooCommerce & update DB (for critical paths)
    2. ASYNC: Queue Celery task to fetch in background (for non-critical imports)
    """

    @staticmethod
    def get_wc_api_client(sales_channel: SalesChannel) -> Optional[WooCommerceAPI]:
        """
        Create a WooCommerceAPI client for the given channel.
        
        Returns:
            WooCommerceAPI instance or None if credentials are missing
        """
        if not sales_channel.wc_store_url:
            logger.warning(
                "Sales channel %s (id=%s) missing wc_store_url",
                sales_channel.name, sales_channel.id
            )
            return None
        
        if not sales_channel.wc_consumer_key or not sales_channel.wc_consumer_secret:
            logger.warning(
                "Sales channel %s (id=%s) missing WooCommerce API credentials",
                sales_channel.name, sales_channel.id
            )
            return None
        
        try:
            return WooCommerceAPI(
                url=sales_channel.wc_store_url,
                consumer_key=sales_channel.wc_consumer_key,
                consumer_secret=sales_channel.wc_consumer_secret,
                version="wc/v3",
                timeout=15
            )
        except Exception as exc:
            logger.error(
                "Failed to create WooCommerce API client for channel %s: %s",
                sales_channel.id, str(exc)
            )
            return None

    @classmethod
    def fetch_product_from_wc(
        cls,
        wc_product_id: int,
        sales_channel: SalesChannel,
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch a single product from WooCommerce API by ID.
        
        Args:
            wc_product_id: WooCommerce product ID
            sales_channel: SalesChannel with WooCommerce credentials
        
        Returns:
            Product data dict or None if fetch failed
        """
        api = cls.get_wc_api_client(sales_channel)
        if not api:
            return None
        
        try:
            response = api.get(f"products/{wc_product_id}")
            status = getattr(response, 'status_code', None)
            if status is not None and status >= 400:
                logger.warning(
                    "WooCommerce returned HTTP %s fetching product %s for channel=%s",
                    status, wc_product_id, sales_channel.id,
                )
                return None
            data = response.json()
            return data if isinstance(data, dict) and data.get('id') else None
        except Exception as exc:
            logger.error(
                "Failed to fetch product %s from WooCommerce: %s",
                wc_product_id, str(exc)
            )
            return None

    @classmethod
    def create_or_update_product_from_wc(
        cls,
        wc_data: Dict[str, Any],
        sales_channel: SalesChannel,
    ) -> Optional[Product]:
        """
        Create or update a local Product from WooCommerce data.
        
        Args:
            wc_data: Product data from WooCommerce API
            sales_channel: SalesChannel to associate product with
        
        Returns:
            Product instance or None if creation failed
        """
        wc_id = wc_data.get('id')
        if not wc_id:
            logger.warning("WooCommerce product data missing 'id'")
            return None
        
        # First product image (if any) → image_url so the product card renders.
        images = wc_data.get('images') or []
        image_url = (
            images[0].get('src', '')
            if images and isinstance(images[0], dict) else ''
        )
        try:
            product, created = Product.objects.update_or_create(
                wc_product_id=wc_id,
                defaults={
                    'brand': sales_channel.brand,
                    'name': wc_data.get('name', f'Product {wc_id}'),
                    'barcode': wc_data.get('sku', ''),
                    'product_link': wc_data.get('permalink', '') or '',
                    # NOTE: the model fields are purchase_price / sales_price — NOT
                    # cost_price / selling_price. Using the wrong names made the
                    # CREATE path raise (TypeError on unknown kwargs), so brand-new
                    # WooCommerce products silently failed to create and their order
                    # lines were left unlinked.
                    'purchase_price': cls._get_decimal(wc_data.get('cost', '0')),
                    'sales_price': cls._get_decimal(
                        wc_data.get('price') or wc_data.get('regular_price') or '0'
                    ),
                    'image_url': image_url,
                    'status': cls._map_wc_status(wc_data.get('status', 'draft')),
                },
            )
            
            action = "created" if created else "updated"
            logger.info(
                "Product %s %s from WooCommerce: wc_id=%s, name=%s, channel=%s",
                product.id, action, wc_id, product.name, sales_channel.name
            )

            # Link the product to this channel's inventory so it appears in the
            # brand's stock / catalogue and is resolved on the next order (order
            # lines look products up via SalesChannelInventory). Idempotent.
            try:
                from apps.inventory.models import SalesChannelInventory
                SalesChannelInventory.objects.get_or_create(
                    sales_channel=sales_channel,
                    product=product,
                    defaults={'quantity': 0},
                )
            except Exception as exc:
                logger.warning(
                    "Could not link product %s to channel %s inventory: %s",
                    product.id, sales_channel.id, exc,
                )

            return product
        
        except Exception as exc:
            logger.error(
                "Failed to create/update product from WooCommerce data: %s",
                str(exc)
            )
            return None

    @classmethod
    def get_or_fetch_product(
        cls,
        wc_product_id: int,
        sales_channel: SalesChannel,
        async_if_missing: bool = False,
    ) -> Optional[Product]:
        """
        Get a product by WooCommerce ID, or fetch from API if missing.
        
        Strategy:
        1. Check if product exists locally → return it
        2. If not found:
           - If async_if_missing=True: Queue async Celery task & return None
           - Otherwise: Fetch sync from WooCommerce API & create it
        
        Args:
            wc_product_id: WooCommerce product ID
            sales_channel: SalesChannel instance
            async_if_missing: If True, queue async Celery task; else fetch sync
        
        Returns:
            Product instance or None
        """
        # Step 1: Try to find locally
        try:
            product = Product.objects.get(
                wc_product_id=wc_product_id,
                brand=sales_channel.brand,
            )
            return product
        except Product.DoesNotExist:
            pass
        except Product.MultipleObjectsReturned:
            logger.warning(
                "Multiple products found for wc_id=%s in brand=%s",
                wc_product_id, sales_channel.brand.id
            )
            return None
        
        # Step 2: Product not found locally
        if async_if_missing:
            # Queue Celery task (requires task definition in tasks.py)
            try:
                from apps.products.tasks import sync_product_from_wc
                sync_product_from_wc.delay(
                    wc_product_id=wc_product_id,
                    sales_channel_id=sales_channel.id,
                )
                logger.info(
                    "Queued async product sync: wc_id=%s for channel=%s",
                    wc_product_id, sales_channel.id
                )
            except ImportError:
                logger.warning("Celery tasks not available, falling back to sync fetch")
                return cls._fetch_and_create_sync(wc_product_id, sales_channel)
            return None
        else:
            # Fetch synchronously (blocking)
            return cls._fetch_and_create_sync(wc_product_id, sales_channel)

    @classmethod
    def _fetch_and_create_sync(
        cls,
        wc_product_id: int,
        sales_channel: SalesChannel,
    ) -> Optional[Product]:
        """Synchronously fetch product from WooCommerce and create it locally."""
        wc_data = cls.fetch_product_from_wc(wc_product_id, sales_channel)
        if not wc_data:
            logger.warning(
                "Could not fetch product %s from WooCommerce for channel=%s",
                wc_product_id, sales_channel.id
            )
            return None
        
        return cls.create_or_update_product_from_wc(wc_data, sales_channel)

    @staticmethod
    def _get_decimal(value) -> Decimal:
        """Convert value to Decimal with 2 decimal places."""
        if value is None or value == '':
            return Decimal('0.00')
        try:
            result = Decimal(str(value))
            return result.quantize(Decimal('0.01'))
        except:
            return Decimal('0.00')

    @staticmethod
    def _map_wc_status(wc_status: str) -> str:
        """Map WooCommerce product status to local Product status."""
        status_map = {
            'publish': Product.ProductStatus.PUBLISH,
            'draft': Product.ProductStatus.DRAFT,
            'pending': Product.ProductStatus.PENDING,
            'private': Product.ProductStatus.PRIVATE,
        }
        return status_map.get(wc_status, Product.ProductStatus.DRAFT)
