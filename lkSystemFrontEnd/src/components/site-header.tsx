import { useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
} from '@/hooks/queries/useNotifications';
import type { NotificationItem } from '@/services/notification.service';

/** Human-readable header titles, keyed by the path relative to /dashboard. */
const PAGE_TITLES: Record<string, string> = {
  '': 'Dashboard',
  users: 'Users',
  'users/add': 'Add User',
  'add-user': 'Add User',
  roles: 'Roles',
  profile: 'Profile',
  companies: 'Companies',
  'add-company': 'Add Company',
  brands: 'Brands',
  'sales-channels': 'Sales Channels',
  products: 'Products',
  inventory: 'Inventory',
  manufacturing: 'Manufacturing',
  categories: 'Categories',
  promotions: 'Promotions',
  orders: 'Orders',
  clients: 'Clients',
  pos: 'Point of Sale',
  notifications: 'Notifications',
  settings: 'Settings',
};

/** Derive the current page title from the route so the header reflects
 *  where the user actually is (previously hardcoded to "Documents"). */
function usePageTitle(): string {
  const { pathname } = useLocation();
  const rel = pathname.replace(/^\/dashboard\/?/, '').replace(/\/$/, '');
  if (rel === '') return PAGE_TITLES[''];
  if (PAGE_TITLES[rel]) return PAGE_TITLES[rel];

  const [first, second, third] = rel.split('/');
  if (first === 'users' && second && third === 'edit') return 'Edit User';
  if (first === 'users' && second) return 'User Details';

  return (
    PAGE_TITLES[first] ??
    first.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  );
}

/** Dependency-free relative time ("just now", "5m ago", "3d ago", or a date). */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SiteHeader() {
  const navigate = useNavigate();
  const pageTitle = usePageTitle();
  const [open, setOpen] = useState(false);

  const { data: unreadCount = 0 } = useUnreadCount();
  // Only fetch the recent list while the dropdown is open — the badge already
  // polls the cheap unread-count endpoint, so the list stays idle otherwise.
  const { data, isLoading } = useNotifications(
    { page_size: 10 },
    { enabled: open }
  );
  const markRead = useMarkNotificationRead();

  const notifications = data?.results ?? [];

  const handleOpen = (notification: NotificationItem) => {
    if (!notification.is_read) markRead.mutate(notification.id);
    setOpen(false);
    if (notification.link_url) navigate(notification.link_url);
  };

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{pageTitle}</h1>
        <div className="ml-auto flex items-center gap-2">
          {/* Notification Dropdown */}
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="size-5" />
                {unreadCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-1 -right-1 size-5 flex items-center justify-center p-0 text-xs"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                )}
                <span className="sr-only">Notifications</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 max-h-[400px] overflow-hidden flex flex-col"
            >
              <DropdownMenuLabel className="flex items-center justify-between border-b bg-l-bg-1 dark:bg-d-bg-1">
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="ml-auto">
                    {unreadCount} new
                  </Badge>
                )}
              </DropdownMenuLabel>
              <div className="overflow-y-auto flex-1">
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-sm text-l-text-3 dark:text-d-text-3">
                    <Loader2 className="size-4 animate-spin" />
                    Loading…
                  </div>
                ) : notifications.length > 0 ? (
                  <>
                    {notifications.map(notification => (
                      <DropdownMenuItem
                        key={notification.id}
                        onSelect={() => handleOpen(notification)}
                        className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${
                          notification.is_read ? '' : 'bg-l-bg-2 dark:bg-d-bg-2'
                        }`}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {notification.title}
                            </p>
                            {notification.body && (
                              <p className="text-xs text-l-text-3 dark:text-d-text-3 line-clamp-2">
                                {notification.body}
                              </p>
                            )}
                          </div>
                          {!notification.is_read && (
                            <div className="size-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <span className="text-xs text-l-text-3 dark:text-d-text-3">
                          {formatRelativeTime(notification.created_at)}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      asChild
                      className="text-center justify-center text-sm text-primary cursor-pointer"
                    >
                      <Link to="/dashboard/notifications">
                        View all notifications
                      </Link>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <div className="p-4 text-center text-sm text-l-text-3 dark:text-d-text-3">
                    No notifications
                  </div>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
