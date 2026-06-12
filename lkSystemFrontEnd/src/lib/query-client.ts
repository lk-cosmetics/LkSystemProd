import { QueryClient } from '@tanstack/react-query';

/**
 * Retry transient failures, but never waste attempts on a deterministic client
 * error — a 401/403/404/422 won't change by trying again, and retrying a 401
 * just delays the auth refresh/redirect. 408 (timeout) and 429 (rate limit)
 * ARE worth retrying.
 */
function retryTransient(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  ) {
    return false;
  }
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      retry: retryTransient,
      // Exponential backoff, capped — smooths over brief network blips.
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 15000),
      refetchOnWindowFocus: false,
      // When the connection drops and comes back, pull fresh data instead of
      // leaving the user on a stale/empty page that "only loads on refresh".
      refetchOnReconnect: true,
    },
    mutations: {
      // Writes are not idempotent in general — don't auto-retry them.
      retry: 0,
    },
  },
});
