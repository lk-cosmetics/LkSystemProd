'use client';

import * as React from 'react';
import { Link } from 'react-router-dom';
import { type Icon } from '@tabler/icons-react';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAuthStore } from '@/store/authStore';
import { hasAnyPermission, isPosOnlyUser, isPageHidden } from '@/hooks/useAuth';

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string;
    url: string;
    icon: Icon;
    requiredPermissions?: string[];
    /** Item is visible to a cashier-only workspace (POS-only sidebar). */
    cashierVisible?: boolean;
    /** Item is shown *exclusively* when the user is a cashier-only workspace. */
    cashierOnly?: boolean;
    /** Page-registry key — hidden per role via Roles → Page Access. */
    page?: string;
  }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { user } = useAuthStore();

  const isRoutable = (url: string) => url.trim() !== '' && url !== '#';

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const visibleItems = items.filter(item => {
    if (!user) return false;
    // The cashier-only alias (e.g. "Account") is shown exclusively to a
    // POS-only account; everything else is permission-driven so granted pages
    // always surface.
    if (item.cashierOnly && !isPosOnlyUser(user)) return false;
    // Page hidden for this role (navigation control, independent of perms).
    if (isPageHidden(user, item.page)) return false;
    if (item.requiredPermissions?.length) {
      return hasAnyPermission(user, item.requiredPermissions);
    }
    return true;
  });

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {visibleItems.map(item => (
            <SidebarMenuItem key={item.title}>
              {isRoutable(item.url) ? (
                <SidebarMenuButton asChild>
                  <Link to={item.url} onClick={handleNavClick}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  disabled
                  aria-disabled="true"
                  className="cursor-not-allowed opacity-60"
                  tooltip={`${item.title} (Coming soon)`}
                >
                  <item.icon />
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
