"""
LkSystem RBAC — URL Configuration.

All endpoints live under ``/api/v1/rbac/``.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .api.views import (
    AssignmentViewSet,
    PageViewSet,
    PermissionViewSet,
    RoleViewSet,
)

router = DefaultRouter()
router.register('roles', RoleViewSet, basename='rbac-role')
router.register('assignments', AssignmentViewSet, basename='rbac-assignment')
router.register('permissions', PermissionViewSet, basename='rbac-permission')
router.register('pages', PageViewSet, basename='rbac-page')

urlpatterns = [
    path('', include(router.urls)),
]
