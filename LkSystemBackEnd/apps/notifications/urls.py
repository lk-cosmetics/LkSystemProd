"""
LkSystem Notifications App - URL Routing

Mounted at ``/api/v1/notifications/`` by ``core/urls.py``. A SimpleRouter (no
API-root view) is used because the viewset is registered at the empty prefix.
"""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.notifications.views import NotificationViewSet

app_name = 'notifications'

router = SimpleRouter()
router.register(r'', NotificationViewSet, basename='notification')

urlpatterns = [
    path('', include(router.urls)),
]
