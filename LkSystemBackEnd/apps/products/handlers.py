"""
LkSystem Products App - App Registration
Register webhook handlers when app is ready.
"""

import logging

logger = logging.getLogger(__name__)


def register_webhook_handlers():
    """
    Register product webhook handlers with the central registry.
    
    Called from ProductsConfig.ready() to ensure handlers are
    registered when the app loads.
    """
    try:
        from core.webhooks import webhook_registry
        from apps.products.service import ProductService
        
        ProductService.register_with_registry(webhook_registry)
        
        logger.info("Product webhook handlers registered successfully")
        
    except Exception as e:
        logger.error(f"Failed to register product webhook handlers: {e}")
