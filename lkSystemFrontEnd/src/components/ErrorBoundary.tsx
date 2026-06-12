import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Loader2 } from 'lucide-react';
import {
  isChunkLoadError,
  reloadForStaleChunkOnce,
  clearChunkReloadGuard,
} from '@/utils/lazyWithRetry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /**
   * When any value in this array changes while the boundary is showing an
   * error, the boundary resets itself. Pass `[location.pathname]` to recover
   * automatically on navigation. See {@link RouteErrorBoundary}.
   */
  resetKeys?: unknown[];
  /** Run when the boundary resets — e.g. reset React Query error state. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  /** The error came from a failed dynamic import / missing JS chunk. */
  isChunk: boolean;
  /** A one-time auto-reload was scheduled for this (stale-chunk) error. */
  reloading: boolean;
}

function resetKeysChanged(prev?: unknown[], next?: unknown[]): boolean {
  if (prev === next) return false;
  if (!prev || !next || prev.length !== next.length) return true;
  return prev.some((value, i) => !Object.is(value, next[i]));
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isChunk: false, reloading: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, isChunk: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Always surface the *real* error to the console (dev AND prod) so the
    // generic screen never hides the underlying cause from diagnostics.
    console.error('[ErrorBoundary]', error, errorInfo?.componentStack ?? '');

    // A stale chunk after a deploy is recoverable: reload ONCE (guarded) to
    // pull the fresh app shell instead of showing a scary crash screen.
    if (isChunkLoadError(error)) {
      const reloading = reloadForStaleChunkOnce();
      this.setState({ errorInfo, isChunk: true, reloading });
      return;
    }

    this.props.onError?.(error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidUpdate(prevProps: Props) {
    // Recover automatically when the caller's resetKeys change (e.g. the route
    // changed) — this is what lets "navigate away and back" clear a crash.
    if (
      this.state.hasError &&
      resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset();
    }
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      isChunk: false,
      reloading: false,
    });
  };

  // "Try Again": for a stale-chunk error a soft reset can't help (the module
  // is genuinely gone), so force a fresh load. For anything else, reset the
  // boundary AND the errored queries so the page actually refetches.
  private handleTryAgain = () => {
    if (this.state.isChunk) {
      clearChunkReloadGuard();
      window.location.reload();
      return;
    }
    this.reset();
  };

  private handleRefresh = () => {
    clearChunkReloadGuard();
    window.location.reload();
  };

  private handleGoHome = () => {
    clearChunkReloadGuard();
    window.location.href = '/dashboard';
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    // ── Stale build after a deploy ───────────────────────────────────────
    // While the one-time reload is in flight, show a calm "updating" state
    // (no alarming copy) — the page is about to refresh itself.
    if (this.state.isChunk && this.state.reloading) {
      return (
        <div className="min-h-screen bg-l-bg-1 dark:bg-d-bg-1 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-accent-1" />
            <p className="text-l-text-2 dark:text-d-text-2">
              Updating to the latest version…
            </p>
          </div>
        </div>
      );
    }

    const isChunk = this.state.isChunk;

    // Default error UI (recoverable render/runtime error, or a stale chunk
    // whose auto-reload already happened once and still failed).
    return (
      <div className="min-h-screen bg-l-bg-1 dark:bg-d-bg-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-l-bg-2 dark:bg-d-bg-2 rounded-lg border border-border-l dark:border-border-d p-6 text-center">
          <div className="flex justify-center mb-4">
            <AlertTriangle className="h-12 w-12 text-accent-danger" />
          </div>

          <h1 className="text-xl font-bold text-l-text-1 dark:text-d-text-1 mb-2">
            {isChunk ? 'A new version is available' : 'Oops! Something went wrong'}
          </h1>

          <p className="text-l-text-2 dark:text-d-text-2 mb-6">
            {isChunk
              ? 'The app was updated in the background. Reload to get the latest version.'
              : "We hit an unexpected error. You can retry — your data is safe."}
          </p>

          {/* Real error details in development only */}
          {import.meta.env.DEV && this.state.error && (
            <details className="mb-6 text-left">
              <summary className="cursor-pointer text-l-text-2 dark:text-d-text-2 hover:text-l-text-1 dark:hover:text-d-text-1">
                Error Details (Dev Mode)
              </summary>
              <pre className="mt-2 p-3 bg-l-bg-3 dark:bg-d-bg-3 rounded text-xs overflow-auto text-accent-danger whitespace-pre-wrap break-words">
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div className="space-y-3">
            <button
              onClick={this.handleTryAgain}
              className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-accent-1 hover:bg-accent-2 text-white rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-md cursor-pointer"
            >
              <RefreshCw className="h-5 w-5" />
              <span>{isChunk ? 'Reload' : 'Try Again'}</span>
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={this.handleRefresh}
                className="flex items-center justify-center gap-3 px-4 py-3 bg-l-bg-3 dark:bg-d-bg-3 hover:bg-l-bg-hover dark:hover:bg-d-bg-hover text-l-text-1 dark:text-d-text-1 border border-border-l dark:border-border-d rounded-lg font-medium transition-all duration-200 cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Reload Page</span>
              </button>

              <button
                onClick={this.handleGoHome}
                className="flex items-center justify-center gap-3 px-4 py-3 bg-l-bg-3 dark:bg-d-bg-3 hover:bg-l-bg-hover dark:hover:bg-d-bg-hover text-l-text-1 dark:text-d-text-1 border border-border-l dark:border-border-d rounded-lg font-medium transition-all duration-200 cursor-pointer"
              >
                <Home className="h-4 w-4" />
                <span>Go Home</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

// Hook version for functional components
export function useErrorBoundary() {
  const [error, setError] = React.useState<Error | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const captureError = React.useCallback((error: Error) => {
    setError(error);
  }, []);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return { captureError, resetError };
}
