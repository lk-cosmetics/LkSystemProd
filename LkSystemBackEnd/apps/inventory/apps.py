"""
LkSystem Inventory App - Configuration
Multi-Store Inventory Management Module.
"""

from django.apps import AppConfig


class InventoryConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.inventory'
    verbose_name = 'Inventory Management'
    
    def ready(self):
        # Import signals to register them
        import apps.inventory.signals  # noqa: F401
