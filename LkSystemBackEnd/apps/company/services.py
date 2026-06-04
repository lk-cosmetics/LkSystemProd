"""Company lifecycle services."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction

from apps.company.models import Company


class CompanyDeletionError(Exception):
    """Raised when a company cannot be deleted (e.g. permission)."""


class CompanyDeletionService:
    """Hard-delete a company and EVERY piece of data that belongs to it.

    This is a full tenant wipe and is **irreversible**. It is restricted to
    platform admins (the viewset gates ``destroy`` on ``_IsPlatformAdmin``; this
    service re-checks as defence in depth).

    Most relations to ``Company`` / ``Brand`` cascade automatically, but a few
    are ``PROTECT`` (orders → brand/sales_channel, users → current_company) and
    a few are ``SET_NULL`` (products → brand), which would otherwise *orphan*
    rows instead of deleting them. So we explicitly remove those first, in
    dependency order, then let ``company.delete()`` cascade the remainder.

    Everything runs in a single transaction: if anything still blocks the
    delete, the whole operation rolls back (no half-deleted tenant) and the
    ``ProtectedError`` surfaces as a clean 409 via the global exception handler.

    Platform-admin / superuser accounts that happen to point at this company are
    *unlinked* rather than deleted, so the operator running the wipe — and any
    cross-tenant admin — always survives.
    """

    @classmethod
    @transaction.atomic
    def delete(cls, company: Company, *, actor=None) -> int:
        from apps.inventory.models import InventoryMovement, SalesChannelInventory
        from apps.orders.models import Order
        from apps.products.models import Product
        from apps.rbac.models import UserRole
        from apps.sales_channels.models import SalesChannel

        if actor is not None:
            from apps.rbac.services import PermissionService
            if not PermissionService.is_platform_admin(actor):
                raise CompanyDeletionError(
                    'Only platform admins can delete a company.'
                )

        User = get_user_model()
        company_id = company.id

        # 1. Orders carry PROTECT FKs to brand / sales_channel / pos_sales_channel.
        #    Order.company is CASCADE, so filtering by company captures the whole
        #    tenant's orders (incl. soft-deleted via all_objects). Deleting them
        #    cascades their lines and logs and clears those PROTECT references.
        order_manager = getattr(Order, 'all_objects', Order.objects)
        order_manager.filter(company=company).delete()

        # 2. Stock data on the tenant's channels (inventory rows + the movement
        #    ledger). Cleared before products/channels so neither blocks.
        channel_ids = list(
            SalesChannel.objects.filter(brand__company=company).values_list('id', flat=True)
        )
        if channel_ids:
            InventoryMovement.objects.filter(sales_channel_id__in=channel_ids).delete()
            SalesChannelInventory.objects.filter(sales_channel_id__in=channel_ids).delete()

        # 3. Products link to brand via SET_NULL, so company.delete() would leave
        #    them orphaned. Delete the tenant's products (their remaining stock /
        #    movements anywhere are removed first so nothing PROTECTs them).
        product_ids = list(
            Product.objects.filter(brand__company=company).values_list('id', flat=True)
        )
        if product_ids:
            InventoryMovement.objects.filter(product_id__in=product_ids).delete()
            SalesChannelInventory.objects.filter(product_id__in=product_ids).delete()
            Product.objects.filter(id__in=product_ids).delete()

        # 4. Employees (User.current_company is PROTECT). Delete regular staff;
        #    unlink platform admins / superusers so the operator is never deleted.
        employees = User.objects.filter(current_company=company)
        keep_ids = set(
            employees.filter(is_superuser=True).values_list('id', flat=True)
        ) | set(
            UserRole.objects.filter(
                user__in=employees, role__scope_type='platform',
            ).values_list('user_id', flat=True)
        )
        employees.filter(id__in=keep_ids).update(
            current_company=None, current_brand=None, assigned_sales_channel=None,
        )
        employees.exclude(id__in=keep_ids).delete()

        # 5. The rest cascades on company.delete(): brands → sales channels →
        #    categories / promotions / expenses, plus clients, RBAC roles &
        #    assignments, notifications, BI rows and the system settings row.
        company.delete()
        return company_id
