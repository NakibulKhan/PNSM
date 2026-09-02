/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The triple-slash reference augments Vite's UserConfig type with the `test`
// field below. (Importing `defineConfig` from 'vitest/config' instead is the
// other commonly-suggested fix, but backfired here: vitest@2.1.9's own
// dependency tree carries a duplicate, older vite@5.4.21 alongside this
// project's pinned vite@6.4.3, and vitest/config's defineConfig resolves
// against the nested 5.4.21 copy — which TypeScript then treats as a
// different, incompatible Plugin type from the 6.4.3 one @vitejs/plugin-react
// and @tailwindcss/vite are built against. Fixed at the source instead, via
// package.json's "overrides" forcing a single deduped vite version — see the
// comment there. First real `npm run typecheck` for this project (never run
// before) caught all of this.

/**
 * Vite replaces the deprecated Create React App toolchain entirely.
 *
 * In development it serves source over native ES modules, so there is no bundle
 * step and HMR is effectively instant. For production it runs a Rollup build
 * with tree-shaking and manual chunking.
 *
 * Tailwind v4 is wired through its first-party Vite plugin rather than PostCSS:
 * the Rust-based Oxide engine + Lightning CSS run in-process, which is markedly
 * faster and avoids a separate postcss.config file.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },

  server: {
    port: 3000,
    strictPort: true,
    /*
     * Optional dev-only proxy. If the team prefers to avoid CORS entirely during
     * local development, set VITE_USE_DEV_PROXY=1 and point the client at
     * '/api' — Vite forwards to Express with the Origin rewritten. Production
     * still goes cross-origin, so Person 3's CORS config must be correct either
     * way; this only removes friction while developing.
     */
    proxy:
      process.env.VITE_USE_DEV_PROXY === '1'
        ? {
            '/api': {
              target: process.env.VITE_API_ORIGIN ?? 'http://localhost:5000',
              changeOrigin: true,
              ws: true,
            },
          }
        : undefined,
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    // CloudFront caches by filename hash; keep chunks stable and named.
    rollupOptions: {
      output: {
        manualChunks: {
          // MapLibre carries its own WebGL renderer and is by far the heaviest
          // dependency. Isolating it means the dashboard's first load never
          // pays for the map, which only two screens use.
          map: ['maplibre-gl'],
          charts: ['recharts'],
          pdf: ['jspdf', 'jspdf-autotable'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.{ts,tsx}'],
  },
});
