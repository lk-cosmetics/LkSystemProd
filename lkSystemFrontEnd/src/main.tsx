import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/globals.css';
import App from './app';
import { fetchCsrfToken } from './utils/csrf';
import { reloadForStaleChunkOnce } from './utils/lazyWithRetry';

const DJANGO_ADMIN_PATH_PREFIX = '/secure-access-lk';

function isDjangoAdminPath(pathname = window.location.pathname) {
  return (
    pathname === DJANGO_ADMIN_PATH_PREFIX ||
    pathname.startsWith(`${DJANGO_ADMIN_PATH_PREFIX}/`)
  );
}

async function releaseDjangoAdminFromAppShell() {
  const retryKey = 'lk-admin-shell-release-attempted';

  if (sessionStorage.getItem(retryKey) === '1') {
    document.body.innerHTML = [
      '<main style="font-family: system-ui, sans-serif; max-width: 560px; margin: 12vh auto; padding: 24px; line-height: 1.5;">',
      '<h1 style="font-size: 22px; margin: 0 0 12px;">Django admin is cached by the app shell</h1>',
      '<p style="margin: 0 0 16px;">Please hard refresh this page or clear site data for lksystem.therapybylk.com, then open /secure-access-lk/ again.</p>',
      '<a style="color: #111827; font-weight: 700;" href="/secure-access-lk/">Open Django admin</a>',
      '</main>',
    ].join('');
    return;
  }

  sessionStorage.setItem(retryKey, '1');

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
  }

  window.location.replace(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

// Register the PWA service worker so the app shell + assets are precached and
// the POS keeps working across reloads / cold starts while offline. No-op in
// dev. `autoUpdate` means a new deploy is fetched, activated and reloaded
// automatically (precache serves the old chunks until then — no stale-chunk
// crash). See vite.config.ts for the Workbox strategy.
if (isDjangoAdminPath()) {
  void releaseDjangoAdminFromAppShell();
} else {
  sessionStorage.removeItem('lk-admin-shell-release-attempted');

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
}
