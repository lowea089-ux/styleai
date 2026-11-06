/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = Number(process.env.API_PORT ?? 8787);

// Mode "web" is the browser edition for static hosting (GitHub Pages), built by scripts/build-web.mjs:
// served from a sub-path, no server – a service worker answers /api/* with data stored in the browser.
export default defineConfig(({ mode }) => {
  const web = mode === "web";
  return {
    base: web ? (process.env.WEB_BASE ?? "/styleai/").replace(/\/?$/, "/") : "/",
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { "/api": { target: `http://localhost:${apiPort}`, changeOrigin: false } },
    },
    preview: web ? { port: 4174, strictPort: true } : undefined,
    build: web ? { outDir: "dist-web", sourcemap: false, emptyOutDir: true } : { outDir: "dist", sourcemap: true },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
      testTimeout: 20000,
    },
  };
});
