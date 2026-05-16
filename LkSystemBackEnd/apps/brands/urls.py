"""
LkSystem Brands App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import BrandViewSet

router = DefaultRouter()
router.register(r'', BrandViewSet, basename='brand')

app_name = 'brands'

urlpatterns = [
    path('', include(router.urls)),
]
