"""
ASGI config for LkSystem project.
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

django_asgi_app = get_asgi_application()

from apps.sales_channels import routing as sales_channels_routing
from apps.inventory import routing as inventory_routing
from apps.orders import routing as orders_routing
from core.ws_auth import JWTAuthMiddleware

websocket_urlpatterns = (
    sales_channels_routing.websocket_urlpatterns
    + inventory_routing.websocket_urlpatterns
    + orders_routing.websocket_urlpatterns
)

# All WebSocket traffic passes through JWT auth so consumers can read
# ``scope['user']``. Token-less connections (e.g. the public inventory feed)
# simply arrive as AnonymousUser and keep working unchanged.
application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
})
