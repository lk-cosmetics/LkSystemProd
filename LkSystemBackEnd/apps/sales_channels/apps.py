from django.apps import AppConfig


class SalesChannelsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.sales_channels'
    label = 'sales_channels'
    verbose_name = 'Sales Channels Management'
