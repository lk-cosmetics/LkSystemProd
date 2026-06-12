"""Real-time order fan-out over the Channels layer.

Security & correctness model
-----------------------------
* **Signal, not data.** A broadcast carries only a tiny envelope — order id,
  current ``status``, ``source`` and a deleted flag — never order detail.
  The client treats it as "something changed, refetch now" and pulls the
  authoritative list through the normal REST endpoint, which is already scoped
  by ``OrderViewSet._scope_queryset``. A mis-scoped group therefore can never
  leak order data; at worst it triggers a refetch that returns nothing extra.
* **Groups mirror RBAC.** ``user_order_groups`` reproduces the exact assignment
  query used by ``OrderViewSet._permission_scope_q`` (the same
  ``role__permissions__codename='view_orders'`` filter), and a broadcast targets
  every scope dimension an order belongs to (company, brand, sales channel and
  POS channel). So a user only receives frames for orders inside their RBAC
  scope. Transient workspace focus (current brand/company) is **not** encoded in
  group membership — it is applied by the scoped REST refetch, exactly like the
  page already does.
* **Best effort.** Broadcasting must never break order creation/updates. Every
  failure is swallowed and the client's polling fallback guarantees eventual
  consistency.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Group every privileged (platform/superuser) viewer joins.
GROUP_ALL = 'orders.all'

# Channel-layer message type → ``OrdersConsumer.order_event``.
EVENT_TYPE = 'order.event'


# ── group-name builders (single source of truth) ───────────────────────────
def company_group(company_id) -> str:
    return f'orders.company.{company_id}'


def brand_group(brand_id) -> str:
    return f'orders.brand.{brand_id}'


def channel_group(sales_channel_id) -> str:
    return f'orders.sc.{sales_channel_id}'


def pos_channel_group(pos_sales_channel_id) -> str:
    return f'orders.scpos.{pos_sales_channel_id}'


def order_broadcast_groups(order) -> set[str]:
    """Every group an order's update should be delivered to.

    Mirrors the matching done in ``OrderViewSet._permission_scope_q``:
    a sales-channel assignment matches ``sales_channel`` *or* ``pos_sales_channel``;
    a brand assignment matches the order's brand *or* its channel's brand;
    a company assignment matches the order's company.
    """
    groups: set[str] = {GROUP_ALL}
    if getattr(order, 'company_id', None):
        groups.add(company_group(order.company_id))
    if getattr(order, 'brand_id', None):
        groups.add(brand_group(order.brand_id))
    if getattr(order, 'sales_channel_id', None):
        groups.add(channel_group(order.sales_channel_id))
    if getattr(order, 'pos_sales_channel_id', None):
        groups.add(pos_channel_group(order.pos_sales_channel_id))
    return groups


def user_order_groups(user):
    """Groups a user should subscribe to, or ``None`` if they may not view orders.

    Returns ``None`` only for an authenticated user who holds ``view_orders``
    nowhere — the consumer treats that as a forbidden connection. An empty set is
    never returned: any positive result contains at least one group.
    """
    from apps.rbac.models import UserRole
    from apps.rbac.services import PermissionService

    codename = 'view_orders'

    # 1) Operational accounts pinned to a single sales point (Employee/Cashier)
    #    see ONLY that channel — web orders on it or POS orders rung on it.
    asc_id = getattr(user, 'assigned_sales_channel_id', None)
    if asc_id:
        return {channel_group(asc_id), pos_channel_group(asc_id)}

    # 2) Superusers / platform-role holders can act across every company.
    #    Workspace (brand/company) focus narrowing is applied by the REST refetch.
    if PermissionService.is_platform_admin(user):
        return {GROUP_ALL}

    # 3) Everyone else: derive groups from the assignments that grant view_orders,
    #    using the SAME query as OrderViewSet._permission_scope_q.
    assignments = (
        UserRole.objects.filter(
            user=user, role__permissions__codename=codename
        )
        .values_list('company_id', 'brand_id', 'sales_channel_id')
        .distinct()
    )
    groups: set[str] = set()
    for company_id, brand_id, sales_channel_id in assignments:
        if not company_id and not brand_id and not sales_channel_id:
            # A platform-scoped role granting view_orders ⇒ everything.
            return {GROUP_ALL}
        if sales_channel_id:
            groups.add(channel_group(sales_channel_id))
            groups.add(pos_channel_group(sales_channel_id))
        elif brand_id:
            groups.add(brand_group(brand_id))
        elif company_id:
            groups.add(company_group(company_id))

    return groups or None


def broadcast_order_event(order, *, event: str = 'updated') -> None:
    """Schedule a lightweight order signal to all scoped groups, post-commit.

    Safe to call from inside a transaction or a signal handler — it defers the
    actual send to ``transaction.on_commit`` so the client only refetches once
    the change is durably visible, and it never raises.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        from django.db import transaction

        layer = get_channel_layer()
        if layer is None:  # channels not configured (e.g. some test setups)
            return

        payload = {
            'type': 'order',
            'event': event,  # 'created' | 'updated' | 'deleted'
            'order_id': getattr(order, 'id', None),
            'status': getattr(order, 'status', None),
            'source': getattr(order, 'source', None),
            'is_deleted': bool(getattr(order, 'is_deleted', False)),
        }
        message = {'type': EVENT_TYPE, 'payload': payload}
        groups = order_broadcast_groups(order)

        def _send():
            try:
                for group in groups:
                    async_to_sync(layer.group_send)(group, message)
            except Exception:  # pragma: no cover - transport hiccup
                logger.debug('order ws broadcast failed', exc_info=True)

        transaction.on_commit(_send)
    except Exception:  # pragma: no cover - never break the caller
        logger.debug('order ws broadcast scheduling failed', exc_info=True)
