"""
LkSystem Promotions App Configuration
"""

from django.apps import AppConfig


class PromotionsConfig(AppConfig):
    """Promotions app configuration."""
    
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.promotions'
    verbose_name = 'Promotions'
    
    def ready(self):
        """Import signals when app is ready."""
        pass
