"""
Seed data for the RBAC system.

SEED_PERMISSIONS — every granular business action in the system.
SYSTEM_ROLES     — default roles created on first deploy.
"""

# ── Granular permissions ────────────────────────────────────────────────
# (codename, human name, category, description)
SEED_PERMISSIONS: list[tuple[str, str, str, str]] = [
    # Dashboard
    ('view_dashboard', 'View Dashboard', 'dashboard',
     'Access the main dashboard and summary widgets'),
    ('view_bi_dashboard', 'View BI Dashboard', 'dashboard',
     'Access the executive Business Intelligence dashboard'),

    # Company
    ('view_company', 'View Company', 'company',
     'View company details'),
    ('create_company', 'Create Company', 'company',
     'Create new companies'),
    ('edit_company', 'Edit Company', 'company',
     'Update company details'),
    ('delete_company', 'Delete Company', 'company',
     'Delete companies'),

    # Brands
    ('view_brands', 'View Brands', 'brands',
     'View brand list and details'),
    ('create_brands', 'Create Brands', 'brands',
     'Create new brands'),
    ('edit_brands', 'Edit Brands', 'brands',
     'Update brand details'),
    ('delete_brands', 'Delete Brands', 'brands',
     'Delete brands'),
    ('switch_brands', 'Switch Brands', 'brands',
     'Switch between multiple brands in the UI'),

    # Sales Channels
    ('view_sales_channels', 'View Sales Channels', 'sales_channels',
     'View sales channel list and details'),
    ('create_sales_channels', 'Create Sales Channels', 'sales_channels',
     'Create new sales channels'),
    ('edit_sales_channels', 'Edit Sales Channels', 'sales_channels',
     'Update sales channel details'),
    ('delete_sales_channels', 'Delete Sales Channels', 'sales_channels',
     'Delete sales channels'),

    # Products
    ('view_products', 'View Products', 'products',
     'View product list and details'),
    ('create_products', 'Create Products', 'products',
     'Create new products'),
    ('edit_products', 'Edit Products', 'products',
     'Update product details'),
    ('delete_products', 'Delete Products', 'products',
     'Delete products'),

    # Categories
    ('view_categories', 'View Categories', 'categories',
     'View category list and hierarchy'),
    ('create_categories', 'Create Categories', 'categories',
     'Create new categories'),
    ('edit_categories', 'Edit Categories', 'categories',
     'Update category details'),
    ('delete_categories', 'Delete Categories', 'categories',
     'Delete categories'),

    # Inventory
    ('view_inventory', 'View Inventory', 'inventory',
     'View stock levels and movements'),
    ('create_inventory', 'Create Inventory', 'inventory',
     'Create stock entries and transfers'),
    ('edit_inventory', 'Edit Inventory', 'inventory',
     'Adjust stock levels and update movements'),
    ('delete_inventory', 'Delete Inventory', 'inventory',
     'Delete stock entries'),

    # Manufacturing (BOMs + production batches)
    ('view_manufacturing', 'View Manufacturing', 'manufacturing',
     'View bills of materials and production batches'),
    ('create_manufacturing', 'Create Manufacturing', 'manufacturing',
     'Create BOMs and start production batches'),
    ('edit_manufacturing', 'Edit Manufacturing', 'manufacturing',
     'Update BOMs and production batches'),
    ('delete_manufacturing', 'Delete Manufacturing', 'manufacturing',
     'Cancel batches or delete BOMs'),
    ('send_to_factory', 'Send to Factory', 'manufacturing',
     'Send components to the factory for production'),
    ('receive_from_factory', 'Receive from Factory', 'manufacturing',
     'Receive finished goods back from the factory'),

    # Orders
    ('view_orders', 'View Orders', 'orders',
     'View order list and details'),
    ('create_orders', 'Create Orders', 'orders',
     'Create new orders (POS, manual)'),
    ('edit_orders', 'Edit Orders', 'orders',
     'Update order status and details'),
    ('delete_orders', 'Delete Orders', 'orders',
     'Cancel or delete orders'),
    ('import_orders', 'Import Orders', 'orders',
     'Import and sync orders from WooCommerce'),
    ('update_unconfirmed_orders', 'Update Unconfirmed Orders', 'orders',
     'Edit orders before client confirmation'),
    ('update_confirmed_orders', 'Update Confirmed Orders', 'orders',
     'Edit orders after client confirmation'),
    ('confirm_orders', 'Confirm Orders', 'orders',
     'Confirm orders after calling the client'),
    ('delay_orders', 'Delay Orders', 'orders',
     'Postpone orders with a reason and follow-up date'),
    ('cancel_orders_lifecycle', 'Cancel Orders', 'orders',
     'Cancel orders through the lifecycle workflow'),
    ('send_to_pos_orders', 'Send Orders to POS', 'orders',
     'Mark pickup orders and expose them to POS'),
    ('validate_pos_orders', 'Validate POS Orders', 'orders',
     'Validate in-store pickup orders from POS'),
    ('send_to_delivery_orders', 'Send Orders to Delivery', 'orders',
     'Submit confirmed orders to the delivery provider'),
    ('view_delivery_tracking_orders', 'View Delivery Tracking', 'orders',
     'View or update delivery tracking state'),
    ('process_return_orders', 'Process Returned Orders', 'orders',
     'Mark delivered orders as returned'),
    ('restore_stock_from_return_orders', 'Restore Return Stock', 'orders',
     'Restore inventory for returned orders'),
    ('soft_delete_orders', 'Soft Delete Orders', 'orders',
     'Soft delete orders without physically removing audit data'),
    ('view_soft_deleted_orders', 'View Deleted Orders', 'orders',
     'View soft-deleted orders'),
    ('restore_soft_deleted_orders', 'Restore Deleted Orders', 'orders',
     'Restore soft-deleted orders'),
    ('manual_status_override', 'Manual Status Override', 'orders',
     'Manually roll an order back to an earlier status (admin/manager only, reason required)'),

    # POS
    ('use_pos', 'Use POS', 'pos',
     'Access the Point of Sale interface'),

    # Clients
    ('view_clients', 'View Clients', 'clients',
     'View client list and details'),
    ('create_clients', 'Create Clients', 'clients',
     'Create new clients'),
    ('edit_clients', 'Edit Clients', 'clients',
     'Update client details'),
    ('delete_clients', 'Delete Clients', 'clients',
     'Delete clients'),

    # Promotions
    ('view_promotions', 'View Promotions', 'promotions',
     'View promotions list and details'),
    ('create_promotions', 'Create Promotions', 'promotions',
     'Create new promotions'),
    ('edit_promotions', 'Edit Promotions', 'promotions',
     'Update promotion details'),
    ('delete_promotions', 'Delete Promotions', 'promotions',
     'Delete promotions'),

    # Users
    ('view_users', 'View Users', 'users',
     'View user list and profiles'),
    ('create_users', 'Create Users', 'users',
     'Create new users'),
    ('edit_users', 'Edit Users', 'users',
     'Update user profiles and reset passwords'),
    ('delete_users', 'Delete Users', 'users',
     'Deactivate or delete users'),

    # Roles & Permissions
    ('view_roles', 'View Roles', 'roles',
     'View roles and their permissions'),
    ('create_roles', 'Create Roles', 'roles',
     'Create new roles'),
    ('edit_roles', 'Edit Roles', 'roles',
     'Update roles and assign permissions'),
    ('delete_roles', 'Delete Roles', 'roles',
     'Delete roles'),

    # Reports
    ('view_reports', 'View Reports', 'reports',
     'View reports and analytics dashboards'),
    ('export_data', 'Export Data', 'reports',
     'Export data to CSV / Excel'),

    # Settings
    ('view_settings', 'View Settings', 'settings',
     'View application settings'),
    ('edit_settings', 'Edit Settings', 'settings',
     'Modify application settings and configuration'),

    # Sensitive / cross-cutting capabilities (separately protected)
    ('can_view_financial_reports', 'View Financial Reports', 'reports',
     'View revenue, margins and other sensitive financial numbers'),
    ('can_invite_users', 'Invite Users', 'users',
     'Send e-mail invitations to onboard new users'),
    ('can_assign_roles', 'Assign Roles', 'roles',
     'Assign or revoke roles for other users'),
]

# Legacy codename → new codenames mapping (for migration)
LEGACY_PERMISSION_MAP: dict[str, list[str]] = {
    'manage_company': ['create_company', 'edit_company', 'delete_company'],
    'manage_brands': ['create_brands', 'edit_brands', 'delete_brands'],
    'manage_sales_channels': ['create_sales_channels', 'edit_sales_channels', 'delete_sales_channels'],
    'manage_products': ['create_products', 'edit_products', 'delete_products'],
    'manage_categories': ['create_categories', 'edit_categories', 'delete_categories'],
    'manage_inventory': ['create_inventory', 'edit_inventory', 'delete_inventory'],
    'manage_clients': ['create_clients', 'edit_clients', 'delete_clients'],
    'manage_promotions': ['create_promotions', 'edit_promotions', 'delete_promotions'],
    'manage_users': ['create_users', 'edit_users', 'delete_users'],
    'manage_roles': ['create_roles', 'edit_roles', 'delete_roles'],
    'manage_settings': ['view_settings', 'edit_settings'],
    # Orders had mixed naming — normalize
    'create_order': ['create_orders'],
    'update_orders': ['edit_orders'],
    'cancel_orders': ['delete_orders'],
}

# ── System roles ────────────────────────────────────────────────────────
# scope_type: platform / company / brand / channel
# permissions: list of codenames or '__all__' for every permission
#
# Six business roles (see ``RBAC_ROLE_MATRIX.md`` / report chapter 5):
#   1. Super Admin            — platform, full access
#   2. CEO / Company Manager  — company, full access incl. financial numbers
#   3. Manager                — company, broad incl. financial reports, no settings
#   4. Brand Manager          — brand, full control of one brand
#   5. Employee               — operational online-order processing only
#   6. Cashier                — POS / cashier interface only
SYSTEM_ROLES: dict[str, dict] = {
    'Super Admin': {
        'description': 'Full platform access. Can manage all companies, brands, and system settings.',
        'scope_type': 'platform',
        'permissions': '__all__',
    },
    'CEO': {
        'description': (
            'Company Manager / CEO. Full access within a single company, '
            'including financial numbers, user invitations and role assignment.'
        ),
        'scope_type': 'company',
        'permissions': [
            'view_dashboard',
            'view_bi_dashboard',
            # NOTE: create_company / delete_company are platform-only (creating
            # or deleting a tenant). A CEO manages their OWN company settings
            # via view_company + edit_company, but cannot create or delete
            # companies.
            'view_company', 'edit_company',
            'view_brands', 'create_brands', 'edit_brands', 'delete_brands', 'switch_brands',
            'view_sales_channels', 'create_sales_channels', 'edit_sales_channels', 'delete_sales_channels',
            'view_products', 'create_products', 'edit_products', 'delete_products',
            'view_categories', 'create_categories', 'edit_categories', 'delete_categories',
            'view_inventory', 'create_inventory', 'edit_inventory', 'delete_inventory',
            'view_manufacturing', 'create_manufacturing', 'edit_manufacturing',
            'delete_manufacturing', 'send_to_factory', 'receive_from_factory',
            'view_orders', 'create_orders', 'edit_orders', 'delete_orders',
            'import_orders', 'update_unconfirmed_orders', 'update_confirmed_orders',
            'confirm_orders', 'delay_orders', 'cancel_orders_lifecycle',
            'send_to_pos_orders', 'validate_pos_orders', 'send_to_delivery_orders',
            'view_delivery_tracking_orders', 'process_return_orders',
            'restore_stock_from_return_orders', 'soft_delete_orders',
            'view_soft_deleted_orders', 'restore_soft_deleted_orders',
            'manual_status_override',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients', 'delete_clients',
            'view_promotions', 'create_promotions', 'edit_promotions', 'delete_promotions',
            'view_users', 'create_users', 'edit_users', 'delete_users',
            'view_roles', 'create_roles', 'edit_roles', 'delete_roles',
            'view_reports', 'export_data', 'can_view_financial_reports',
            'view_settings', 'edit_settings',
            'can_invite_users', 'can_assign_roles',
        ],
    },
    'Manager': {
        'description': (
            'Company-level manager. Broad operational control similar to the '
            'CEO, including financial reports, but without company settings. '
            'Can invite employees and assign allowed roles within the company.'
        ),
        'scope_type': 'company',
        'permissions': [
            'view_dashboard',
            'view_company',
            'view_brands', 'create_brands', 'edit_brands', 'switch_brands',
            'view_sales_channels', 'create_sales_channels', 'edit_sales_channels', 'delete_sales_channels',
            'view_products', 'create_products', 'edit_products', 'delete_products',
            'view_categories', 'create_categories', 'edit_categories', 'delete_categories',
            'view_inventory', 'create_inventory', 'edit_inventory', 'delete_inventory',
            'view_manufacturing', 'create_manufacturing', 'edit_manufacturing',
            'send_to_factory', 'receive_from_factory',
            'view_orders', 'create_orders', 'edit_orders',
            'import_orders', 'update_unconfirmed_orders', 'update_confirmed_orders',
            'confirm_orders', 'delay_orders', 'cancel_orders_lifecycle',
            'send_to_pos_orders', 'validate_pos_orders', 'send_to_delivery_orders',
            'view_delivery_tracking_orders', 'process_return_orders',
            'restore_stock_from_return_orders', 'soft_delete_orders',
            'view_soft_deleted_orders', 'restore_soft_deleted_orders',
            'manual_status_override',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients', 'delete_clients',
            'view_promotions', 'create_promotions', 'edit_promotions', 'delete_promotions',
            'view_users', 'create_users', 'edit_users',
            'view_roles',
            'view_reports', 'export_data', 'can_view_financial_reports',
            'can_invite_users', 'can_assign_roles',
        ],
    },
    'Brand Manager': {
        'description': (
            'Full control of one or more assigned brands: stock, orders, '
            'cashiers, employees, sales channels, promotions and brand '
            'reports. No company-wide settings or financial numbers.'
        ),
        'scope_type': 'brand',
        'permissions': [
            'view_dashboard',
            'view_brands',
            'view_sales_channels', 'create_sales_channels', 'edit_sales_channels', 'delete_sales_channels',
            'view_products', 'create_products', 'edit_products', 'delete_products',
            'view_categories', 'create_categories', 'edit_categories',
            'view_inventory', 'create_inventory', 'edit_inventory', 'delete_inventory',
            'view_manufacturing', 'create_manufacturing', 'edit_manufacturing',
            'send_to_factory', 'receive_from_factory',
            'view_orders', 'create_orders', 'edit_orders',
            'import_orders', 'update_unconfirmed_orders', 'update_confirmed_orders',
            'confirm_orders', 'delay_orders', 'cancel_orders_lifecycle',
            'send_to_pos_orders', 'validate_pos_orders', 'send_to_delivery_orders',
            'view_delivery_tracking_orders', 'process_return_orders',
            'restore_stock_from_return_orders', 'soft_delete_orders',
            'view_soft_deleted_orders', 'restore_soft_deleted_orders',
            'manual_status_override',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients', 'delete_clients',
            'view_promotions', 'create_promotions', 'edit_promotions', 'delete_promotions',
            'view_users', 'create_users', 'edit_users',
            'view_roles',
            'view_reports', 'export_data',
            'can_invite_users', 'can_assign_roles',
        ],
    },
    'Employee': {
        'description': (
            'Operational role for online-order processing. Views and advances '
            'orders (confirm, change status, send to delivery, returns). No '
            'access to users, roles, settings, stock or financial reports.'
        ),
        'scope_type': 'company',
        'permissions': [
            'view_dashboard',
            'view_products',
            'view_orders',
            'update_unconfirmed_orders', 'update_confirmed_orders',
            'confirm_orders', 'delay_orders', 'cancel_orders_lifecycle',
            'send_to_pos_orders', 'send_to_delivery_orders',
            'view_delivery_tracking_orders', 'process_return_orders',
            'restore_stock_from_return_orders',
            'view_clients',
            'view_promotions',
        ],
    },
    'Cashier': {
        'description': (
            'POS / cashier operator. Creates and manages sales from the '
            'cashier interface and sees the daily closing summary. No access '
            'to admin pages, settings, users, roles or global reports.'
        ),
        'scope_type': 'channel',
        'permissions': [
            'view_products',
            'view_orders', 'create_orders',
            'update_unconfirmed_orders', 'confirm_orders', 'delay_orders',
            'cancel_orders_lifecycle', 'send_to_pos_orders', 'validate_pos_orders',
            'process_return_orders', 'restore_stock_from_return_orders',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients',
            'view_promotions',
        ],
    },
}

# ── Legacy role realignment (used by the data migration) ─────────────────
# Old seeded roles that are retired in favour of the six-role model.
# Existing UserRole assignments are remapped to the target role, then the
# old system role is deleted. ``Viewer`` is not remapped: it is demoted to a
# non-system, read-only custom role so existing read-only users keep working.
LEGACY_ROLE_REMAP: dict[str, str] = {
    'Stock Keeper': 'Brand Manager',
    'Sales Rep': 'Employee',
}
LEGACY_ROLE_DEMOTE: list[str] = ['Viewer']
