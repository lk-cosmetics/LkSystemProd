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
import { hasRole, hasAnyPermission, isPageHidden } from '@/hooks/useAuth';

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
    /** Page-registry key — hidden per role via Roles → Page Access. */
    page?: string;
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

  // Visibility is driven purely by RBAC permissions, so granting a role access
  // to a page (Roles → Page Access) always surfaces it here — for every role,
  // cashier accounts included. No workspace/role special-casing: a pure cashier
  // naturally sees only the pages their permissions allow (e.g. POS).
  const visibleItems = items.filter(item => {
    if (!user) return false;
    // Page hidden for this role (navigation control, independent of perms).
    if (isPageHidden(user, item.page)) return false;
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
