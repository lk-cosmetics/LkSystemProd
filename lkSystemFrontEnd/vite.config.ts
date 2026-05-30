import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
