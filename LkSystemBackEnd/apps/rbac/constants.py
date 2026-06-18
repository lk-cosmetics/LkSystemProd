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
    ('assign_orders', 'Assign Orders', 'orders',
     'Manually assign or reassign orders to employees and configure the auto-assignment employee pool'),

    # Invoices
    ('view_invoices', 'View Invoices', 'invoices',
     'Access the generated invoice registry and invoice details'),
    ('edit_invoice_numbers', 'Edit Invoice Numbers', 'invoices',
     'Manually edit invoice numbers and advance the automatic sequence'),

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
            'manual_status_override', 'assign_orders',
            'view_invoices', 'edit_invoice_numbers',
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
            'manual_status_override', 'assign_orders',
            'use_pos',
            'view_clients', 'create_clients', 'edit_clients', 'delete_clients',
            'view_promotions', 'create_promotions', 'edit_promotions', 'delete_promotions',
            # Manager can manage staff incl. delete/deactivate. The UserViewSet
            # privilege guard still blocks deleting a more-privileged user
            # (the CEO or a platform Super Admin) — permission- AND privilege-
            # bounded, never a blanket grant.
            'view_users', 'create_users', 'edit_users', 'delete_users',
            'view_roles',
            # Company Manager has NO access to revenue / financial numbers:
            # no 'can_view_financial_reports' (gates the order /summary revenue
            # aggregates) and no 'view_bi_dashboard' (gates the BI dashboard).
            # Operational reporting only.
            'view_reports', 'export_data',
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
            # Brand Manager is brand-scoped: no access to the company-wide
            # Brands admin page (no 'view_brands'). They still operate within
            # their assigned brand(s) — e.g. creating sales channels — via the
            # brand-scoped APIs (BrandViewSet.get_queryset is IsAuthenticated
            # and filters to allowed_brands).
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
            'manual_status_override', 'assign_orders',
            'view_invoices', 'edit_invoice_numbers',
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
            # Employees can pull/sync WooCommerce orders themselves (the
            # "Sync WC" action on Order Management).
            'import_orders',
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


# ── Page access registry ─────────────────────────────────────────────────
# Maps each navigable application page to the permission that GATES it (the
# sidebar item and the route guard both key off ``view_codename``) and to the
# full set of codenames that belong to the page.
#
# This is the single source of truth for *page access* — exposed to the
# frontend at ``GET /api/v1/rbac/pages/`` and used by the Roles → Page Access
# manager. It introduces NO new permissions: a page is just a friendly grouping
# of codenames the system already enforces.
#
#   • Turning a page ON for a role grants its ``view_codename`` — read access,
#     so the page shows in the navigation and opens. Finer create/edit/delete
#     grants stay in the granular permission editor.
#   • Turning a page OFF strips EVERY codename in the page's bundle, so the
#     backend (which already enforces these codenames on every endpoint via
#     ``require_permission`` / ``ActionPermissionMixin``) denies the page's
#     whole API surface — not merely its list view.
#
# ``category`` pulls in every SEED_PERMISSIONS codename of that category so the
# bundle stays in sync automatically; ``codenames`` pins an explicit bundle
# (used where one category backs two pages, e.g. the dashboard category holds
# both ``view_dashboard`` and ``view_bi_dashboard``).

_PERMISSIONS_BY_CATEGORY: dict[str, list[str]] = {}
for _codename, _name, _category, _desc in SEED_PERMISSIONS:
    _PERMISSIONS_BY_CATEGORY.setdefault(_category, []).append(_codename)

_ALL_CODENAMES: frozenset[str] = frozenset(c for c, _, _, _ in SEED_PERMISSIONS)

SEED_PAGES: list[dict] = [
    {'key': 'dashboard', 'label': 'Dashboard', 'group': 'Overview',
     'icon': 'dashboard', 'view_codename': 'view_bi_dashboard',
     'codenames': ['view_bi_dashboard'],
     'description': 'Executive dashboard and business-intelligence charts.'},
    {'key': 'orders', 'label': 'Orders', 'group': 'Operations',
     'icon': 'orders', 'view_codename': 'view_orders', 'category': 'orders',
     'description': 'Order management, fulfilment workflow and the personal order queue.'},
    {'key': 'pos', 'label': 'Point of Sale', 'group': 'Operations',
     'icon': 'pos', 'view_codename': 'use_pos', 'category': 'pos',
     'description': 'In-store point of sale and cash register.'},
    {'key': 'clients', 'label': 'Clients', 'group': 'Operations',
     'icon': 'clients', 'view_codename': 'view_clients', 'category': 'clients',
     'description': 'Customer directory and loyalty.'},
    {'key': 'invoices', 'label': 'Invoices', 'group': 'Operations',
     'icon': 'invoices', 'view_codename': 'view_invoices', 'category': 'invoices',
     'description': 'Generated invoice registry and invoice numbering.'},
    {'key': 'products', 'label': 'Products', 'group': 'Catalogue',
     'icon': 'products', 'view_codename': 'view_products', 'category': 'products',
     'description': 'Product catalogue.'},
    {'key': 'categories', 'label': 'Categories', 'group': 'Catalogue',
     'icon': 'categories', 'view_codename': 'view_categories', 'category': 'categories',
     'description': 'Product categories and hierarchy.'},
    {'key': 'inventory', 'label': 'Inventory', 'group': 'Catalogue',
     'icon': 'inventory', 'view_codename': 'view_inventory', 'category': 'inventory',
     'description': 'Stock levels and inventory movements.'},
    {'key': 'manufacturing', 'label': 'Manufacturing', 'group': 'Catalogue',
     'icon': 'manufacturing', 'view_codename': 'view_manufacturing', 'category': 'manufacturing',
     'description': 'Bills of materials and production batches.'},
    {'key': 'promotions', 'label': 'Promotions', 'group': 'Catalogue',
     'icon': 'promotions', 'view_codename': 'view_promotions', 'category': 'promotions',
     'description': 'Promotions and discounts.'},
    {'key': 'sales_channels', 'label': 'Sales Channels', 'group': 'Administration',
     'icon': 'sales_channels', 'view_codename': 'view_sales_channels', 'category': 'sales_channels',
     'description': 'Sales channels and store configuration.'},
    {'key': 'brands', 'label': 'Brands', 'group': 'Administration',
     'icon': 'brands', 'view_codename': 'view_brands', 'category': 'brands',
     'description': 'Brand management and brand switching.'},
    {'key': 'companies', 'label': 'Companies', 'group': 'Administration',
     'icon': 'company', 'view_codename': 'view_company', 'category': 'company',
     'description': 'Company profile and tenant settings.'},
    {'key': 'users', 'label': 'Users', 'group': 'Administration',
     'icon': 'users', 'view_codename': 'view_users', 'category': 'users',
     'description': 'User accounts and invitations.'},
    {'key': 'roles', 'label': 'Roles & Permissions', 'group': 'Administration',
     'icon': 'roles', 'view_codename': 'view_roles', 'category': 'roles',
     'description': 'Roles, permissions and page access.'},
    {'key': 'settings', 'label': 'Settings', 'group': 'Administration',
     'icon': 'settings', 'view_codename': 'view_settings', 'category': 'settings',
     'description': 'Application settings and configuration.'},
]


def get_page_definitions() -> list[dict]:
    """Resolve ``SEED_PAGES`` into full page dicts with their codename bundles.

    A ``category`` page inherits every codename in that SEED_PERMISSIONS
    category; a ``codenames`` page uses its explicit list. The page's
    ``view_codename`` is always included in the bundle (first), so a freshly
    enabled page always carries read access.
    """
    pages: list[dict] = []
    for page in SEED_PAGES:
        if 'codenames' in page:
            codenames = list(page['codenames'])
        else:
            category = page.get('category', '')
            # Fail loud on a typo'd / missing category rather than silently
            # handing the page an empty bundle (which would make "disable page"
            # a no-op and leave the API reachable).
            if category not in _PERMISSIONS_BY_CATEGORY:
                raise ValueError(
                    f"SEED_PAGES entry '{page['key']}' references unknown permission "
                    f"category '{category}'. Fix the category or pin explicit 'codenames'."
                )
            codenames = list(_PERMISSIONS_BY_CATEGORY[category])
        view = page['view_codename']
        if view not in _ALL_CODENAMES:
            raise ValueError(
                f"SEED_PAGES entry '{page['key']}' has unknown view_codename '{view}'."
            )
        # Every codename in a page bundle must be a real, seeded permission.
        unknown = [c for c in codenames if c not in _ALL_CODENAMES]
        if unknown:
            raise ValueError(
                f"SEED_PAGES entry '{page['key']}' references unknown codenames: {unknown}."
            )
        if view in codenames:
            codenames = [view, *[c for c in codenames if c != view]]
        else:
            codenames = [view, *codenames]
        pages.append({
            'key': page['key'],
            'label': page['label'],
            'group': page['group'],
            'icon': page.get('icon', page['key']),
            'description': page.get('description', ''),
            'view_codename': view,
            'codenames': codenames,
        })
    return pages
