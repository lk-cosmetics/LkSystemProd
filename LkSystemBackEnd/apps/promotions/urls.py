"""
LkSystem Promotions App - URL Configuration
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import PromotionViewSet, PromotionChannelRuleViewSet


router = DefaultRouter()
router.register(r'promotions', PromotionViewSet, basename='promotion')
router.register(r'promotion-rules', PromotionChannelRuleViewSet, basename='promotion-rule')

app_name = 'promotions'

urlpatterns = [
    path('', include(router.urls)),
]
