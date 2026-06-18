"""
LkSystem Notifications App - Service layer

All notification creation goes through ``NotificationService``. Nothing else in
the codebase instantiates ``Notification`` directly, which keeps:

* **Targeting** in one place. The product spec talks about "confirmation
  agents", "packaging agents" and "return agents", but the RBAC model only
  ships six real roles (Super Admin, CEO, Manager, Brand Manager, Employee,
  Cashier) — all operational order work folds into *Employee*. The semantic
  audiences below map those concepts onto the real roles exactly once.

* **Safety** in one place. Fan-out happens on ``transaction.on_commit`` and is
  fully wrapped in try/except: a notification failure can never roll back or
  break the order / inventory operation that triggered it.

* **Tenant isolation** in one place. Audiences are always resolved *within the
  notification's company* (plus platform Super Admins, who are global by
  definition). A user never receives a row for another company's event.
"""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q

from apps.notifications.models import Notification, NotificationRecipient

logger = logging.getLogger(__name__)

Category = Notification.Category
Priority = Notification.Priority
TargetType = Notification.TargetType

# ── Real RBAC role names ──────────────────────────────────────────────────────
ROLE_SUPER_ADMIN   = 'Super Admin'
ROLE_CEO           = 'CEO'
ROLE_MANAGER       = 'Manager'
ROLE_BRAND_MANAGER = 'Brand Manager'
ROLE_EMPLOYEE      = 'Employee'
ROLE_CASHIER       = 'Cashier'

# ── Semantic audiences → real roles (Super Admin is added separately) ─────────
# Management / "admin + manager": company owners and managers.
AUDIENCE_MANAGEMENT = (ROLE_CEO, ROLE_MANAGER)
# "Admin only": company owner. Used for system-settings changes.
AUDIENCE_ADMIN      = (ROLE_CEO,)
# "Confirmation / packaging / return agents": all operational, folded into Employee.
AUDIENCE_OPERATIONS = (ROLE_EMPLOYEE,)

# Stable frontend deep-link per category (order details open as a popup on the
# orders page, so a query string is unnecessary).
LINK_BY_CATEGORY = {
    Category.ORDER:    '/dashboard/orders',
    Category.SYNC:     '/dashboard/orders',
    Category.RETURN:   '/dashboard/orders',
    Category.EXCHANGE: '/dashboard/orders',
    Category.STOCK:    '/dashboard/inventory',
    Category.SYSTEM:   '/dashboard/settings',
}


class NotificationService:
    """Centralized, role-aware notification creation."""

    # ── audience resolution ──────────────────────────────────────────────────

    @staticmethod
    def resolve_users(company_id, role_names, include_platform_admins=True):
        """
        Active users who hold one of ``role_names`` *within* ``company_id``.

        ``include_platform_admins`` additionally pulls in platform-level
        Super Admins (their roles have ``company IS NULL``). The leading
        ``is_active=True`` filter and ``.distinct()`` guard against duplicates
        from the role M2M join.
        """
        User = get_user_model()
        role_names = list(role_names or ())
        q = Q()
        if role_names:
            q |= Q(
                user_roles__role__name__in=role_names,
                user_roles__role__company_id=company_id,
            )
        if include_platform_admins:
            q |= Q(
                user_roles__role__name=ROLE_SUPER_ADMIN,
                user_roles__role__company__isnull=True,
            )
        if not q:
            return User.objects.none()
        return User.objects.filter(is_active=True).filter(q).distinct()

    # ── core entry point ───────────────────────────────────────────────────────

    @classmethod
    def notify(cls, *, company, category, title, body='',
               priority=Priority.NORMAL, recipients=None, role_names=None,
               include_platform_admins=True, target_type=None, link_url='',
               entity_type='', entity_id='', metadata=None,
               created_by=None, exclude_actor=True):
        """
        Schedule a notification for delivery after the current DB transaction
        commits. Returns nothing; the actual write is deferred so that a
        notification problem can never affect the triggering business write.

        Provide ``recipients`` (explicit users) and/or ``role_names`` (resolved
        within ``company``). ``exclude_actor`` drops ``created_by`` from the
        audience so users are not notified about their own action.
        """
        company_id = getattr(company, 'id', company)
        recipient_ids = cls._to_ids(recipients)
        role_names = tuple(role_names or ())
        actor_id = getattr(created_by, 'id', None)
        meta = dict(metadata or {})

        def _run():
            try:
                cls._create_and_fanout(
                    company_id=company_id, category=category, title=title,
                    body=body, priority=priority, recipient_ids=recipient_ids,
                    role_names=role_names,
                    include_platform_admins=include_platform_admins,
                    target_type=target_type, link_url=link_url,
                    entity_type=entity_type, entity_id=entity_id, metadata=meta,
                    created_by_id=actor_id, exclude_actor=exclude_actor,
                )
            except Exception:  # pragma: no cover - defensive, never break callers
                logger.exception('Notification fan-out failed: %s', title)

        # Runs immediately when there is no open transaction (e.g. management
        # commands), or after COMMIT inside a request / lifecycle transaction.
        transaction.on_commit(_run)

    @classmethod
    def _create_and_fanout(cls, *, company_id, category, title, body, priority,
                           recipient_ids, role_names, include_platform_admins,
                           target_type, link_url, entity_type, entity_id,
                           metadata, created_by_id, exclude_actor):
        user_ids = set(recipient_ids or ())
        if role_names:
            user_ids.update(
                cls.resolve_users(company_id, role_names, include_platform_admins)
                   .values_list('id', flat=True)
            )
        if exclude_actor and created_by_id is not None:
            user_ids.discard(created_by_id)
        if not user_ids:
            return None

        resolved_target = target_type or cls._infer_target_type(recipient_ids, role_names)

        with transaction.atomic():
            notif = Notification.objects.create(
                company_id=company_id, category=category, priority=priority,
                title=title, body=body, target_type=resolved_target,
                target_roles=list(role_names), link_url=link_url,
                entity_type=entity_type, entity_id=str(entity_id or ''),
                metadata=metadata, created_by_id=created_by_id,
            )
            rows = [
                NotificationRecipient(
                    notification=notif, user_id=uid, category=category,
                    priority=priority, created_at=notif.created_at,
                )
                for uid in user_ids
            ]
            NotificationRecipient.objects.bulk_create(
                rows, batch_size=1000, ignore_conflicts=True,
            )
        return notif

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _to_ids(recipients):
        if not recipients:
            return ()
        ids = []
        for r in recipients:
            rid = getattr(r, 'id', r)
            if rid is not None:
                ids.append(int(rid))
        return tuple(ids)

    @staticmethod
    def _infer_target_type(recipient_ids, role_names):
        if role_names:
            return (TargetType.MULTI_ROLE if len(role_names) > 1
                    else TargetType.ROLE)
        if recipient_ids:
            return TargetType.USER
        return TargetType.ROLE

    # ══════════════════════════════════════════════════════════════════════════
    # Event convenience methods — the ONLY place each event's audience, category,
    # priority and copy is defined. Signals (signals.py) call straight into these.
    # ══════════════════════════════════════════════════════════════════════════

    # ── orders ──────────────────────────────────────────────────────────────

    @classmethod
    def order_imported(cls, order):
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.NORMAL,
            role_names=AUDIENCE_MANAGEMENT + AUDIENCE_OPERATIONS,
            target_type=TargetType.MULTI_ROLE,
            title=f'New order imported · {order.order_number}',
            body=(f'Order {order.order_number} was imported from WooCommerce '
                  f'and needs confirmation.'),
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, exclude_actor=False,
        )

    @classmethod
    def order_sent_to_pos(cls, order, actor=None):
        """A confirmed order was routed to a POS till for in-store pickup /
        validation. Notify the cashier(s) operating that specific till (the
        users pinned to its sales channel) so they pick it up in real time."""
        channel = getattr(order, 'pos_sales_channel', None)
        if channel is None:
            return
        User = get_user_model()
        recipients = list(
            User.objects.filter(is_active=True, assigned_sales_channel=channel)
        )
        if not recipients:
            return
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.NORMAL,
            recipients=recipients, target_type=TargetType.USER,
            title=f'Commande au point de vente · {order.order_number}',
            body=(f'La commande {order.order_number} attend la validation '
                  f'au point de vente {channel.name}.'),
            link_url='/dashboard/pos', entity_type='order',
            entity_id=order.id, created_by=actor, exclude_actor=True,
        )

    @classmethod
    def order_confirmed(cls, order, actor=None):
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.NORMAL, role_names=AUDIENCE_OPERATIONS,
            # Pure operational hand-off to packaging — the platform Super Admin
            # is an oversight account and should not receive routine progress
            # events. Management-targeted events still include them by default.
            include_platform_admins=False,
            title=f'Order confirmed · {order.order_number}',
            body=f'Order {order.order_number} is confirmed and ready for packaging.',
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor,
        )

    @classmethod
    def order_delayed(cls, order, actor=None):
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.LOW,
            role_names=AUDIENCE_MANAGEMENT + AUDIENCE_OPERATIONS,
            title=f'Order delayed · {order.order_number}',
            body=f'Order {order.order_number} was marked as delayed.',
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor,
        )

    @classmethod
    def order_not_answered(cls, order, actor=None, attempts=None):
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.HIGH,
            role_names=AUDIENCE_MANAGEMENT + AUDIENCE_OPERATIONS,
            title=f'Order unreachable · {order.order_number}',
            body=(f'Customer for order {order.order_number} did not answer after '
                  f'{attempts or "the maximum"} attempts.'),
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor,
            metadata={'attempts': attempts} if attempts is not None else None,
        )

    @classmethod
    def order_cancelled(cls, order, actor=None):
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.NORMAL, role_names=AUDIENCE_MANAGEMENT,
            title=f'Order cancelled · {order.order_number}',
            body=f'Order {order.order_number} was cancelled.',
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor,
        )

    @classmethod
    def order_done(cls, order, actor=None):
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.LOW, role_names=AUDIENCE_MANAGEMENT,
            title=f'Order completed · {order.order_number}',
            body=f'Order {order.order_number} reached its final state.',
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor,
        )

    @classmethod
    def order_manual_override(cls, order, actor=None):
        cls.notify(
            company=order.company_id, category=Category.ORDER,
            priority=Priority.HIGH, role_names=AUDIENCE_MANAGEMENT,
            title=f'Manual status override · {order.order_number}',
            body=(f'The status of order {order.order_number} was changed '
                  f'manually.'),
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor,
        )

    @classmethod
    def order_return_created(cls, order, actor=None, is_exchange=False):
        category = Category.EXCHANGE if is_exchange else Category.RETURN
        label = 'Exchange' if is_exchange else 'Return'
        cls.notify(
            company=order.company_id, category=category,
            priority=Priority.NORMAL,
            role_names=AUDIENCE_OPERATIONS + AUDIENCE_MANAGEMENT,
            title=f'{label} created · {order.order_number}',
            body=f'A {label.lower()} was recorded for order {order.order_number}.',
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor,
        )

    # ── WooCommerce sync ──────────────────────────────────────────────────────

    @classmethod
    def wc_sync_failed(cls, order, actor=None):
        cls.notify(
            company=order.company_id, category=Category.SYNC,
            priority=Priority.HIGH, role_names=AUDIENCE_MANAGEMENT,
            title=f'WooCommerce sync failed · {order.order_number}',
            body=(f'Syncing order {order.order_number} to WooCommerce failed. '
                  f'A manual retry may be required.'),
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor, exclude_actor=False,
        )

    @classmethod
    def wc_sync_recovered(cls, order, actor=None):
        cls.notify(
            company=order.company_id, category=Category.SYNC,
            priority=Priority.NORMAL, role_names=AUDIENCE_MANAGEMENT,
            title=f'WooCommerce sync recovered · {order.order_number}',
            body=f'Order {order.order_number} synced to WooCommerce successfully.',
            link_url='/dashboard/orders', entity_type='order',
            entity_id=order.id, created_by=actor, exclude_actor=False,
        )

    @classmethod
    def product_mapping_required(cls, company, *, title=None, body=None,
                                 entity_id='', actor=None):
        cls.notify(
            company=company, category=Category.SYNC, priority=Priority.HIGH,
            role_names=AUDIENCE_MANAGEMENT,
            title=title or 'Product mapping required',
            body=body or ('A WooCommerce product could not be matched to a local '
                          'product and needs manual mapping.'),
            link_url='/dashboard/products', entity_type='product',
            entity_id=entity_id, created_by=actor, exclude_actor=False,
        )

    # ── inventory ──────────────────────────────────────────────────────────────

    @classmethod
    def low_stock(cls, inventory, *, out_of_stock=False):
        company_id = inventory.sales_channel.brand.company_id
        product = inventory.product
        product_name = getattr(product, 'name', f'#{inventory.product_id}')
        channel_name = getattr(inventory.sales_channel, 'name', f'#{inventory.sales_channel_id}')
        if out_of_stock:
            priority, label = Priority.URGENT, 'out of stock'
        else:
            priority, label = Priority.HIGH, 'low on stock'
        cls.notify(
            company=company_id, category=Category.STOCK, priority=priority,
            role_names=AUDIENCE_MANAGEMENT,
            title=f'Product {label} · {product_name}',
            body=(f'{product_name} is {label} on {channel_name} '
                  f'(quantity: {inventory.quantity}).'),
            link_url='/dashboard/inventory', entity_type='inventory',
            entity_id=inventory.id, exclude_actor=False,
            metadata={
                'product_id': inventory.product_id,
                'sales_channel_id': inventory.sales_channel_id,
                'quantity': inventory.quantity,
            },
        )

    # ── system settings ──────────────────────────────────────────────────────

    @classmethod
    def settings_changed(cls, setting, actor=None):
        cls.notify(
            company=setting.company_id, category=Category.SYSTEM,
            priority=Priority.NORMAL, role_names=AUDIENCE_ADMIN,
            title='System settings updated',
            body='Order management system settings were changed.',
            link_url='/dashboard/settings', entity_type='setting',
            entity_id=setting.id, created_by=actor,
        )
