from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import OrderViewSet, OrderSyncEventViewSet

router = DefaultRouter()
router.register('sync-events', OrderSyncEventViewSet, basename='order-sync-events')
router.register('', OrderViewSet, basename='orders')

urlpatterns = [
    path('', include(router.urls)),
]
