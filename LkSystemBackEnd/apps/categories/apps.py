"""
LkSystem Categories App Configuration
"""

from django.apps import AppConfig


class CategoriesConfig(AppConfig):
    """Configuration for the Categories app."""
    
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.categories'
    verbose_name = 'Categories'
    
    def ready(self):
        """
        Initialize app when ready.
        
        - Registers webhook handlers with central registry
        """
        from apps.categories.handlers import register_webhook_handlers
        register_webhook_handlers()
