import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ── Progressive Web App / offline ──────────────────────────────────────
    // Precaches the app shell + every hashed build asset so the POS keeps
    // working through a network drop AND across a full reload / cold start
    // (the cashier can close and reopen the tab offline). `autoUpdate` +
    // `cleanupOutdatedCaches` make a new deploy install cleanly and reload
    // once — the same hashed-chunk staleness that used to crash the app is now
    // served from the precache until the new worker takes over (the
    // lazyWithRetry / vite:preloadError reload remains a belt-and-suspenders).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered explicitly in main.tsx for control
      includeAssets: ['favicon.svg', 'logo.svg'],
      manifest: {
        name: 'LK System',
        short_name: 'LK System',
        description: 'LK Cosmetics — point of sale, orders & inventory',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/dashboard/pos',
        scope: '/',
        icons: [
          { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the shell + all build assets → offline cold start works.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ico,png}'],
        // SPA: serve the cached index.html for navigations when offline, but
        // never shadow the API / admin / media / websocket / image-proxy paths.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/admin\//,
          /^\/media\//,
          /^\/static\//,
          /^\/ws\//,
          /^\/wp-proxy\//,
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Caisse reads: keep the last-synced stats / history / journal and
            // the unified cash movements (expenses + alimentations) available
            // offline (NetworkFirst → fresh when online, cached fallback when
            // not). Writes are queued client-side, see
            // services/offlineCaisse.service.ts.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.pathname.includes('/sales-channels/cash-movements'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lk-caisse-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
  },
  build: {
    // Page chunks are split at the route level via React.lazy (see
    // src/app/router.tsx) — that is the main payload win and keeps heavy,
    // route-specific deps (recharts on the BI pages, html5-qrcode behind the
    // POS scanner) off the initial critical path automatically.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Only split React itself into its own long-cacheable chunk.
        // react / react-dom / scheduler are pure "sink" modules — nothing
        // else in node_modules imports them back — so this cannot create a
        // circular chunk dependency. Hand-grouping other vendors (e.g.
        // splitting @radix-ui away from the radix-ui meta package and its
        // shared scroll/aria/floating-ui helpers) DID create an inter-chunk
        // import cycle that crashed at boot with a blank screen, so we let
        // Vite chunk the rest automatically.
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
