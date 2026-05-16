"""
LkSystem Core Services - Service Mixins
Reusable mixins for common service functionality.
"""

import logging
from abc import ABC
from typing import TypeVar, Generic, Optional, Any, TYPE_CHECKING
from datetime import datetime, timedelta

from django.core.cache import cache
from django.db import models
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)

T = TypeVar('T', bound=models.Model)

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractUser


class AuditMixin(ABC):
    """
    Mixin providing audit trail functionality for services.
    
    Tracks created_by and updated_by fields on model operations.
    """
    
    _current_user: Optional["AbstractUser"] = None
    
    def set_user(self, user: Optional["AbstractUser"]) -> 'AuditMixin':
        """
        Set the current user for audit trail.
        Returns self for method chaining.
        """
        self._current_user = user
        return self
    
    def get_audit_fields(self, is_create: bool = False) -> dict:
        """
        Get audit fields to include in model operations.
        
        Args:
            is_create: Whether this is a create operation
            
        Returns:
            Dict with created_by/updated_by as appropriate
        """
        fields = {}
        
        if self._current_user:
            fields['updated_by'] = self._current_user
            if is_create:
                fields['created_by'] = self._current_user
        
        return fields


class PaginationMixin(ABC):
    """
    Mixin providing pagination support for API fetches.
    """
    
    DEFAULT_PAGE_SIZE: int = 100
    MAX_PAGE_SIZE: int = 100
    
    def paginate_fetch(
        self,
        fetch_func: callable,
        page_size: int = None,
        max_pages: int = None
    ) -> list:
        """
        Fetch all pages of data from an API endpoint.
        
        Args:
            fetch_func: Function that takes (page, per_page) and returns (data, has_more)
            page_size: Number of items per page
            max_pages: Maximum number of pages to fetch (None for unlimited)
            
        Returns:
            List of all fetched items
        """
        page_size = min(page_size or self.DEFAULT_PAGE_SIZE, self.MAX_PAGE_SIZE)
        all_items = []
        page = 1
        
        while True:
            if max_pages and page > max_pages:
                logger.warning(f"Reached max pages limit ({max_pages})")
                break
            
            items, has_more = fetch_func(page, page_size)
            all_items.extend(items)
            
            if not has_more:
                break
            
            page += 1
        
        return all_items


class CacheMixin(ABC):
    """
    Mixin providing caching functionality for services.
    """
    
    CACHE_PREFIX: str = 'wc'
    CACHE_TIMEOUT: int = 300  # 5 minutes default
    
    def _get_cache_key(self, *args) -> str:
        """Generate a cache key from components."""
        return f"{self.CACHE_PREFIX}:{':'.join(str(a) for a in args)}"
    
    def cache_get(self, *key_parts) -> Optional[Any]:
        """Get value from cache."""
        key = self._get_cache_key(*key_parts)
        return cache.get(key)
    
    def cache_set(self, value: Any, *key_parts, timeout: int = None) -> None:
        """Set value in cache."""
        key = self._get_cache_key(*key_parts)
        cache.set(key, value, timeout or self.CACHE_TIMEOUT)
    
    def cache_delete(self, *key_parts) -> None:
        """Delete value from cache."""
        key = self._get_cache_key(*key_parts)
        cache.delete(key)
    
    def cache_invalidate_pattern(self, pattern: str) -> None:
        """
        Invalidate all cache keys matching a pattern.
        Note: This requires a cache backend that supports pattern deletion (like Redis).
        """
        try:
            from django_redis import get_redis_connection
            redis_conn = get_redis_connection("default")
            keys = redis_conn.keys(f"{self.CACHE_PREFIX}:{pattern}*")
            if keys:
                redis_conn.delete(*keys)
        except ImportError:
            logger.warning("Pattern-based cache invalidation requires django-redis")
        except Exception as e:
            logger.error(f"Cache invalidation failed: {e}")


class TransformMixin(ABC):
    """
    Mixin providing data transformation utilities.
    """
    
    @staticmethod
    def parse_decimal(value: str, default: float = 0.0) -> float:
        """Safely parse a decimal string."""
        if not value:
            return default
        try:
            return float(value)
        except (ValueError, TypeError):
            return default
    
    @staticmethod
    def parse_datetime(value: str) -> Optional[datetime]:
        """Parse ISO datetime string."""
        if not value:
            return None
        try:
            # WooCommerce datetime format
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            return None
    
    @staticmethod
    def extract_nested(data: dict, *keys, default=None) -> Any:
        """
        Safely extract nested dictionary values.
        
        Example:
            extract_nested({'a': {'b': {'c': 1}}}, 'a', 'b', 'c') -> 1
        """
        current = data
        for key in keys:
            if not isinstance(current, dict):
                return default
            current = current.get(key)
            if current is None:
                return default
        return current
