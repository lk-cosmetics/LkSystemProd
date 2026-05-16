"""
LkSystem Products App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ProductViewSet

app_name = 'products'

router = DefaultRouter()
router.register(r'', ProductViewSet, basename='product')

urlpatterns = [
    path('', include(router.urls)),
]
