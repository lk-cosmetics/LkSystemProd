import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useNotifications,
  useUnreadCount,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@/hooks/queries/useNotifications';
import type {
  NotificationCategory,
  NotificationItem,
  NotificationListParams,
  NotificationPriority,
} from '@/services/notification.service';

const PAGE_SIZE = 20;

type ReadFilter = 'all' | 'unread' | 'read';

const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  order: { label: 'Order', variant: 'default' },
  sync: { label: 'Sync', variant: 'secondary' },
  stock: { label: 'Stock', variant: 'destructive' },
  return: { label: 'Return', variant: 'outline' },
  exchange: { label: 'Exchange', variant: 'outline' },
  system: { label: 'System', variant: 'secondary' },
};

const PRIORITY_DOT: Record<NotificationPriority, string> = {
  urgent: 'bg-red-500',
  high: 'bg-amber-500',
  normal: 'bg-primary',
  low: 'bg-l-bg-3 dark:bg-d-bg-3',
};

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

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [page, setPage] = useState(1);

  const listParams: NotificationListParams = {
    page,
    page_size: PAGE_SIZE,
    ...(readFilter === 'all' ? {} : { is_read: readFilter === 'read' }),
    ...(category === 'all' ? {} : { category }),
  };

  const {
    data,
    isLoading,
    isError,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useNotifications(listParams);
  const { data: unreadCount = 0 } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasNext = Boolean(data?.next);
  const hasPrevious = Boolean(data?.previous);

  // Changing a filter should always restart at the first page.
  const changeReadFilter = (value: string) => {
    setReadFilter(value as ReadFilter);
    setPage(1);
  };
  const changeCategory = (value: string) => {
    setCategory(value as NotificationCategory | 'all');
    setPage(1);
  };

  const handleMarkRead = (id: number) => {
    markRead.mutate(id, {
      onError: () => toast.error('Could not mark the notification as read.'),
    });
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: result =>
        toast.success(
          result.updated > 0
            ? `Marked ${result.updated} notification${result.updated === 1 ? '' : 's'} as read.`
            : 'No unread notifications.'
        ),
      onError: () => toast.error('Could not mark all notifications as read.'),
    });
  };

  const handleOpen = (notification: NotificationItem) => {
    if (!notification.is_read) handleMarkRead(notification.id);
    if (notification.link_url) navigate(notification.link_url);
  };

  const NotificationCard = ({
    notification,
  }: {
    notification: NotificationItem;
  }) => {
    const meta = CATEGORY_META[notification.category] ?? {
      label: notification.category,
      variant: 'secondary' as const,
    };
    const clickable = Boolean(notification.link_url);

    return (
      <Card
        onClick={clickable ? () => handleOpen(notification) : undefined}
        className={`p-4 transition-all hover:shadow-md ${
          notification.is_read ? 'opacity-60' : 'border-primary/50'
        } ${clickable ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-start gap-4">
          {/* Unread indicator (coloured by priority) */}
          <div
            className={`size-2 mt-2 rounded-full ${
              notification.is_read
                ? 'bg-l-bg-3 dark:bg-d-bg-3'
                : `${PRIORITY_DOT[notification.priority] ?? 'bg-primary'} animate-pulse`
            }`}
          />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-base">{notification.title}</h3>
                <Badge variant={meta.variant} className="text-xs">
                  {meta.label}
                </Badge>
                {(notification.priority === 'urgent' ||
                  notification.priority === 'high') && (
                  <Badge variant="destructive" className="text-xs capitalize">
                    {notification.priority}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-l-text-3 dark:text-d-text-3 whitespace-nowrap">
                {formatRelativeTime(notification.created_at)}
              </span>
            </div>
            {notification.body && (
              <p className="text-sm text-l-text-2 dark:text-d-text-2 mb-3">
                {notification.body}
              </p>
            )}

            {/* Actions */}
            {!notification.is_read && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation();
                    handleMarkRead(notification.id);
                  }}
                  disabled={markRead.isPending}
                  className="h-8 text-xs gap-1"
                >
                  <Check className="size-3" />
                  Mark as read
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Bell className="size-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-sm">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <p className="text-l-text-2 dark:text-d-text-2 mt-2">
            Stay updated with your system activities
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0 || markAllRead.isPending}
            className="gap-2"
          >
            {markAllRead.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCheck className="size-4" />
            )}
            Mark all read
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-l-text-3 dark:text-d-text-3" />
            <span className="text-sm font-medium">Filter by type:</span>
          </div>
          <Select value={category} onValueChange={changeCategory}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="order">Order</SelectItem>
              <SelectItem value="sync">Synchronization</SelectItem>
              <SelectItem value="stock">Stock</SelectItem>
              <SelectItem value="return">Return</SelectItem>
              <SelectItem value="exchange">Exchange</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-sm text-l-text-3 dark:text-d-text-3">
            {totalCount} notification{totalCount === 1 ? '' : 's'}
          </div>
          {isFetching && (
            <Loader2 className="size-4 animate-spin text-l-text-3 dark:text-d-text-3" />
          )}
        </div>
      </Card>

      {/* Read-state filter (drives the `is_read` query param) */}
      <Tabs value={readFilter} onValueChange={changeReadFilter} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </TabsTrigger>
          <TabsTrigger value="read">Read</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* List */}
      <div
        className={`space-y-4 ${isPlaceholderData ? 'opacity-60' : ''}`}
        aria-busy={isFetching}
      >
        {isLoading ? (
          <Card className="p-12 text-center">
            <Loader2 className="size-10 mx-auto mb-4 animate-spin text-primary" />
            <p className="text-l-text-2 dark:text-d-text-2">
              Loading notifications…
            </p>
          </Card>
        ) : isError ? (
          <Card className="p-12 text-center">
            <AlertTriangle className="size-12 mx-auto mb-4 text-destructive" />
            <p className="text-l-text-2 dark:text-d-text-2 font-medium mb-2">
              Could not load notifications
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </Card>
        ) : notifications.length > 0 ? (
          notifications.map(notification => (
            <NotificationCard
              key={notification.id}
              notification={notification}
            />
          ))
        ) : readFilter === 'unread' ? (
          <Card className="p-12 text-center">
            <CheckCheck className="size-12 mx-auto mb-4 text-green-500" />
            <p className="text-l-text-2 dark:text-d-text-2 font-medium mb-2">
              All caught up!
            </p>
            <p className="text-sm text-l-text-3 dark:text-d-text-3">
              You have no unread notifications
            </p>
          </Card>
        ) : (
          <Card className="p-12 text-center">
            <Bell className="size-12 mx-auto mb-4 text-l-text-3 dark:text-d-text-3" />
            <p className="text-l-text-2 dark:text-d-text-2">
              No notifications found
            </p>
          </Card>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && !isError && totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-l-text-3 dark:text-d-text-3">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={!hasPrevious || isFetching}
              className="gap-1"
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={!hasNext || isFetching}
              className="gap-1"
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
