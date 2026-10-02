import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
