/**
 * Resilient dynamic-import loading for route-level code splitting.
 *
 * Two real-world ways a `import('@/pages/...')` fails in production:
 *
 *   1. Transient network blip — the chunk request just dropped. A short
 *      backoff + retry almost always recovers it without a reload.
 *   2. Stale chunk after a deploy — the running tab references an OLD hashed
 *      filename that no longer exists on the server (the deploy replaced it),
 *      so the request 404s. The only real cure is to fetch a fresh
 *      `index.html` + chunk map, i.e. a full reload.
 *
 * `lazyWithRetry` handles both, and guards the reload with a sessionStorage
 * flag so it can NEVER loop: we reload at most once per failure episode, and
 * clear the flag the instant any chunk loads successfully (proof the fresh
 * shell works).
 */
import { lazy, type ComponentType } from 'react';

/**
 * One-shot guard. Set right before a stale-chunk reload; cleared the moment a
 * chunk loads successfully or the app shell mounts. sessionStorage so it
 * survives the single reload but never leaks across tabs or future sessions.
 */
export const CHUNK_RELOAD_FLAG = 'lk:chunk-reloaded';

// Names/messages browsers and bundlers use when a dynamic import / script
// chunk fails to load. Kept broad on purpose — different engines word it
// differently, and a stale deploy sometimes serves index.html (an HTML MIME
// type) in place of the missing .js.
const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|module script failed|expected a JavaScript(?:-or-Wasm)? module|is not a valid JavaScript MIME type/i;

/** True when `error` looks like a failed dynamic import / missing JS chunk. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (name === 'ChunkLoadError') return true;
  return CHUNK_ERROR_RE.test(`${name} ${message}`);
}

function readGuard(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Clear the auto-reload guard — call once a chunk/app shell loads cleanly. */
export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — ignore */
  }
}

/**
 * Reload the page exactly once to pick up a fresh build after a deploy.
 * Returns `true` if it scheduled a reload, `false` if it already reloaded once
 * this episode (the caller should then surface the error instead of looping).
 */
export function reloadForStaleChunkOnce(): boolean {
  if (readGuard()) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  } catch {
    /* ignore */
  }
  if (import.meta.env.DEV) {
    console.warn('[lazyWithRetry] stale chunk detected — reloading once for the latest build');
  }
  // `replace` keeps the broken entry out of history so Back doesn't return to it.
  window.location.reload();
  return true;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Resolves never: holds the <Suspense> fallback in place while the reload
// triggered above takes over, so the user never sees an error flash first.
const NEVER_RESOLVES = new Promise<never>(() => {});

/**
 * `React.lazy` with retry + stale-deploy recovery. Drop-in replacement:
 *   const OrdersPage = lazyWithRetry(() => import('@/pages/OrdersPage'));
 *
 * A genuine bug inside the module (not a load failure) is re-thrown
 * immediately so the ErrorBoundary can report it — we only retry/reload for
 * real chunk-load failures.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  { retries = 2, interval = 350 }: { retries?: number; interval?: number } = {},
) {
  return lazy(() => loadWithRetry(factory, retries, interval));
}

async function loadWithRetry<TModule>(
  factory: () => Promise<TModule>,
  retries: number,
  interval: number,
): Promise<TModule> {
  for (let attempt = 0; ; attempt++) {
    try {
      const mod = await factory();
      clearChunkReloadGuard(); // fresh shell confirmed working
      return mod;
    } catch (error) {
      if (!isChunkLoadError(error)) throw error; // real module bug → report it

      if (attempt < retries) {
        if (import.meta.env.DEV) {
          console.warn(
            `[lazyWithRetry] chunk load failed (attempt ${attempt + 1}/${retries + 1}) — retrying`,
            error,
          );
        }
        await delay(interval * (attempt + 1)); // linear backoff
        continue;
      }

      // Out of retries on a chunk error → treat as a stale deploy.
      if (reloadForStaleChunkOnce()) {
        return NEVER_RESOLVES as Promise<TModule>;
      }
      throw error; // already reloaded once — hand off to the ErrorBoundary
    }
  }
}
