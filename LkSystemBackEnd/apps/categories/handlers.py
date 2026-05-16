"""
LkSystem Categories App - App Registration
Register webhook handlers when app is ready.
"""

import logging

logger = logging.getLogger(__name__)


def register_webhook_handlers():
    """
    Register category webhook handlers with the central registry.
    
    Called from CategoriesConfig.ready() to ensure handlers are
    registered when the app loads.
    """
    try:
        from core.webhooks import webhook_registry
        from apps.categories.service import CategoryService
        
        CategoryService.register_with_registry(webhook_registry)
        
        logger.info("Category webhook handlers registered successfully")
        
    except Exception as e:
        logger.error(f"Failed to register category webhook handlers: {e}")
