"""
LkSystem Sales Channels App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SalesChannelViewSet, ExpenseViewSet

router = DefaultRouter()
router.register(r'expenses', ExpenseViewSet, basename='expense')
router.register(r'', SalesChannelViewSet, basename='saleschannel')

app_name = 'sales_channels'

urlpatterns = [
    path('', include(router.urls)),
]
