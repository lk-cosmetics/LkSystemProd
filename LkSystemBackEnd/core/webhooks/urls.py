"""
LkSystem Core Webhooks - URL Configuration
Centralized webhook URL patterns.
"""

from django.urls import path

from .views import (
    UnifiedWebhookView,
    LegacyProductWebhookView,
    LegacyCategoryWebhookView,
)

app_name = 'webhooks'

urlpatterns = [
    # Unified webhook endpoint (recommended)
    path(
        'woocommerce/',
        UnifiedWebhookView.as_view(),
        name='woocommerce-unified'
    ),
    
    # Legacy endpoints for backwards compatibility
    path(
        'woocommerce/products/',
        LegacyProductWebhookView.as_view(),
        name='woocommerce-products'
    ),
    path(
        'woocommerce/categories/',
        LegacyCategoryWebhookView.as_view(),
        name='woocommerce-categories'
    ),
]
