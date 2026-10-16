import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // The app runs as a Cloudflare Worker; SSR happens in the Worker runtime.
    // In dev, share the API Worker's local state, so both see the same D1 database.
    cloudflare({ viteEnvironment: { name: "ssr" }, persistState: { path: "../server/.wrangler/state" } }),
    tanstackStart(),
    viteReact(),
  ],
});
