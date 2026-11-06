import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { Capabilities } from "../shared/types";
import { AiError, type AiProvider } from "./ai/provider";
import { createProvider } from "./ai/registry";
import { AiService, type ProviderFactory } from "./ai/service";
import { bgProviderName } from "./bg";
import type { AppConfig } from "./config";
import { openDatabase, type DB } from "./db";
import { errorBody, HttpError, requireAuth, ZodError, zodMessage, type AppEnv, type Deps } from "./http";
import { ImageError, ImageStore } from "./images";
import { log } from "./log";
import { OutfitService } from "./outfits";
import { ConflictError, NotFoundError } from "./repo";
import { accountRoutes, authRoutes, categoryRoutes, preferencesRoutes } from "./routes/account";
import { aiRoutes } from "./routes/ai";
import { imageRoutes, itemRoutes } from "./routes/items";
import { calendarRoutes, feedbackRoutes, insightRoutes, outfitRoutes, stylistRoutes } from "./routes/outfits";
import { tryonRoutes } from "./routes/tryon";
import { WeatherService } from "./weather";

const AI_STATUS: Record<string, 403 | 422 | 429 | 502 | 503 | 504> = {
  AI_UNAVAILABLE: 503,
  AI_CONSENT_REQUIRED: 403,
  AI_LIMIT_REACHED: 429,
  AI_RATE_LIMIT: 429,
  AI_TIMEOUT: 504,
  AI_INVALID_RESPONSE: 502,
  AI_REFUSED: 422,
  AI_ERROR: 502,
};

export interface BuildOptions {
  db?: DB;
  aiProvider?: AiProvider | null;
  /** Builds providers for users with their own key (tests inject fakes here). */
  aiFactory?: ProviderFactory;
  fetchImpl?: typeof fetch;
  serveClient?: boolean;
}

export function buildDeps(cfg: AppConfig, opts: BuildOptions = {}): Deps {
  const db = opts.db ?? openDatabase(cfg.dataDir);
  const provider = opts.aiProvider !== undefined ? opts.aiProvider : cfg.serverAi ? createProvider(cfg.serverAi, cfg.aiTimeoutMs) : null;
  const ai = new AiService(db, cfg, provider, opts.aiFactory);
  return {
    db,
    cfg,
    images: new ImageStore(path.join(cfg.dataDir, "uploads")),
    ai,
    outfits: new OutfitService(db, ai),
    weather: new WeatherService(cfg, opts.fetchImpl),
    fetchImpl: opts.fetchImpl,
  };
}

export function createApp(deps: Deps, opts: { serveClient?: boolean } = {}) {
  const { cfg } = deps;
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: cfg.production
        ? {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "blob:", "data:"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            // 'wasm-unsafe-eval' lets the bundled MediaPipe WebAssembly (live try-on) compile; no JS eval.
            scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
            // Realistic live try-on: Decart signaling/API and the LiveKit media server Decart assigns.
            connectSrc: ["'self'", "https://*.decart.ai", "wss://*.decart.ai", "https://*.livekit.cloud", "wss://*.livekit.cloud"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
          }
        : undefined,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Mutating requests must come from our own origin (cookie-based sessions), whatever the content type.
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const own = origin === new URL(c.req.url).origin || (cfg.appOrigin !== null && origin === cfg.appOrigin);
      const site = c.req.header("sec-fetch-site");
      if ((origin && !own) || (!origin && site && site !== "same-origin" && site !== "none")) {
        return c.json(errorBody("CSRF", "Anfrage von fremder Herkunft blockiert."), 403);
      }
    }
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const t0 = Date.now();
    await next();
    // Route pattern only – ids, queries and bodies are never logged.
    log.info("http", { m: c.req.method, p: c.req.routePath, s: c.res.status, ms: Date.now() - t0 });
  });

  const uploadLimit = bodyLimit({
    maxSize: cfg.maxUploadBytes + 512 * 1024,
    onError: (c) => c.json(errorBody("IMAGE_TOO_LARGE", `Die Datei ist größer als ${Math.round(cfg.maxUploadBytes / 1024 / 1024)} MB.`), 413),
  });
  const jsonLimit = bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json(errorBody("TOO_LARGE", "Die Anfrage ist zu groß."), 413) });
  app.use("/api/*", async (c, next) => {
    const ct = c.req.header("content-type") ?? "";
    return ct.startsWith("multipart/") ? uploadLimit(c, next) : jsonLimit(c, next);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/capabilities", (c) => {
    const caps: Capabilities = {
      ai: { serverConfigured: deps.ai.serverProvider !== null },
      desktop: cfg.desktop,
      backgroundRemoval: { server: bgProviderName(cfg) },
      weather: { provider: "Open-Meteo", attribution: "Wetterdaten von Open-Meteo.com (CC BY 4.0)", attributionUrl: "https://open-meteo.com/" },
      limits: { maxUploadMb: Math.round(cfg.maxUploadBytes / 1024 / 1024) },
      registration: { codeRequired: !!cfg.registrationCode },
      local: !!deps.localUser,
    };
    return c.json(caps);
  });

  app.route("/api/auth", authRoutes(deps));

  const auth = requireAuth(deps);
  for (const p of ["/api/account/*", "/api/preferences/*", "/api/categories/*", "/api/items/*", "/api/images/*", "/api/ai/*", "/api/outfits/*", "/api/feedback/*", "/api/stylist/*", "/api/calendar/*", "/api/insights/*", "/api/tryon/*"]) {
    app.use(p, auth);
    app.use(p.slice(0, -2), auth);
  }
  app.route("/api/account", accountRoutes(deps));
  app.route("/api/preferences", preferencesRoutes(deps));
  app.route("/api/categories", categoryRoutes(deps));
  app.route("/api/items", itemRoutes(deps));
  app.route("/api/images", imageRoutes(deps));
  app.route("/api/ai", aiRoutes(deps));
  app.route("/api/outfits", outfitRoutes(deps));
  app.route("/api/feedback", feedbackRoutes(deps));
  app.route("/api/stylist", stylistRoutes(deps));
  app.route("/api/calendar", calendarRoutes(deps));
  app.route("/api/insights", insightRoutes(deps));
  app.route("/api/tryon", tryonRoutes(deps));

  app.all("/api/*", (c) => c.json(errorBody("NOT_FOUND", "Unbekannter API-Endpunkt."), 404));

  if (opts.serveClient) {
    app.use("/*", serveStatic({ root: cfg.clientDir }));
    app.get("*", async (c) => c.html(await readFile(path.join(cfg.clientDir, "index.html"), "utf8")));
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message, err.details), err.status);
    if (err instanceof ZodError) return c.json(errorBody("VALIDATION", zodMessage(err), err.issues.slice(0, 5)), 400);
    if (err instanceof NotFoundError) return c.json(errorBody("NOT_FOUND", err.message), 404);
    if (err instanceof ConflictError) return c.json(errorBody("CONFLICT", err.message), 409);
    if (err instanceof ImageError) return c.json(errorBody(err.code, err.message), err.code === "IMAGE_TOO_LARGE" ? 413 : err.code === "IMAGE_UNSUPPORTED" ? 415 : 400);
    if (err instanceof AiError) return c.json(errorBody(err.code, err.message, { retryable: err.retryable }), AI_STATUS[err.code] ?? 502);
    log.error("unhandled", { p: c.req.routePath, name: err.name, msg: err.message.slice(0, 200) });
    return c.json(errorBody("INTERNAL", "Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut."), 500);
  });

  return app;
}
