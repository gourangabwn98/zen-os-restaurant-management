import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev only: when the API URL is relative ("/api" in config.js or .env), the
// dev server forwards /api and the Socket.IO connection to the backend, like a
// production reverse proxy would. Absolute API URLs bypass this. Change the
// target with DEV_API_TARGET=http://host:port.
const devApiTarget = process.env.DEV_API_TARGET || "http://localhost:5000";
const devProxy = {
  "/api": { target: devApiTarget, changeOrigin: true },
  "/socket.io": { target: devApiTarget, changeOrigin: true, ws: true },
};

export default defineConfig({ plugins: [react()], server: { proxy: devProxy } });
