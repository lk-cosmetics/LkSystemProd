"""
LkSystem Categories App - Service Layer
CategoryService inheriting from BaseWooCommerceService.
"""

import logging
from typing import Optional, Dict, Any, List

from django.db import transaction
from django.utils import timezone

from apps.categories.models import Category
from apps.sales_channels.models import SalesChannel
from core.services import BaseWooCommerceService
from core.services.exceptions import WooCommerceSyncError
from core.webhooks import WebhookContext
from core.webhooks.decorators import WebhookHandlerMixin

logger = logging.getLogger(__name__)


class CategoryService(BaseWooCommerceService[Category], WebhookHandlerMixin):
    """
    Service for managing Category synchronization with WooCommerce.
    
    Inherits from BaseWooCommerceService to leverage common functionality
    while providing category-specific transformations and logic.
    
    Features:
    - Hierarchical category sync with parent resolution
    - Tree structure building
    - Webhook handling for category events
    
    Usage:
        service = CategoryService(sales_channel)
        
        # Fetch all categories from WooCommerce
        categories = service.fetch_all()
        
        # Sync all categories to local database
        result = service.sync_all()
        
        # Get category tree
        tree = service.get_category_tree()
    """
    
    # Webhook topics this service handles
    WEBHOOK_TOPICS = [
        'product_cat.created',
        'product_cat.updated', 
        'product_cat.deleted',
    ]
    
    @property
    def model_class(self) -> type:
        return Category
    
    @property
    def wc_endpoint(self) -> str:
        return 'products/categories'
    
    @property
    def wc_id_field(self) -> str:
        return 'wc_category_id'
    
    # =========================================================================
    # WooCommerce -> Local Transformation
    # =========================================================================
    
    def transform_from_wc(self, wc_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transform WooCommerce category data to local model fields.
        
        Handles:
        - Field mapping
        - Image extraction
        - Parent ID storage for later resolution
        """
        # Extract image URL
        image = wc_data.get('image', {}) or {}
        image_url = image.get('src', '') if image else ''
        
        transformed = {
            'wc_category_id': wc_data['id'],
            'name': wc_data.get('name', ''),
            'slug': wc_data.get('slug', ''),
            'description': wc_data.get('description', ''),
            'image_url': image_url,
            'display_order': wc_data.get('menu_order', 0),
            '_wc_parent_id': wc_data.get('parent', 0) or None,
        }
        
        return transformed
    
    # =========================================================================
    # Local -> WooCommerce Transformation
    # =========================================================================
    
    def transform_to_wc(self, instance: Category) -> Dict[str, Any]:
        """
        Transform local Category instance to WooCommerce API format.
        """
        wc_data = {
            'name': instance.name,
            'slug': instance.slug,
            'description': instance.description,
            'menu_order': instance.display_order,
        }
        
        # Handle parent relationship
        if instance.parent and instance.parent.wc_category_id:
            wc_data['parent'] = instance.parent.wc_category_id
        else:
            wc_data['parent'] = 0
        
        # Handle image
        if instance.image_url:
            wc_data['image'] = {'src': instance.image_url}
        
        return wc_data
    
    # =========================================================================
    # Override Sync to Handle Parent Resolution
    # =========================================================================
    
    def sync_all(self, created_by=None, updated_by=None) -> Dict[str, int]:
        """
        Sync all categories with parent resolution.

        Override to handle hierarchical parent-child relationships
        after all categories are synced.
        """
        # Fetch all WC data so we can resolve parents afterwards
        all_wc_data = self.fetch_all()

        # First pass: sync all categories
        result = super().sync_all(created_by=created_by, updated_by=updated_by)

        # Second pass: resolve parent relationships using WC data
        resolved = self._resolve_parent_relationships(all_wc_data)
        result['parents_resolved'] = resolved

        return result

    def _resolve_parent_relationships(self, wc_data_list: List[Dict[str, Any]]) -> int:
        """
        Resolve parent category relationships using WC parent IDs.

        This is done as a second pass after all categories are synced
        to handle cases where child categories are synced before parents.

        Args:
            wc_data_list: List of raw WooCommerce category dicts containing
                          'id' and 'parent' keys.
        """
        resolved = 0

        for wc_cat in wc_data_list:
            wc_parent_id = wc_cat.get('parent', 0) or 0
            if not wc_parent_id:
                continue

            try:
                category = Category.objects.get(
                    sales_channel=self.sales_channel,
                    wc_category_id=wc_cat['id']
                )
                parent = Category.objects.get(
                    sales_channel=self.sales_channel,
                    wc_category_id=wc_parent_id
                )

                if category.parent_id != parent.id:
                    category.parent = parent
                    category.save(update_fields=['parent'])
                    resolved += 1

            except Category.DoesNotExist:
                logger.warning(
                    f"Parent resolution failed for wc_id={wc_cat['id']}: "
                    f"wc_parent_id={wc_parent_id}"
                )

        return resolved
    
    # =========================================================================
    # Webhook Handlers
    # =========================================================================
    
    def handle_upsert(self, context: WebhookContext) -> dict:
        """Handle product_cat.created and product_cat.updated webhooks."""
        payload = context.payload
        
        if not payload or 'id' not in payload:
            return {'detail': 'No category data in payload'}
        
        try:
            instance, created = self.upsert(payload)

            # Resolve parent relationship immediately using WC payload
            wc_parent_id = payload.get('parent', 0) or 0
            if wc_parent_id:
                try:
                    parent = Category.objects.get(
                        sales_channel=self.sales_channel,
                        wc_category_id=wc_parent_id
                    )
                    if instance.parent_id != parent.id:
                        instance.parent = parent
                        instance.save(update_fields=['parent'])
                except Category.DoesNotExist:
                    pass  # Parent will be resolved on full sync

            action = 'created' if created else 'updated'
            
            return {
                'detail': f'Category {action} successfully',
                'category_id': instance.id,
                'wc_category_id': instance.wc_category_id,
                'action': action,
            }
        except Exception as e:
            logger.exception(f"Error processing category webhook: {e}")
            return {'detail': f'Error processing category: {str(e)}'}
    
    def handle_delete(self, context: WebhookContext) -> dict:
        """Handle product_cat.deleted webhook."""
        payload = context.payload
        wc_id = payload.get('id')
        
        if not wc_id:
            return {'detail': 'No category ID in payload'}
        
        deleted = self.delete_local(wc_id)
        
        if deleted:
            return {
                'detail': 'Category deleted successfully',
                'wc_category_id': wc_id,
            }
        else:
            return {
                'detail': 'Category not found locally',
                'wc_category_id': wc_id,
            }
    
    # =========================================================================
    # Category-Specific Methods
    # =========================================================================
    
    def get_category_tree(self) -> List[Dict[str, Any]]:
        """
        Build a hierarchical tree structure of categories.
        
        Returns:
            List of root categories with nested children
        """
        categories = Category.objects.filter(
            sales_channel=self.sales_channel
        ).order_by('display_order', 'name')
        
        # Build nodes with empty children list
        nodes: Dict[int, Dict[str, Any]] = {}
        for cat in categories:
            nodes[cat.id] = self._category_to_dict(cat)
            nodes[cat.id]['children'] = []
        
        # Build tree by linking parents to children
        tree = []
        for cat in categories:
            node = nodes[cat.id]
            if cat.parent_id is None:
                tree.append(node)
            elif cat.parent_id in nodes:
                nodes[cat.parent_id]['children'].append(node)
        
        return tree
    
    def _category_to_dict(self, category: Category) -> Dict[str, Any]:
        """Convert category to dictionary for tree building."""
        return {
            'id': category.id,
            'wc_category_id': category.wc_category_id,
            'name': category.name,
            'slug': category.slug,
            'description': category.description,
            'image_url': category.image_url,
            'display_order': category.display_order,
            'parent_id': category.parent_id,
        }
    
    def get_root_categories(self) -> List[Category]:
        """Get all root-level categories (no parent)."""
        return list(
            Category.objects.filter(
                sales_channel=self.sales_channel,
                parent__isnull=True
            ).order_by('display_order', 'name')
        )
    
    def get_children(self, category: Category) -> List[Category]:
        """Get direct children of a category."""
        return list(
            Category.objects.filter(
                sales_channel=self.sales_channel,
                parent=category
            ).order_by('display_order', 'name')
        )
    
    def get_descendants(self, category: Category) -> List[Category]:
        """
        Get all descendants of a category (recursive).
        
        Warning: This can be slow for deep hierarchies.
        """
        descendants = []
        children = self.get_children(category)
        
        for child in children:
            descendants.append(child)
            descendants.extend(self.get_descendants(child))
        
        return descendants
    
    def get_ancestors(self, category: Category) -> List[Category]:
        """
        Get all ancestors of a category (from parent to root).
        """
        ancestors = []
        current = category.parent
        
        while current:
            ancestors.append(current)
            current = current.parent
        
        return ancestors
    
    def get_breadcrumb(self, category: Category) -> List[str]:
        """
        Get breadcrumb path for a category.
        
        Returns:
            List of category names from root to current
        """
        ancestors = self.get_ancestors(category)
        ancestors.reverse()
        
        return [cat.name for cat in ancestors] + [category.name]
    
    def get_product_count(self, category: Category) -> int:
        """Get count of products in this category."""
        return category.products.count()
    
    def get_total_product_count(self, category: Category) -> int:
        """Get count of products in this category and all descendants."""
        count = self.get_product_count(category)
        
        for descendant in self.get_descendants(category):
            count += self.get_product_count(descendant)
        
        return count
