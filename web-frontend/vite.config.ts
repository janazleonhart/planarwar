// web-frontend/vite.config.ts
//
// Dev server config.
// IMPORTANT: When you run the frontend on the VM (port 5173) and the backend on the same VM (port 4000),
// we must proxy /api requests through Vite. Otherwise the browser hits Vite, gets index.html, and JSON parsing explodes.
//
// This also avoids CORS entirely for same-origin calls from the frontend code.
//
// Fixme note (VM file watching):
// In some VM/shared-folder setups, Vite's file watcher can miss newly-added files until a restart.
// If you hit that, enable polling via env:
//
//   VITE_WATCH_POLLING=true
//   VITE_WATCH_POLLING_INTERVAL=250
//
// (Polling is heavier, so keep it off by default.)

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:4000";
  const wsTarget = env.VITE_WS_PROXY_TARGET || "ws://127.0.0.1:7777";

  const usePolling = (env.VITE_WATCH_POLLING || "").toLowerCase() === "true";
  const interval = Number(env.VITE_WATCH_POLLING_INTERVAL || "250");

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      watch: usePolling
        ? {
            usePolling: true,
            interval: Number.isFinite(interval) && interval > 0 ? interval : 250,
          }
        : undefined,
      proxy: {
        // REST API -> web-backend (on the VM)
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },

        // Optional: if you ever route WS through Vite for local dev.
        // (Your game WS is typically on 7777/ws; keep this here as a convenience.)
        "/ws": {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
