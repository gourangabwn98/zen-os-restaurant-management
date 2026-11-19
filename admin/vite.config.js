import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import process from 'node:process'

// Dev only: when the API URL is relative ("/api" in config.js or .env), the
// dev server forwards /api and the Socket.IO connection to the backend, like a
// production reverse proxy would. Absolute API URLs bypass this. Change the
// target with DEV_API_TARGET=http://host:port.
const devApiTarget = process.env.DEV_API_TARGET || 'http://localhost:5000'
const devProxy = {
  '/api': { target: devApiTarget, changeOrigin: true },
  '/socket.io': { target: devApiTarget, changeOrigin: true, ws: true },
}

// PWA app shell (vite-plugin-pwa → Workbox). Precaches the built HTML/JS/CSS,
// fonts and icons so the app opens with no internet. Deliberately NOT cached
// by the worker: API calls and Socket.IO (never intercepted — saved data is
// kept by the app, per user) and /config.js (network-first, so a server-side
// edit of the backend address still applies). See src/pwa/registerPwa.js.
const pwa = VitePWA({
  registerType: "prompt",       // new deploys wait for staff to tap "Reload"
  injectRegister: false,        // registered in src/pwa/registerPwa.js
  includeManifestIcons: false,  // icons are already matched by globPatterns (no duplicate entries)
  manifest: {
    id: "/",
    name: "Hotel KHOAI – Admin",
    short_name: "KHOAI Admin",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F1EFF7",
    theme_color: "#F1EFF7",
    icons: [
      { src: "/brand/khoai-v2/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/khoai-v2/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/khoai-v2/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
    globIgnores: ["config.js"],
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/config.js",
        handler: "NetworkFirst",
        options: { cacheName: "zen-runtime-config", networkTimeoutSeconds: 3 },
      },
    ],
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pwa],
  server: { proxy: devProxy },
  build: {
    rolldownOptions: {
      output: {
        // Third-party code (React, router, socket.io, axios…) changes far less
        // often than app code, so it gets its own long-cached chunk — a deploy
        // then re-downloads only the app chunk. Firebase is left out on
        // purpose: only the login screen uses it, so it stays in that chunk.
        codeSplitting: {
          groups: [
            {
              name: (id) => (/node_modules/.test(id) && !/[\\/]@?firebase[\\/]/.test(id) ? 'vendor' : null),
            },
          ],
        },
      },
    },
  },
})
