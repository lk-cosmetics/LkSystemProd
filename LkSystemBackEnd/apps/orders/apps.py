from django.apps import AppConfig


class OrdersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.orders'
    verbose_name = 'Orders'

    def ready(self):
        from apps.orders import signals  # noqa: F401

        # Register webhook handlers when the app loads
        from apps.orders.handlers import register_webhook_handlers
        register_webhook_handlers()
