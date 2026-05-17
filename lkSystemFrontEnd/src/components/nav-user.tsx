import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { getMediaUrl } from '@/utils/helpers';
import { useAuthStore } from '@/store/authStore';

export function NavUser({
  user,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
}) {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const { logout, user: authUser } = useAuthStore();

  // Pick the most descriptive role the user holds. SuperAdmin / CEO are the
  // ones we want to call out explicitly; for everyone else we just take the
  // first role in their list (or fall back to ``user.role``).
  const roleLabel: string | null = (() => {
    const roles = authUser?.roles ?? [];
    if (roles.length === 0) return authUser?.role || null;
    const ranked = ['Super Admin', 'SuperAdmin', 'CEO', 'Admin'];
    for (const r of ranked) {
      const match = roles.find(x => x?.replace(/[\s_]/g, '').toLowerCase() === r.replace(/\s/g, '').toLowerCase());
      if (match) return match;
    }
    return roles[0] ?? null;
  })();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-full">
                <AvatarImage src={getMediaUrl(user.avatar) || ''} alt={user.name} />
                <AvatarFallback className="rounded-full">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {roleLabel ? (
                    <>
                      <span className="font-medium text-foreground/80">{roleLabel}</span>
                      <span className="opacity-60"> · {user.email}</span>
                    </>
                  ) : (
                    user.email
                  )}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-full">
                  <AvatarImage src={getMediaUrl(user.avatar) || ''} alt={user.name} />
                  <AvatarFallback className="rounded-full">CN</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                  {roleLabel ? (
                    <span className="truncate text-[11px] font-medium uppercase tracking-wide text-primary">
                      {roleLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => navigate('/dashboard/settings')}>
                <IconUserCircle />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <IconCreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate('/dashboard/notifications')}
              >
                <IconNotification />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
