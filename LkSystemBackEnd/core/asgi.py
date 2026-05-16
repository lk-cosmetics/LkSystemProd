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

websocket_urlpatterns = (
    sales_channels_routing.websocket_urlpatterns
    + inventory_routing.websocket_urlpatterns
)

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': URLRouter(websocket_urlpatterns),
})
