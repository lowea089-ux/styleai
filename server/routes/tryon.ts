import { Hono } from "hono";
import { tryonSettingsSchema } from "../../shared/schemas";
import type { TryonStatus, TryonToken } from "../../shared/types";
import { HttpError, readJson, type AppEnv, type Deps } from "../http";
import { log } from "../log";
import { RateLimiter } from "../ratelimit";
import * as repo from "../repo";
import { decryptSecret, encryptSecret, keyHint } from "../secrets";
import { mintTryonToken } from "../tryon";

const DEFAULT_SECONDS = 60;
const today = () => new Date().toISOString().slice(0, 10);

function resolveKey(deps: Deps, userId: string): { key: string; source: "user" | "server" } | null {
  const own = repo.getTryonSettings(deps.db, userId);
  if (own?.api_key_enc) {
    try {
      return { key: decryptSecret(own.api_key_enc, deps.cfg.secretKey), source: "user" };
    } catch {
      // Unreadable (secret changed): fall back to the operator key if there is one.
    }
  }
  return deps.cfg.decartApiKey ? { key: deps.cfg.decartApiKey, source: "server" } : null;
}

export function tryonStatus(deps: Deps, userId: string): TryonStatus {
  const s = repo.getTryonSettings(deps.db, userId);
  const resolved = resolveKey(deps, userId);
  return {
    available: !!resolved,
    source: resolved?.source ?? null,
    keyHint: resolved?.source === "user" ? s?.key_hint ?? null : null,
    consent: !!s?.video_consent_at,
    maxSessionSeconds: s?.max_session_seconds ?? DEFAULT_SECONDS,
    model: deps.cfg.tryonModel,
    remainingToday: resolved?.source === "server" ? Math.max(0, deps.cfg.tryonDailySessions - repo.getAiUsage(deps.db, userId, today(), "tryon")) : null,
  };
}

export function tryonRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter(6, 60_000);

  app.get("/status", (c) => c.json(tryonStatus(deps, c.get("user").id)));

  app.put("/settings", async (c) => {
    const user = c.get("user");
    const input = await readJson(c, tryonSettingsSchema);
    let key: { apiKeyEnc: string; keyHint: string } | undefined;
    if (input.apiKey) {
      // Creating a token costs nothing and proves the key works before it is stored.
      await mintTryonToken(deps.cfg, input.apiKey, { expiresIn: 10, maxSessionSeconds: 20 }, deps.fetchImpl);
      key = { apiKeyEnc: encryptSecret(input.apiKey, deps.cfg.secretKey), keyHint: keyHint(input.apiKey) };
    }
    repo.saveTryonSettings(deps.db, user.id, { ...key, maxSessionSeconds: input.maxSessionSeconds, consent: true });
    return c.json(tryonStatus(deps, user.id));
  });

  /** Removes the own key and withdraws the consent. */
  app.delete("/settings", (c) => {
    repo.deleteTryonSettings(deps.db, c.get("user").id);
    return c.json(tryonStatus(deps, c.get("user").id));
  });

  app.post("/token", async (c) => {
    const user = c.get("user");
    const s = repo.getTryonSettings(deps.db, user.id);
    if (!s?.video_consent_at) throw new HttpError(403, "TRYON_CONSENT_REQUIRED", "Für die realistische Anprobe ist deine Einwilligung zur Übertragung des Kamerabilds nötig.");
    const resolved = resolveKey(deps, user.id);
    if (!resolved) throw new HttpError(503, "TRYON_UNAVAILABLE", "Für die realistische Anprobe fehlt ein Decart-Schlüssel. Du kannst ihn unter „Mein Stil → Realistische Live-Anprobe“ hinterlegen.");
    const rl = limiter.hit(user.id);
    if (!rl.ok) throw new HttpError(429, "TRYON_RATE_LIMIT", `Zu viele Starts hintereinander. Bitte ${rl.retryAfterSec} s warten.`);
    if (resolved.source === "server" && repo.getAiUsage(deps.db, user.id, today(), "tryon") >= deps.cfg.tryonDailySessions) {
      throw new HttpError(429, "TRYON_LIMIT_REACHED", "Das Tageslimit für realistische Anproben ist erreicht. Mit einem eigenen Decart-Schlüssel gibt es kein App-Limit.");
    }
    const maxSessionSeconds = s.max_session_seconds ?? DEFAULT_SECONDS;
    const token = await mintTryonToken(deps.cfg, resolved.key, { expiresIn: 120, maxSessionSeconds }, deps.fetchImpl);
    if (resolved.source === "server") repo.recordAiUsage(deps.db, user.id, today(), "tryon", 0, 0);
    log.info("tryon_token", { source: resolved.source, seconds: maxSessionSeconds });
    const body: TryonToken = { apiKey: token.apiKey, expiresAt: token.expiresAt, maxSessionSeconds, model: deps.cfg.tryonModel };
    return c.json(body);
  });

  return app;
}
