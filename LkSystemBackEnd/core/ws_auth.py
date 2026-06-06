"""JWT authentication middleware for Django Channels (WebSocket).

Production serves WebSockets through a dedicated daphne ASGI sidecar (gunicorn
keeps handling all REST/HTTP). WebSocket handshakes cannot carry an
``Authorization`` header from the browser ``WebSocket`` API, so the SPA passes
the SimpleJWT *access* token in the query string (``?token=<jwt>``). This
middleware validates that token and populates ``scope['user']``.

Design notes
------------
* Failure is never fatal here — on any problem we fall back to ``AnonymousUser``
  and let the consumer decide whether to reject. Consumers that need auth
  (``OrdersConsumer``) close the socket; consumers that are public
  (``InventoryConsumer``) keep working exactly as before.
* Validation uses ``AccessToken`` which checks the signature, ``exp`` and the
  token type. We never trust an unsigned/expired token.
* The DB lookup is wrapped in ``database_sync_to_async`` so it is safe to call
  from the async middleware without blocking the event loop.
"""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser


def _extract_token(scope) -> str | None:
    """Pull the JWT from the ``?token=`` (or ``?access_token=``) query param."""
    raw = scope.get('query_string') or b''
    if not raw:
        return None
    try:
        params = parse_qs(raw.decode())
    except Exception:  # pragma: no cover - malformed query string
        return None
    values = params.get('token') or params.get('access_token')
    if not values:
        return None
    token = values[0].strip()
    return token or None


@database_sync_to_async
def _resolve_user(token: str | None):
    if not token:
        return AnonymousUser()
    try:
        from django.contrib.auth import get_user_model
        from rest_framework_simplejwt.tokens import AccessToken

        access = AccessToken(token)  # validates signature, expiry & token type
        user_id = access.get('user_id')
        if not user_id:
            return AnonymousUser()
        user = (
            get_user_model()
            ._default_manager.filter(pk=user_id, is_active=True)
            .first()
        )
        return user or AnonymousUser()
    except Exception:  # noqa: BLE001 - invalid/expired token → anonymous
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """Populate ``scope['user']`` from a query-string SimpleJWT access token."""

    async def __call__(self, scope, receive, send):
        scope['user'] = await _resolve_user(_extract_token(scope))
        return await super().__call__(scope, receive, send)
