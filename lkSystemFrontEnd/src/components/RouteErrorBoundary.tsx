/**
 * Per-route error isolation.
 *
 * The bare class `ErrorBoundary` can't reach router or query state on its own.
 * This thin wrapper wires in the two things that make a crashed page
 * *recoverable without a hard refresh*:
 *
 *   - `resetKeys={[pathname]}` → navigating to another route automatically
 *     clears a crashed page. No more "click away and back does nothing".
 *   - `QueryErrorResetBoundary` → "Try Again" also resets any React Query that
 *     errored, so the page genuinely refetches instead of re-rendering the
 *     same failed state.
 *
 * It sits INSIDE the Router (so it can use `useLocation`) and wraps the routed
 * `<Suspense>`. The top-level boundary in `App.tsx` stays as the last-resort
 * catch-all for failures outside the routed tree.
 */
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { ErrorBoundary } from './ErrorBoundary';

export function RouteErrorBoundary({ children }: { readonly children: ReactNode }) {
  const location = useLocation();
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary resetKeys={[location.pathname]} onReset={reset}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

export default RouteErrorBoundary;
