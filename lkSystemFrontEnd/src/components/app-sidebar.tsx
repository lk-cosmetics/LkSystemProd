import * as React from 'react';
import {
  IconDashboard,
  IconHelp,
  IconSearch,
  IconSettings,
  IconUsers,
  IconBuilding,
  IconTag,
  IconShoppingCart,
  IconShield,
  IconPackage,
  IconCategory,
  IconDiscount,
  IconBoxSeam,
  IconReceipt,
  IconUsersGroup,
  IconCash,
  IconBuildingFactory,
  IconUserCircle,
} from '@tabler/icons-react';
import { NavMain } from '@/components/nav-main';
import { NavSecondary } from '@/components/nav-secondary';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@/components/ui/sidebar';
import { useAuthStore } from '@/store/authStore';
import { userService } from '@/services/user.service';
import { getMediaUrl } from '@/utils/helpers';

// Static navigation data (doesn't depend on user state)
const navMain = [
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: IconDashboard,
    requiredPermissions: ['view_bi_dashboard'],
  },
  {
    title: 'Users',
    url: '/dashboard/users',
    icon: IconUsers,
    requiredPermissions: ['view_users'],
  },
  {
    title: 'Roles',
    url: '/dashboard/roles',
    icon: IconShield,
    requiredPermissions: ['view_roles'],
  },
  {
    title: 'Companies',
    url: '/dashboard/companies',
    icon: IconBuilding,
    requiredPermissions: ['view_company'],
  },
  {
    title: 'Brands',
    url: '/dashboard/brands',
    icon: IconTag,
    requiredPermissions: ['view_brands'],
  },
  {
    title: 'Sales Channels',
    url: '/dashboard/sales-channels',
    icon: IconShoppingCart,
    requiredPermissions: ['view_sales_channels'],
  },
  {
    title: 'Products',
    url: '/dashboard/products',
    icon: IconPackage,
    requiredPermissions: ['view_products'],
  },
  {
    title: 'Inventory',
    url: '/dashboard/inventory',
    icon: IconBoxSeam,
    requiredPermissions: ['view_inventory'],
  },
  {
    title: 'Manufacturing',
    url: '/dashboard/manufacturing',
    icon: IconBuildingFactory,
    // Tied to the dedicated ``view_manufacturing`` permission so the
    // sidebar entry follows the same RBAC gate as the route guard.
    // CEO / Manager / Stock Keeper get it via the seeded SYSTEM_ROLES;
    // any custom role with view_manufacturing also sees it.
    requiredPermissions: ['view_manufacturing'],
  },
  {
    title: 'Categories',
    url: '/dashboard/categories',
    icon: IconCategory,
    requiredPermissions: ['view_categories'],
  },
  {
    title: 'Promotions',
    url: '/dashboard/promotions',
    icon: IconDiscount,
    requiredPermissions: ['view_promotions'],
  },
  {
    title: 'Orders',
    url: '/dashboard/orders',
    icon: IconReceipt,
    requiredPermissions: ['view_orders'],
  },
  {
    title: 'Clients',
    url: '/dashboard/clients',
    icon: IconUsersGroup,
    requiredPermissions: ['view_clients'],
  },
  {
    title: 'POS',
    url: '/dashboard/pos',
    icon: IconCash,
    requiredPermissions: ['use_pos'],
    cashierVisible: true,
  },
];

const navSecondary = [
  {
    title: 'Settings',
    url: '/dashboard/settings',
    icon: IconSettings,
    requiredPermissions: ['view_settings'],
  },
  {
    // Cashier-only alias — same target page, friendlier label, only shown
    // when the user is in the cashier workspace.
    title: 'Account',
    url: '/dashboard/settings',
    icon: IconUserCircle,
    cashierVisible: true,
    cashierOnly: true,
  },
  {
    title: 'Get Help',
    url: '#',
    icon: IconHelp,
  },
  {
    title: 'Search',
    url: '#',
    icon: IconSearch,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user: currentUser } = useAuthStore();
  // Empty by default so NavUser falls back to the user's initials when there is
  // no real profile picture (instead of showing a placeholder face).
  const [avatarPath, setAvatarPath] = React.useState<string>('');

  React.useEffect(() => {
    userService.getCurrentUser().then(details => {
      if (details.profile?.avatar) {
        setAvatarPath(details.profile.avatar);
      }
    }).catch(() => { /* keep default avatar on error */ });
  }, []);

  const userData = React.useMemo(
    () => ({
      name: currentUser?.full_name || 'User',
      email: currentUser?.email || 'No Email',
      avatar: avatarPath,
    }),
    [currentUser?.full_name, currentUser?.email, avatarPath]
  );

  // Current company's own logo; falls back to the default app logo. object-contain
  // + max constraints let any logo (square or wide) auto-fit the header neatly.
  const companyLogo =
    (currentUser?.company_logo && getMediaUrl(currentUser.company_logo)) || '/logo.svg';

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="flex items-center justify-center p-3">
        <img
          src={companyLogo}
          alt={currentUser?.company_name || 'Company logo'}
          className="max-h-20 max-w-full object-contain"
          onError={e => {
            const img = e.currentTarget as HTMLImageElement;
            if (!img.src.endsWith('/logo.svg')) img.src = '/logo.svg';
          }}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={userData} />
      </SidebarFooter>
    </Sidebar>
  );
}
