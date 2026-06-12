import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/globals.css';
import App from './app';
import { fetchCsrfToken } from './utils/csrf';
import { reloadForStaleChunkOnce } from './utils/lazyWithRetry';

// Register the PWA service worker so the app shell + assets are precached and
// the POS keeps working across reloads / cold starts while offline. No-op in
// dev. `autoUpdate` means a new deploy is fetched, activated and reloaded
// automatically (precache serves the old chunks until then — no stale-chunk
// crash). See vite.config.ts for the Workbox strategy.
registerSW({
  immediate: true,
  onOfflineReady() {
    if (import.meta.env.DEV) console.info('[pwa] ready to work offline');
  },
});

// Test backend connection in development
if (import.meta.env.DEV) {
  void import('./utils/testConnection');
}

// Vite fires this when a dynamically-imported chunk fails to preload — almost
// always a stale build still referenced by an open tab after a deploy. Reload
// once (guarded against loops) to fetch the fresh app shell instead of letting
// it bubble up as an uncaught crash.
window.addEventListener('vite:preloadError', event => {
  event.preventDefault();
  reloadForStaleChunkOnce();
});

// Fetch the CSRF token before rendering, but render REGARDLESS of the outcome:
// a slow/failed CSRF bootstrap must never leave the user staring at a blank
// page until a hard refresh.
void fetchCsrfToken().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  // Note: the stale-chunk reload guard is intentionally NOT cleared here.
  // `render()` only schedules the React render — no route chunk has loaded
  // yet — so clearing now could permit a second reload if a cached stale
  // index.html were served. The guard is cleared precisely when a chunk
  // actually loads (see `loadWithRetry` in utils/lazyWithRetry), which is the
  // real proof the fresh shell works and keeps recovery strictly loop-safe.
});
