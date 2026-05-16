from django.db import migrations


ORDER_PERMISSIONS = [
    ('import_orders', 'Import Orders', 'orders', 'Import and sync orders from WooCommerce'),
    ('update_unconfirmed_orders', 'Update Unconfirmed Orders', 'orders', 'Edit orders before client confirmation'),
    ('update_confirmed_orders', 'Update Confirmed Orders', 'orders', 'Edit orders after client confirmation'),
    ('confirm_orders', 'Confirm Orders', 'orders', 'Confirm orders after calling the client'),
    ('delay_orders', 'Delay Orders', 'orders', 'Postpone orders with a reason and follow-up date'),
    ('cancel_orders_lifecycle', 'Cancel Orders', 'orders', 'Cancel orders through the lifecycle workflow'),
    ('send_to_pos_orders', 'Send Orders to POS', 'orders', 'Mark pickup orders and expose them to POS'),
    ('validate_pos_orders', 'Validate POS Orders', 'orders', 'Validate in-store pickup orders from POS'),
    ('send_to_delivery_orders', 'Send Orders to Delivery', 'orders', 'Submit confirmed orders to the delivery provider'),
    ('view_delivery_tracking_orders', 'View Delivery Tracking', 'orders', 'View or update delivery tracking state'),
    ('process_return_orders', 'Process Returned Orders', 'orders', 'Mark delivered orders as returned'),
    ('restore_stock_from_return_orders', 'Restore Return Stock', 'orders', 'Restore inventory for returned orders'),
    ('soft_delete_orders', 'Soft Delete Orders', 'orders', 'Soft delete orders without physically removing audit data'),
    ('view_soft_deleted_orders', 'View Deleted Orders', 'orders', 'View soft-deleted orders'),
    ('restore_soft_deleted_orders', 'Restore Deleted Orders', 'orders', 'Restore soft-deleted orders'),
]

EDIT_EXPANSION = [
    'import_orders',
    'update_unconfirmed_orders',
    'update_confirmed_orders',
    'confirm_orders',
    'delay_orders',
    'cancel_orders_lifecycle',
    'send_to_pos_orders',
    'validate_pos_orders',
    'send_to_delivery_orders',
    'view_delivery_tracking_orders',
    'process_return_orders',
    'restore_stock_from_return_orders',
]

DELETE_EXPANSION = [
    'soft_delete_orders',
    'view_soft_deleted_orders',
    'restore_soft_deleted_orders',
]


def seed_order_lifecycle_permissions(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    Role = apps.get_model('rbac', 'Role')

    permission_by_code = {}
    for codename, name, category, description in ORDER_PERMISSIONS:
        permission, _ = AppPermission.objects.update_or_create(
            codename=codename,
            defaults={
                'name': name,
                'category': category,
                'description': description,
            },
        )
        permission_by_code[codename] = permission

    for role in Role.objects.prefetch_related('permissions'):
        existing = set(role.permissions.values_list('codename', flat=True))
        codenames = set()
        if 'view_orders' in existing:
            codenames.update(['view_delivery_tracking_orders'])
        if 'edit_orders' in existing:
            codenames.update(EDIT_EXPANSION)
        if 'delete_orders' in existing:
            codenames.update(DELETE_EXPANSION)
        if codenames:
            role.permissions.add(*(permission_by_code[code] for code in codenames))


def unseed_order_lifecycle_permissions(apps, schema_editor):
    AppPermission = apps.get_model('rbac', 'AppPermission')
    AppPermission.objects.filter(codename__in=[code for code, *_ in ORDER_PERMISSIONS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_order_lifecycle_permissions, unseed_order_lifecycle_permissions),
    ]
