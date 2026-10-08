/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Blunder Check',
        short_name: 'Blunder Check',
        description: 'Find the habits that cost you chess games, and train exactly those.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0E1412',
        theme_color: '#1F5F4A',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The single-threaded lite engine (~7 MB wasm) is precached so analysis and bot play work offline after the first visit.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json,woff2}'],
        // stockfish-18-single.js must NOT be precached: a worker script answered by the service worker loses its #fragment,
        // and that fragment is how the worker is told where the big wasm lives (src/engine/browser.ts).
        globIgnores: ['engine/stockfish-18-asm.js', 'engine/stockfish-18-single.*'],
        maximumFileSizeToCacheInBytes: 9 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/engine\//],
        runtimeCaching: [
          // The asm.js fallback engine (~10 MB) is only fetched on old browsers; cache it when it is.
          { urlPattern: /\/engine\/stockfish-18-asm\.js$/, handler: 'CacheFirst', options: { cacheName: 'engine-fallback', cacheableResponse: { statuses: [0, 200] } } },
          // The optional strong engine (~108 MB wasm, downloaded once on computers; see src/engine/strong.ts). Matches the
          // same-origin copy or a CDN copy as long as the file keeps its name
          // (Workbox only matches a RegExp against cross-origin URLs from their first character, hence the anchor).
          { urlPattern: /^https?:\/\/.*\/stockfish-18-single\.wasm$/, handler: 'CacheFirst', options: { cacheName: 'engine-strong', cacheableResponse: { statuses: [0, 200] } } },
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts', expiration: { maxEntries: 20 } } },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, host: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
