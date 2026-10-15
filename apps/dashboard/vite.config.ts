import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The Worker owns /assets/* (OTA assets), so the dashboard bundle lives under /_app.
  build: { assetsDir: "_app" },
  // Hot-reload dev: `wrangler dev` runs the Worker on :8787; the API and auth routes go there.
  // Keep the Host header (no changeOrigin) so the Worker's Origin check sees a same-origin request.
  server: {
    proxy: {
      "/admin": "http://localhost:8787",
      "/auth": "http://localhost:8787",
    },
  },
});
