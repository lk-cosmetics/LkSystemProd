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
SYSTEM_ROLES: dict[str, dict] = {
    'Super Admin': {
        'description': 'Full platform access. Can manage all companies, brands, and system settings.',
        'scope_type': 'platform',
        'permissions': '__all__',
    },
    'CEO': {
        'description': 'Full access within a company. Can manage all brands, users, and operations.',
        'scope_type': 'company',
        'permissions': [
            'view_dashboard',
            'view_bi_dashboard',
            'view_company', 'create_company', 'edit_company', 'delete_company',
            'view_brands', 'create_brands', 'edit_brands', 'delete_brands', 'switch_brands',
            'view_sales_channels', 'create_sales_channels', 'edit_sales_channels', 'delete_sales_channels',
            'view_products', 'create_products', 'edit_products', 'delete_products',
            'view_categories', 'create_categories', 'edit_categories', 'delete_categories',
            'view_inventory', 'create_inventory', 'edit_inventory', 'delete_inventory',
            'view_orders', 'create_orders', 'edit_orders', 'delete_orders',
            'import_orders', 'update_unconfirmed_orders', 'update_confirmed_orders',
            'confirm_orders', 'delay_orders', 'cancel_orders_lifecycle',
            'send_to_pos_orders', 'validate_pos_orders', 'send_to_delivery_orders',
            'view_delivery_tracking_orders', 'process_return_orders',
            'restore_stock_from_return_orders', 'soft_delete_orders',
            'view_soft_deleted_orders', 'restore_soft_deleted_orders',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients', 'delete_clients',
            'view_promotions', 'create_promotions', 'edit_promotions', 'delete_promotions',
            'view_users', 'create_users', 'edit_users', 'delete_users',
            'view_roles', 'create_roles', 'edit_roles', 'delete_roles',
            'view_reports', 'export_data',
            'view_settings', 'edit_settings',
        ],
    },
    'Manager': {
        'description': 'Manages operations within assigned brands.',
        'scope_type': 'brand',
        'permissions': [
            'view_dashboard',
            'view_brands', 'view_sales_channels',
            'view_products', 'create_products', 'edit_products',
            'view_categories', 'create_categories', 'edit_categories',
            'view_inventory', 'create_inventory', 'edit_inventory',
            'view_orders', 'create_orders', 'edit_orders',
            'import_orders', 'update_unconfirmed_orders', 'update_confirmed_orders',
            'confirm_orders', 'delay_orders', 'cancel_orders_lifecycle',
            'send_to_pos_orders', 'validate_pos_orders', 'send_to_delivery_orders',
            'view_delivery_tracking_orders', 'process_return_orders',
            'restore_stock_from_return_orders', 'soft_delete_orders',
            'view_soft_deleted_orders', 'restore_soft_deleted_orders',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients',
            'view_promotions', 'create_promotions', 'edit_promotions',
            'view_users',
            'view_roles',
            'view_reports', 'export_data',
        ],
    },
    'Cashier': {
        'description': 'POS operator with order creation rights.',
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
    'Stock Keeper': {
        'description': 'Manages inventory and stock movements.',
        'scope_type': 'brand',
        'permissions': [
            'view_dashboard',
            'view_products',
            'view_inventory', 'create_inventory', 'edit_inventory',
            'view_orders',
            'view_delivery_tracking_orders',
        ],
    },
    'Sales Rep': {
        'description': 'Handles sales and client interactions.',
        'scope_type': 'channel',
        'permissions': [
            'view_dashboard',
            'view_products',
            'view_orders', 'create_orders',
            'update_unconfirmed_orders', 'confirm_orders', 'delay_orders',
            'cancel_orders_lifecycle', 'send_to_pos_orders', 'validate_pos_orders',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients',
            'view_promotions',
        ],
    },
    'Viewer': {
        'description': 'Read-only access across the company.',
        'scope_type': 'company',
        'permissions': [
            'view_dashboard', 'view_company',
            'view_brands', 'view_sales_channels',
            'view_products', 'view_categories',
            'view_inventory',
            'view_orders',
            'view_clients',
            'view_promotions',
            'view_users', 'view_roles',
            'view_reports',
            'view_settings',
        ],
    },
}
