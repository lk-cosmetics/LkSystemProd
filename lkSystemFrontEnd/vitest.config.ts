/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig } from 'vitest/config';

// Dedicated Vitest config (separate from vite.config.ts so the PWA/Tailwind
// build plugins don't run during unit tests). Unit tests target pure logic —
// data builders, chunk-error detection — under a jsdom environment.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
