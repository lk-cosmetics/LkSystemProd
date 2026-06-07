import { useState } from 'react';
import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
  IconBuildingStore,
  IconCheck,
  IconSwitchHorizontal,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { hasPermission, isPlatformAdmin } from '@/hooks/useAuth';
import {
  workspaceService,
  type Workspace,
} from '@/services/workspace.service';

/** Two-letter initials from a display name, e.g. "Saker Hajji" → "SH". */
const getInitials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || 'U';

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
  const queryClient = useQueryClient();
  const { logout, user: authUser, switchWorkspace } = useAuthStore();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loadingWs, setLoadingWs] = useState(false);
  const [switching, setSwitching] = useState(false);

  const activeCompanyId = authUser?.company_id ?? null;
  const activeBrandId = authUser?.current_brand_id ?? null;
  const activeCompanyName = authUser?.company_name ?? null;
  // Workspace switching is permission-based, not role-name based: only a
  // platform admin or a user holding switch_brands (CEO / Company Manager) may
  // switch. Employees, Cashiers and any single-workspace role never see it.
  const canSwitch = isPlatformAdmin(authUser) || hasPermission(authUser, 'switch_brands');

  // Pick the most descriptive role to show under the name.
  const roleLabel: string | null = (() => {
    const roles = authUser?.roles ?? [];
    if (roles.length === 0) return authUser?.role || null;
    return roles[0] ?? null;
  })();

  const loadWorkspaces = async () => {
    setLoadingWs(true);
    try {
      const data = await workspaceService.getWorkspaces();
      setWorkspaces(data.workspaces);
    } catch {
      // Silent: the switcher simply stays empty if it cannot load.
    } finally {
      setLoadingWs(false);
    }
  };

  const handleSwitch = async (
    companyId: number,
    brandId: number | null,
  ) => {
    // No-op if the user picked the workspace they are already in.
    if (companyId === activeCompanyId && (brandId ?? null) === activeBrandId) {
      return;
    }
    setSwitching(true);
    try {
      await switchWorkspace(companyId, brandId);
      // Purge every cached query so no previous-workspace data lingers.
      await queryClient.cancelQueries();
      queryClient.clear();
      toast.success('Workspace switched');
      // Land on the dashboard of the new workspace.
      navigate('/dashboard');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to switch workspace',
      );
    } finally {
      setSwitching(false);
    }
  };

  const handleLogout = () => {
    logout();
    queryClient.clear();
    navigate('/login');
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={open => open && loadWorkspaces()}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-full">
                <AvatarImage src={getMediaUrl(user.avatar) || ''} alt={user.name} />
                <AvatarFallback className="rounded-full">{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                {activeCompanyName ? (
                  <span className="text-primary truncate text-xs font-medium">
                    {activeCompanyName}
                  </span>
                ) : (
                  <span className="text-muted-foreground truncate text-xs">
                    {roleLabel ?? user.email}
                  </span>
                )}
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-full">
                  <AvatarImage src={getMediaUrl(user.avatar) || ''} alt={user.name} />
                  <AvatarFallback className="rounded-full">{getInitials(user.name)}</AvatarFallback>
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

            {/* Workspace switcher — shown only to users who may switch
                (platform admin / switch_brands). Employees, Cashiers and any
                role without switch_brands never see it. */}
            {canSwitch && (<>
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={switching}>
                  <IconSwitchHorizontal className="mr-2 size-4" />
                  Switch workspace
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-64 max-h-96 overflow-y-auto">
                  {loadingWs && (
                    <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                  )}
                  {!loadingWs && workspaces.length === 0 && (
                    <DropdownMenuItem disabled>
                      No other workspace
                    </DropdownMenuItem>
                  )}
                  {!loadingWs &&
                    workspaces.map(ws => {
                      const companyActive =
                        ws.id === activeCompanyId && activeBrandId === null;
                      return (
                        <div key={ws.id}>
                          {/* Whole-company workspace */}
                          <DropdownMenuItem
                            disabled={switching}
                            onClick={() => handleSwitch(ws.id, null)}
                            className="font-medium"
                          >
                            {ws.logo ? (
                              <img
                                src={getMediaUrl(ws.logo) || ''}
                                alt=""
                                className="mr-2 size-5 shrink-0 rounded object-contain"
                              />
                            ) : (
                              <IconBuildingStore className="mr-2 size-4" />
                            )}
                            <span className="flex-1 truncate">{ws.name}</span>
                            {companyActive && <IconCheck className="size-4" />}
                          </DropdownMenuItem>
                          {/* Brand sub-workspaces */}
                          {ws.brands.map(b => {
                            const brandActive =
                              ws.id === activeCompanyId &&
                              b.id === activeBrandId;
                            return (
                              <DropdownMenuItem
                                key={b.id}
                                disabled={switching}
                                onClick={() => handleSwitch(ws.id, b.id)}
                                className="pl-8 text-sm"
                              >
                                <span className="flex-1 truncate">{b.name}</span>
                                {brandActive && <IconCheck className="size-4" />}
                              </DropdownMenuItem>
                            );
                          })}
                        </div>
                      );
                    })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            </>)}

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
