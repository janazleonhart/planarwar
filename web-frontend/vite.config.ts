// web-frontend/vite.config.ts
//
// Dev server config.
// IMPORTANT: When you run the frontend on the VM (port 5173) and the backend on the same VM (port 4000),
// we must proxy /api requests through Vite. Otherwise the browser hits Vite, gets index.html, and JSON parsing explodes.
//
// This also avoids CORS entirely for same-origin calls from the frontend code.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";


export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      // REST API -> web-backend (on the VM)
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        secure: false,
      },

      // Optional: if you ever route WS through Vite for local dev.
      // (Your game WS is typically on 7777/ws; keep this here as a convenience.)
      "/ws": {
        target: "ws://127.0.0.1:7777",
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
