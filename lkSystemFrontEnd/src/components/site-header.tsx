import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
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
import notificationsData from '@/data/notifications.json';

export function SiteHeader() {
  // Load notifications from JSON file
  const notifications = notificationsData.slice(0, 10); // Show only first 3 in header

  const unreadCount = notificationsData.filter(n => !n.read).length;

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">Documents</h1>
        <div className="ml-auto flex items-center gap-2">
          {/* Notification Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="size-5" />
                {unreadCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-1 -right-1 size-5 flex items-center justify-center p-0 text-xs"
                  >
                    {unreadCount}
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
                {notifications.length > 0 ? (
                  <>
                    {notifications.map(notification => (
                      <DropdownMenuItem
                        key={notification.id}
                        className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${
                          notification.read ? '' : 'bg-l-bg-2 dark:bg-d-bg-2'
                        }`}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              {notification.title}
                            </p>
                            <p className="text-xs text-l-text-3 dark:text-d-text-3">
                              {notification.message}
                            </p>
                          </div>
                          {!notification.read && (
                            <div className="size-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <span className="text-xs text-l-text-3 dark:text-d-text-3">
                          {notification.time}
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
