import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  notificationService,
  type NotificationListParams,
} from '@/services/notification.service';

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────
export const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (params?: NotificationListParams) =>
    [...notificationKeys.lists(), params ?? null] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

/**
 * Shared invalidator. Invalidating ``notificationKeys.all`` is a prefix match,
 * so a single call marks every notification query stale — the paginated lists
 * AND the navbar unread-count badge — keeping the page and the bell in sync
 * after any mark-read / mark-all-read.
 */
function invalidateNotifications(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: notificationKeys.all });
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginated, filterable inbox for the current user. ``keepPreviousData`` keeps
 * the current page on screen while the next page / a changed filter loads, so
 * the list never flashes empty during pagination.
 */
export function useNotifications(
  params?: NotificationListParams,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => notificationService.list(params),
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Unread badge count. Polls every 30s and on window focus so the navbar bell
 * stays close to live without the client ever loading the notification rows
 * themselves. Polling pauses while the tab is hidden (the default), so an idle
 * background tab costs nothing.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationService.unreadCount(),
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations — both invalidate the whole notifications tree so the list and the
// navbar badge update together.
// ─────────────────────────────────────────────────────────────────────────────

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => notificationService.markRead(id),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}
