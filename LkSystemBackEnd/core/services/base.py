"""
LkSystem Core Services - Base WooCommerce Service
Abstract base class for all WooCommerce service implementations.
"""

import logging
from abc import ABC, abstractmethod
from typing import TypeVar, Generic, Optional, List, Dict, Any, Type, Tuple

from django.db import models, transaction
from woocommerce import API as WooCommerceAPI

from apps.sales_channels.models import SalesChannel
from .exceptions import (
    WooCommerceAPIError,
    WooCommerceAuthError,
    WooCommerceConfigError,
    WooCommerceSyncError,
)
from .mixins import AuditMixin, PaginationMixin, CacheMixin, TransformMixin

logger = logging.getLogger(__name__)

# Type variable for the model this service manages
T = TypeVar('T', bound=models.Model)


class BaseWooCommerceService(
    AuditMixin,
    PaginationMixin,
    CacheMixin,
    TransformMixin,
    ABC,
    Generic[T]
):
    """
    Abstract base class for WooCommerce synchronization services.
    
    Provides common functionality for:
    - API client initialization and authentication
    - Paginated data fetching
    - CRUD operations with WooCommerce
    - Sync operations (pull from WC, push to WC)
    - Caching and audit trail
    
    Subclasses must implement:
    - model_class: The Django model this service manages
    - wc_endpoint: The WooCommerce API endpoint
    - wc_id_field: The field name storing the WooCommerce ID
    - transform_from_wc(): Transform WC data to model fields
    - transform_to_wc(): Transform model to WC API payload
    
    Usage:
        class ProductService(BaseWooCommerceService[Product]):
            model_class = Product
            wc_endpoint = 'products'
            wc_id_field = 'wc_product_id'
            
            def transform_from_wc(self, data: dict) -> dict:
                # Transform WooCommerce API response to model fields
                ...
    """
    
    # =========================================================================
    # Abstract Properties - Must be defined by subclasses
    # =========================================================================
    
    @property
    @abstractmethod
    def model_class(self) -> Type[T]:
        """The Django model class this service manages."""
        pass
    
    @property
    @abstractmethod
    def wc_endpoint(self) -> str:
        """The WooCommerce REST API endpoint (e.g., 'products', 'products/categories')."""
        pass
    
    @property
    @abstractmethod
    def wc_id_field(self) -> str:
        """The model field name that stores the WooCommerce ID (e.g., 'wc_product_id')."""
        pass
    
    # =========================================================================
    # Configuration
    # =========================================================================
    
    # Required flat fields on SalesChannel
    REQUIRED_CONFIG_KEYS: List[str] = ['wc_store_url', 'wc_consumer_key', 'wc_consumer_secret']
    
    # API version
    API_VERSION: str = 'wc/v3'
    
    # Request timeout in seconds
    REQUEST_TIMEOUT: int = 30
    
    # =========================================================================
    # Initialization
    # =========================================================================
    
    def __init__(self, sales_channel: SalesChannel):
        """
        Initialize the service for a specific sales channel.
        
        Args:
            sales_channel: SalesChannel instance with WooCommerce configuration
            
        Raises:
            WooCommerceConfigError: If required configuration is missing
        """
        self.sales_channel = sales_channel

        # Validate configuration
        self._validate_config()
        
        # Initialize API client
        self._api: Optional[WooCommerceAPI] = None
    
    def _validate_config(self) -> None:
        """Validate that all required configuration fields are present."""
        missing_keys = [
            key for key in self.REQUIRED_CONFIG_KEYS
            if not getattr(self.sales_channel, key, '')
        ]

        if missing_keys:
            raise WooCommerceConfigError(
                f"Missing WooCommerce configuration: {', '.join(missing_keys)}",
                details={'missing_keys': missing_keys, 'channel_id': self.sales_channel.id}
            )
    
    @property
    def api(self) -> WooCommerceAPI:
        """
        Lazy-initialized WooCommerce API client.
        
        Returns:
            Configured WooCommerceAPI instance
        """
        if self._api is None:
            self._api = WooCommerceAPI(
                url=self.sales_channel.wc_store_url,
                consumer_key=self.sales_channel.wc_consumer_key,
                consumer_secret=self.sales_channel.wc_consumer_secret,
                version=self.API_VERSION,
                timeout=self.REQUEST_TIMEOUT
            )
        return self._api
    
    # =========================================================================
    # Abstract Methods - Must be implemented by subclasses
    # =========================================================================
    
    @abstractmethod
    def transform_from_wc(self, wc_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transform WooCommerce API response data to model field values.
        
        Args:
            wc_data: Raw data from WooCommerce API
            
        Returns:
            Dict of field names and values for the model
        """
        pass
    
    @abstractmethod
    def transform_to_wc(self, instance: T) -> Dict[str, Any]:
        """
        Transform a model instance to WooCommerce API payload.
        
        Args:
            instance: Model instance to transform
            
        Returns:
            Dict suitable for WooCommerce API request body
        """
        pass
    
    # =========================================================================
    # Optional Hooks - Can be overridden by subclasses
    # =========================================================================

    def get_upsert_lookup(self, wc_id: int) -> Dict[str, Any]:
        """
        Return the lookup dict used to find an existing record during upsert.
        Default: match by sales_channel + wc_id_field.
        Override in subclasses that use a different uniqueness constraint.
        """
        return {
            'sales_channel': self.sales_channel,
            self.wc_id_field: wc_id,
        }

    def post_upsert_hook(
        self,
        instance: T,
        wc_data: Dict[str, Any],
        transformed_data: Dict[str, Any],
        created: bool
    ) -> None:
        """
        Hook called after an upsert operation.
        
        Override to perform additional operations like linking relationships.
        
        Args:
            instance: The created/updated model instance
            wc_data: Original WooCommerce data
            transformed_data: Transformed data including private fields (e.g., _wc_category_ids)
            created: True if instance was created, False if updated
        """
        pass
    
    def pre_push_hook(self, instance: T) -> Dict[str, Any]:
        """
        Hook called before pushing to WooCommerce.
        
        Override to modify the payload before sending.
        
        Args:
            instance: Model instance being pushed
            
        Returns:
            Additional fields to merge into the payload
        """
        return {}
    
    # =========================================================================
    # API Methods - Core CRUD operations with WooCommerce
    # =========================================================================
    
    def _handle_response(self, response, operation: str = 'request') -> Dict[str, Any]:
        """
        Handle API response and raise appropriate exceptions.
        
        Args:
            response: Response from WooCommerce API
            operation: Description of the operation for error messages
            
        Returns:
            Parsed JSON response
            
        Raises:
            WooCommerceAuthError: For 401/403 responses
            WooCommerceAPIError: For other error responses
        """
        if response.status_code in (401, 403):
            raise WooCommerceAuthError(
                f"Authentication failed during {operation}",
                status_code=response.status_code,
                details={'response': response.text[:500]}
            )
        
        if response.status_code >= 400:
            raise WooCommerceAPIError(
                f"WooCommerce API error during {operation}",
                status_code=response.status_code,
                response_body=response.text[:1000],
                details={'endpoint': self.wc_endpoint}
            )
        
        return response.json()
    
    def fetch_one(self, wc_id: int) -> Dict[str, Any]:
        """
        Fetch a single item from WooCommerce by ID.
        
        Args:
            wc_id: WooCommerce ID
            
        Returns:
            Item data from WooCommerce
        """
        response = self.api.get(f"{self.wc_endpoint}/{wc_id}")
        return self._handle_response(response, f'fetch {self.wc_endpoint}/{wc_id}')
    
    def fetch_page(self, page: int, per_page: int, **params) -> Tuple[List[Dict], bool]:
        """
        Fetch a single page of items from WooCommerce.
        
        Args:
            page: Page number (1-indexed)
            per_page: Items per page
            **params: Additional query parameters
            
        Returns:
            Tuple of (items, has_more_pages)
        """
        params = {**params, 'page': page, 'per_page': per_page}
        response = self.api.get(self.wc_endpoint, params=params)
        data = self._handle_response(response, f'fetch {self.wc_endpoint} page {page}')
        
        # Check if there are more pages
        has_more = len(data) == per_page
        return data, has_more
    
    def fetch_all(self, **params) -> List[Dict[str, Any]]:
        """
        Fetch all items from WooCommerce (paginated).
        
        Args:
            **params: Additional query parameters
            
        Returns:
            List of all items
        """
        def fetch_func(page: int, per_page: int) -> Tuple[List[Dict], bool]:
            return self.fetch_page(page, per_page, **params)
        
        items = self.paginate_fetch(fetch_func)
        logger.info(f"Fetched {len(items)} items from {self.wc_endpoint}")
        return items
    
    def create_in_wc(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create an item in WooCommerce.
        
        Args:
            data: Item data to create
            
        Returns:
            Created item data from WooCommerce
        """
        response = self.api.post(self.wc_endpoint, data)
        return self._handle_response(response, f'create in {self.wc_endpoint}')
    
    def update_in_wc(self, wc_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update an item in WooCommerce.
        
        Args:
            wc_id: WooCommerce ID
            data: Updated item data
            
        Returns:
            Updated item data from WooCommerce
        """
        response = self.api.put(f"{self.wc_endpoint}/{wc_id}", data)
        return self._handle_response(response, f'update {self.wc_endpoint}/{wc_id}')
    
    def delete_in_wc(self, wc_id: int, force: bool = True) -> Dict[str, Any]:
        """
        Delete an item in WooCommerce.
        
        Args:
            wc_id: WooCommerce ID
            force: Force permanent deletion (bypass trash)
            
        Returns:
            Deleted item data from WooCommerce
        """
        response = self.api.delete(
            f"{self.wc_endpoint}/{wc_id}",
            params={'force': force}
        )
        return self._handle_response(response, f'delete {self.wc_endpoint}/{wc_id}')
    
    # =========================================================================
    # Sync Methods - Local database operations
    # =========================================================================
    
    def upsert(self, wc_data: Dict[str, Any]) -> Tuple[T, bool]:
        """
        Update or insert a model instance from WooCommerce data.
        
        Args:
            wc_data: Data from WooCommerce API
            
        Returns:
            Tuple of (instance, created) where created is True for new records
        """
        wc_id = wc_data.get('id')
        if not wc_id:
            raise WooCommerceSyncError(
                "Missing WooCommerce ID in data",
                entity_type=self.model_class.__name__
            )
        
        # Transform data
        transformed_data = self.transform_from_wc(wc_data)
        
        # Separate private/temporary fields (starting with _) from model fields
        # These are used for post-processing (e.g., category linking)
        model_data = {k: v for k, v in transformed_data.items() if not k.startswith('_')}
        
        # Add audit fields
        model_data.update(self.get_audit_fields(is_create=True))
        
        # Perform upsert
        lookup = self.get_upsert_lookup(wc_id)
        
        instance, created = self.model_class.objects.update_or_create(
            **lookup,
            defaults=model_data
        )
        
        # Call post-upsert hook with full transformed data (including private fields)
        self.post_upsert_hook(instance, wc_data, transformed_data, created)
        
        action = 'Created' if created else 'Updated'
        logger.debug(f"{action} {self.model_class.__name__}: {instance} (WC#{wc_id})")
        
        return instance, created
    
    @transaction.atomic
    def sync_all(self, created_by=None, updated_by=None, **fetch_params) -> Dict[str, int]:
        """
        Sync all items from WooCommerce to local database.
        
        Args:
            created_by: User who initiated the sync (for audit trail)
            updated_by: User who initiated the sync (for audit trail)
            **fetch_params: Additional parameters for fetch_all (passed to WC API)
            
        Returns:
            Dict with counts: {'created': n, 'updated': n, 'total': n, 'errors': n}
        """
        # Store audit users for use in upsert
        self._sync_created_by = created_by
        self._sync_updated_by = updated_by
        # Marks the per-item upsert/transform as running inside a BULK sync, so
        # services can apply bulk-only optimizations (e.g. the products service
        # skips re-downloading already-localized images). The webhook path never
        # sets this, so single-product updates keep their full behavior.
        self._bulk_sync_active = True

        wc_items = self.fetch_all(**fetch_params)
        
        created_count = 0
        updated_count = 0
        error_count = 0
        
        for wc_item in wc_items:
            try:
                _, created = self.upsert(wc_item)
                if created:
                    created_count += 1
                else:
                    updated_count += 1
            except Exception as e:
                error_count += 1
                logger.error(
                    f"Failed to sync {self.model_class.__name__} "
                    f"(WC#{wc_item.get('id')}): {e}"
                )
                # Continue with other items instead of failing completely
                continue
        
        # Clean up audit references
        self._sync_created_by = None
        self._sync_updated_by = None
        
        result = {
            'created': created_count,
            'updated': updated_count,
            'errors': error_count,
            'total': len(wc_items)
        }
        
        logger.info(
            f"Sync complete for {self.model_class.__name__}: "
            f"{created_count} created, {updated_count} updated, {error_count} errors"
        )
        
        return result
    
    def sync_one(self, wc_id: int) -> Tuple[T, bool]:
        """
        Sync a single item from WooCommerce.
        
        Args:
            wc_id: WooCommerce ID
            
        Returns:
            Tuple of (instance, created)
        """
        wc_data = self.fetch_one(wc_id)
        return self.upsert(wc_data)
    
    # =========================================================================
    # Push Methods - Local to WooCommerce
    # =========================================================================
    
    def push(self, instance: T) -> Dict[str, Any]:
        """
        Push a local instance to WooCommerce (create or update).
        
        Args:
            instance: Model instance to push
            
        Returns:
            WooCommerce API response data
        """
        # Transform to WC format
        wc_data = self.transform_to_wc(instance)
        
        # Apply pre-push hook
        hook_data = self.pre_push_hook(instance)
        wc_data.update(hook_data)
        
        wc_id = getattr(instance, self.wc_id_field, None)
        
        if wc_id:
            # Update existing
            result = self.update_in_wc(wc_id, wc_data)
            logger.info(f"Pushed update to WC: {instance} (WC#{wc_id})")
        else:
            # Create new
            result = self.create_in_wc(wc_data)
            
            # Update local instance with WC ID
            new_wc_id = result.get('id')
            if new_wc_id:
                setattr(instance, self.wc_id_field, new_wc_id)
                instance.save(update_fields=[self.wc_id_field])
            
            logger.info(f"Pushed new to WC: {instance} (WC#{new_wc_id})")
        
        return result
    
    def delete_local(self, wc_id: int) -> int:
        """
        Delete local instance(s) by WooCommerce ID.
        
        Args:
            wc_id: WooCommerce ID
            
        Returns:
            Number of deleted instances
        """
        deleted_count, _ = self.model_class.objects.filter(
            sales_channel=self.sales_channel,
            **{self.wc_id_field: wc_id}
        ).delete()
        
        if deleted_count:
            logger.info(f"Deleted local {self.model_class.__name__}: WC#{wc_id}")
        
        return deleted_count
    
    # =========================================================================
    # Utility Methods
    # =========================================================================
    
    def get_local(self, wc_id: int) -> Optional[T]:
        """
        Get local instance by WooCommerce ID.
        
        Args:
            wc_id: WooCommerce ID
            
        Returns:
            Model instance or None
        """
        try:
            return self.model_class.objects.get(
                sales_channel=self.sales_channel,
                **{self.wc_id_field: wc_id}
            )
        except self.model_class.DoesNotExist:
            return None
    
    def exists_local(self, wc_id: int) -> bool:
        """Check if a local instance exists for a WooCommerce ID."""
        return self.model_class.objects.filter(
            sales_channel=self.sales_channel,
            **{self.wc_id_field: wc_id}
        ).exists()
