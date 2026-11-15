import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev only: when the API URL is relative ("/api" in config.js or .env), the
// dev server forwards /api and the Socket.IO connection to the backend, like a
// production reverse proxy would. Absolute API URLs bypass this. Change the
// target with DEV_API_TARGET=http://host:port.
const devApiTarget = process.env.DEV_API_TARGET || 'http://localhost:5000'
const devProxy = {
  '/api': { target: devApiTarget, changeOrigin: true },
  '/socket.io': { target: devApiTarget, changeOrigin: true, ws: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
