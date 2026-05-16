import { IconCirclePlusFilled, IconMail, type Icon } from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAuthStore } from '@/store/authStore';
import { hasRole, hasAnyPermission } from '@/hooks/useAuth';

export function NavMain({
  items,
}: {
  readonly items: readonly {
    title: string;
    url: string;
    icon?: Icon;
    /** Legacy role check (backward compat). */
    requiredRole?: string;
    /** RBAC: show item if user has ANY of these permissions. */
    requiredPermissions?: string[];
    /** Cashier workspace is intentionally tiny: POS only. */
    cashierVisible?: boolean;
  }[];
}) {
  const location = useLocation();
  const { user } = useAuthStore();
  const { isMobile, setOpenMobile } = useSidebar();

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const isRoutable = (url: string) => url.trim() !== '' && url !== '#';

  // Filter items based on RBAC permissions or legacy role
  const visibleItems = items.filter(item => {
    if (!user) return false;
    const cashierWorkspace =
      hasRole(user, 'Cashier') &&
      !hasRole(user, 'SuperAdmin') &&
      !hasRole(user, 'Admin') &&
      !hasRole(user, 'Manager') &&
      !hasRole(user, 'CEO');
    if (cashierWorkspace && !item.cashierVisible) return false;
    // RBAC permission check (preferred)
    if (item.requiredPermissions?.length) {
      return hasAnyPermission(user, item.requiredPermissions);
    }
    // Legacy role check
    if (item.requiredRole) {
      return hasRole(user, item.requiredRole);
    }
    // No guard → visible to all authenticated users
    return true;
  });

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        {user && hasAnyPermission(user, ['create_users']) && (
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2">
              <SidebarMenuButton
                tooltip="Quick Create"
                className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
                asChild
              >
                <Link to="/dashboard/add-user" onClick={handleNavClick}>
                  <IconCirclePlusFilled />
                  <span>Quick Create</span>
                </Link>
              </SidebarMenuButton>
              <Button
                size="icon"
                className="size-8 group-data-[collapsible=icon]:opacity-0"
                variant="outline"
              >
                <IconMail />
                <span className="sr-only">Inbox</span>
              </Button>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <SidebarMenu>
          {visibleItems.map(item => (
            <SidebarMenuItem key={item.title}>
              {isRoutable(item.url) ? (
                <SidebarMenuButton
                  tooltip={item.title}
                  asChild
                  isActive={location.pathname === item.url}
                >
                  <Link to={item.url} onClick={handleNavClick}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  tooltip={`${item.title} (Coming soon)`}
                  disabled
                  aria-disabled="true"
                  className="cursor-not-allowed opacity-60"
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
