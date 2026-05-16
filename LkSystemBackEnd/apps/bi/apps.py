from django.apps import AppConfig


class BIConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.bi'
    verbose_name = 'Business Intelligence'

    def ready(self):
        from apps.bi import signals  # noqa: F401
