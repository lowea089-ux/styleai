// Starts the HTTP server. Shared by the web entry (index.ts) and the desktop app (desktop/main.ts).
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { buildDeps, createApp } from "./app";
import type { AppConfig } from "./config";
import { log } from "./log";

export function startServer(cfg: AppConfig): Promise<{ port: number; close: () => void }> {
  const deps = buildDeps(cfg);
  const app = createApp(deps, { serveClient: cfg.production });
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info: AddressInfo) => {
      const sp = deps.ai.serverProvider;
      log.info("server_started", {
        port: info.port,
        mode: cfg.desktop ? "desktop" : cfg.production ? "production" : "development",
        ai: sp ? `${sp.name} (${sp.visionModel} / ${sp.textModel})` : "kein Server-Schlüssel (Nutzer können eigene hinterlegen)",
        bg: cfg.bgProvider ?? "nur lokal",
      });
      resolve({
        port: info.port,
        close: () => {
          server.close();
          deps.db.close();
        },
      });
    });
    server.on("error", reject);
  });
}
