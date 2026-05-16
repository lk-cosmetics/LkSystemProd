"""
LkSystem Categories App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CategoryViewSet

app_name = 'categories'

router = DefaultRouter()
router.register(r'', CategoryViewSet, basename='category')

urlpatterns = [
    path('', include(router.urls)),
]
