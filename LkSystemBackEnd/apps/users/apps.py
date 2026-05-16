from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.users'
    label = 'users'
    verbose_name = 'Users & Authentication'
    
    def ready(self):
        """Import signals when app is ready."""
        # Import signals to register them
        from . import signals  # noqa: F401
