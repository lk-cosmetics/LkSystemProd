"""
LkSystem Sales Channels App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SalesChannelViewSet, CashMovementViewSet

router = DefaultRouter()
router.register(r'cash-movements', CashMovementViewSet, basename='cashmovement')
router.register(r'', SalesChannelViewSet, basename='saleschannel')

app_name = 'sales_channels'

urlpatterns = [
    path('', include(router.urls)),
]
