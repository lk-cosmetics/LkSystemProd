"""
LkSystem Notifications App - Configuration

Role-based, user-targeted notification system. Side effects (creating
notifications from order / inventory / settings events) are wired through
signals so that no existing app needs to import the notification layer.
"""

from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.notifications'
    verbose_name = 'Notifications'

    def ready(self):
        # Registering the event signal receivers keeps notification creation
        # centralized in this app and out of the order / inventory services.
        import apps.notifications.signals  # noqa: F401
