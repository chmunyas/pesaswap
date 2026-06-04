import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Prompt user before activating SW update — POS/KDS sessions can be long
      // and silent auto-updates risk version-skewing lazy chunks mid-use.
      registerType: 'prompt',
      strategies: 'generateSW',
      injectRegister: false,           // we register manually via lib/pwa.ts to control update prompts
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'PESASWAP — Modern Point of Sale',
        short_name: 'PESASWAP',
        description: 'Mobile-first POS with AI insights, QR payments, BNPL, KDS, and table service.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a0a0a',
        theme_color: '#10b981',
        categories: ['business', 'finance', 'productivity'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Kitchen Display', short_name: 'KDS', description: 'Live order queue', url: '/kds', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Point of Sale', short_name: 'POS', description: 'Start a new sale', url: '/pos', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Tap & Go Pay', short_name: 'Pay', description: 'Customer payment flow', url: '/pay', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Precache the app shell AND all hashed JS/CSS chunks so that lazy
        // route imports for /menu, /kds, dashboard etc. resolve fully offline.
        // 5 MB cap is generous but we currently sit at ~1.5 MB total assets.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // SPA fallback — but never serve index.html for API or service-worker requests.
        // /login is intentionally NOT denylisted so it can render offline.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/(sw|workbox).*\.js$/],
        runtimeCaching: [
          // PUBLIC menu — safe to cache aggressively, keyed per tableId in the URL.
          // 200s only, 1 hour, NetworkFirst with 3s timeout so live updates win.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/public/menu/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pesaswap-public-menu',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Dashboard stats — authenticated; cache briefly so refresh-on-load
          // is instant. UI shows "last updated" so staleness is visible.
          // 200s only; purged on logout via clearAuthenticatedCaches().
          {
            urlPattern: ({ url }) => url.pathname === '/api/dashboard/stats',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pesaswap-dashboard',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 3, maxAgeSeconds: 5 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // No broad /api/* cache rule on purpose: per rubber-duck #2, caching
          // all authenticated GETs risks leaking one user's data to another on
          // the same device. Add explicit rules only as needed.
        ],
      },
      devOptions: {
        enabled: false,           // do NOT register SW in dev (Vite proxies fight Workbox)
        type: 'module',
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:80',
        changeOrigin: true,
      },
    },
  },
})
