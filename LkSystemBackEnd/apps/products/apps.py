"""
LkSystem Products App Configuration
"""

from django.apps import AppConfig


class ProductsConfig(AppConfig):
    """Configuration for the Products app."""
    
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.products'
    verbose_name = 'Products'
    
    def ready(self):
        """
        Initialize app when ready.
        
        - Registers webhook handlers with central registry
        """
        from apps.products.handlers import register_webhook_handlers
        register_webhook_handlers()
