"""
LkSystem Inventory App - URL Routing
API endpoints for inventory management.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from apps.inventory.views import (
    SalesChannelInventoryViewSet,
    InventoryMovementViewSet,
    BillOfMaterialsViewSet,
    ProductionBatchViewSet,
)

app_name = 'inventory'

router = DefaultRouter()
router.register(r'store-inventory', SalesChannelInventoryViewSet, basename='store-inventory')
router.register(r'movements', InventoryMovementViewSet, basename='movement')
router.register(r'boms', BillOfMaterialsViewSet, basename='bom')
router.register(r'production-batches', ProductionBatchViewSet, basename='production-batch')

urlpatterns = [
    path('', include(router.urls)),
]
