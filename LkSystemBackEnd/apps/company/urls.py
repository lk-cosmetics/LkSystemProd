"""
LkSystem Company App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CompanyViewSet

router = DefaultRouter()
router.register(r'', CompanyViewSet, basename='company')

app_name = 'company'

urlpatterns = [
    path('', include(router.urls)),
]
