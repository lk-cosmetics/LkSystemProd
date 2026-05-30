"""
LkSystem URL Configuration
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.middleware.csrf import get_token
from rest_framework.permissions import AllowAny, IsAuthenticated
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from apps.users.urls import auth_urlpatterns


# =============================================================================
# CUSTOM SCHEMA VIEWS WITH PROPER AUTHENTICATION
# =============================================================================

class PublicSpectacularAPIView(SpectacularAPIView):
    """Public schema endpoint (no authentication required)."""
    permission_classes = [AllowAny]


class AuthenticatedSwaggerView(SpectacularSwaggerView):
    """Swagger UI - requires authentication."""
    permission_classes = [IsAuthenticated]


class AuthenticatedReDocView(SpectacularRedocView):
    """ReDoc UI - requires authentication."""
    permission_classes = [IsAuthenticated]


# =============================================================================
# UTILITY VIEWS
# =============================================================================

def root_view(request):
    """Root endpoint - API health check and welcome message."""
    return JsonResponse({
        'message': 'Welcome to LkSystem ERP API',
        'version': '1.4.0',
        'status': 'running',
        'docs': '/api/docs/',
        'endpoints': {
            'auth': '/api/v1/auth/',
            'users': '/api/v1/users/',
            'company': '/api/v1/company/',
            'brands': '/api/v1/brands/',
            'sales_channels': '/api/v1/sales-channels/',
            'categories': '/api/v1/categories/',
            'products': '/api/v1/products/',
            'promotions': '/api/v1/promotions/',
            'inventory': '/api/v1/inventory/',
            'clients': '/api/v1/clients/',
            'orders': '/api/v1/orders/',
            'dashboard': '/api/v1/dashboard/',
            'notifications': '/api/v1/notifications/',
            'webhooks': '/api/v1/webhooks/',
        }
    })


@ensure_csrf_cookie
def get_csrf_token(request):
    """
    Get CSRF token for frontend.
    Sets CSRF cookie and returns token in response.
    """
    csrf_token = get_token(request)
    return JsonResponse({
        'detail': 'CSRF cookie set.',
        'csrfToken': csrf_token,
    })


urlpatterns = [
    # Root endpoint
    path('', root_view, name='root'),
    
    # Django Admin (SuperAdmin only)
    path('admin/', admin.site.urls),
    
    # API Schema Endpoint (Public - for tools like clients to fetch schema)
    path('api/schema/', PublicSpectacularAPIView.as_view(), name='schema'),
    
    # API Documentation Endpoints (AUTHENTICATED - requires JWT token)
    path('api/docs/', AuthenticatedSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', AuthenticatedReDocView.as_view(url_name='schema'), name='redoc'),
    
    # CSRF Token endpoint (public)
    path('api/v1/csrf/', get_csrf_token, name='csrf_token'),
    
    # API v1 Routes - Micro-App Architecture
    path('api/v1/auth/', include(auth_urlpatterns)),  # JWT Auth endpoints (login is public)
    path('api/v1/users/', include('apps.users.urls')),  # User management
    path('api/v1/company/', include('apps.company.urls')),
    path('api/v1/brands/', include('apps.brands.urls')),
    path('api/v1/sales-channels/', include('apps.sales_channels.urls')),
    path('api/v1/categories/', include('apps.categories.urls')),  # Category management
    path('api/v1/products/', include('apps.products.urls')),  # Product management
    path('api/v1/', include('apps.promotions.urls')),  # Promotions engine
    path('api/v1/inventory/', include('apps.inventory.urls')),  # Inventory management
    path('api/v1/clients/', include('apps.clients.urls')),  # Client management
    path('api/v1/orders/', include('apps.orders.urls')),  # Order management
    path('api/v1/rbac/', include('apps.rbac.urls')),  # RBAC management
    path('api/v1/dashboard/', include('apps.bi.urls')),  # BI dashboard
    path('api/v1/notifications/', include('apps.notifications.urls')),  # Notifications
    
    # Centralized Webhook System (recommended for new integrations)
    path('api/v1/webhooks/', include('core.webhooks.urls')),  # Unified WooCommerce webhooks
    
    # DRF Auth (for browsable API)
    path('api-auth/', include('rest_framework.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

# Admin Site Customization
admin.site.site_header = 'LkSystem Administration'
admin.site.site_title = 'LkSystem Admin'
admin.site.index_title = 'Welcome to LkSystem ERP'
