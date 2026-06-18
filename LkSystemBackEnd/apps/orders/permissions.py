"""
LkSystem Orders — Permission gates.

Authorization *decisions* for order actions, kept out of the viewset so the same
rule can be reused by services/tasks and unit-tested without an HTTP request.

  * ``require_order_permission`` — the imperative gate: raises
    ``PermissionDenied`` when the user lacks a codename (optionally scoped to one
    order's company/brand/channel). Superusers always pass.
  * ``permission_for_edit`` — maps an order's lifecycle state to the codename
    that governs editing it (confirmed/packaging/done need the stronger
    ``update_confirmed_orders``).

Row *filtering* (which orders a user may list) lives in ``selectors.py``; this
module is only about "may this user do X to this order".
"""

from __future__ import annotations

from rest_framework.exceptions import PermissionDenied

from apps.rbac.services import PermissionService

from .models import Order


def require_order_permission(user, codename: str, order: Order | None = None) -> None:
    """Raise ``PermissionDenied`` unless ``user`` holds ``codename``.

    When ``order`` is given the check is scoped to that order's
    company/brand/sales-channel; otherwise it is an unscoped (union) check.
    Superusers bypass the check entirely.
    """
    if user.is_superuser:
        return
    if order is not None:
        has_perm = PermissionService.has_permission(
            user,
            codename,
            company=order.company,
            brand=order.sales_channel.brand,
            sales_channel=order.sales_channel,
        )
    else:
        has_perm = PermissionService.has_permission(user, codename)
    if not has_perm:
        raise PermissionDenied('You do not have permission to perform this action.')


def permission_for_edit(order: Order) -> str:
    """Codename governing edits to ``order`` given its lifecycle state.

    Confirmed / packaging / done orders are post-commitment, so editing them
    needs the stronger ``update_confirmed_orders``; everything earlier needs
    ``update_unconfirmed_orders``.
    """
    return (
        'update_confirmed_orders'
        if order.status in (
            Order.Status.CONFIRMED, Order.Status.PACKAGING, Order.Status.DONE,
        )
        else 'update_unconfirmed_orders'
    )
