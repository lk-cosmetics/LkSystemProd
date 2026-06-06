"""WebSocket consumer for the real-time order queue.

Connection lifecycle
---------------------
1. ``core.ws_auth.JWTAuthMiddleware`` has already resolved ``scope['user']`` from
   the ``?token=`` query param (or left it ``AnonymousUser``).
2. ``connect`` rejects anonymous users (4401) and authenticated users who hold
   ``view_orders`` nowhere (4403).
3. Otherwise the socket joins the RBAC-scoped groups from
   :func:`apps.orders.realtime.user_order_groups` and accepts.
4. ``order_event`` relays the lightweight broadcast payload to the client, which
   reacts by silently refetching the (server-scoped) REST order list.

The consumer is deliberately tiny and carries no business logic — all
authorization lives in RBAC and the scoped REST endpoint.
"""

from __future__ import annotations

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .realtime import user_order_groups

# Application-defined close codes (4000-4999).
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


class OrdersConsumer(AsyncJsonWebsocketConsumer):
    """Per-connection fan-in of order updates for a single authenticated user."""

    async def connect(self):
        user = self.scope.get('user')
        if user is None or not getattr(user, 'is_authenticated', False):
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return

        groups = await self._resolve_groups(user)
        if not groups:
            # Authenticated but cannot view orders anywhere.
            await self.close(code=CLOSE_FORBIDDEN)
            return

        # Use a distinct attribute name — the base class manages ``self.groups``
        # automatically only if set before connect; we manage membership here.
        self._order_groups = groups
        for group in groups:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()
        await self.send_json({'type': 'connected'})

    async def disconnect(self, code):
        for group in getattr(self, '_order_groups', None) or []:
            try:
                await self.channel_layer.group_discard(group, self.channel_name)
            except Exception:  # pragma: no cover - layer hiccup on teardown
                pass

    async def receive_json(self, content, **kwargs):
        # The client only ever pings to keep proxies/load-balancers from
        # reaping an idle socket; reply so round-trip health is observable.
        if isinstance(content, dict) and content.get('type') == 'ping':
            await self.send_json({'type': 'pong'})

    # ── channel-layer group handler (matches EVENT_TYPE 'order.event') ──────
    async def order_event(self, event):
        await self.send_json(event.get('payload') or {})

    # ── helpers ─────────────────────────────────────────────────────────────
    @database_sync_to_async
    def _resolve_groups(self, user):
        return user_order_groups(user)
