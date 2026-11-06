// Resolves the active provider per user (own key first, then the operator's), and wraps every call with
// rate limits, daily quotas (operator key only), usage accounting and content-free logging.
import type { AppConfig } from "../config";
import type { DB } from "../db";
import { log } from "../log";
import { RateLimiter } from "../ratelimit";
import { getAiUsage, getUserAiSettings, recordAiUsage } from "../repo";
import { decryptSecret } from "../secrets";
import { AiError, type AiProvider, type AiResult, type ProviderId } from "./provider";
import { createProvider, type ProviderSettings } from "./registry";

export type AiKind = "image" | "text";
export type ProviderFactory = (s: ProviderSettings) => AiProvider;

export type ResolvedAi = { provider: AiProvider; source: "user" | "server" } | { provider: null; source: "user"; error: string };

export class AiService {
  private perMinute = { image: new RateLimiter(12, 60_000), text: new RateLimiter(20, 60_000) };
  private cache = new Map<string, { stamp: string; provider: AiProvider }>();
  private factory: ProviderFactory;

  constructor(
    private db: DB,
    private cfg: AppConfig,
    readonly serverProvider: AiProvider | null,
    factory?: ProviderFactory,
  ) {
    this.factory = factory ?? ((s) => createProvider(s, cfg.aiTimeoutMs));
  }

  resolve(userId: string): ResolvedAi | null {
    const row = getUserAiSettings(this.db, userId);
    if (row) {
      const hit = this.cache.get(userId);
      if (hit && hit.stamp === row.updated_at) return { provider: hit.provider, source: "user" };
      try {
        const provider = this.factory({
          provider: row.provider as ProviderId,
          apiKey: decryptSecret(row.api_key_enc, this.cfg.secretKey),
          baseUrl: row.base_url,
          visionModel: row.vision_model,
          textModel: row.text_model,
        });
        this.cache.set(userId, { stamp: row.updated_at, provider });
        return { provider, source: "user" };
      } catch {
        return { provider: null, source: "user", error: "Dein gespeicherter API-Schlüssel kann nicht gelesen werden. Bitte unter „Mein Stil“ neu eingeben." };
      }
    }
    return this.serverProvider ? { provider: this.serverProvider, source: "server" } : null;
  }

  availableFor(userId: string) {
    return this.resolve(userId)?.provider != null;
  }

  async run<T>(userId: string, kind: AiKind, op: string, fn: (p: AiProvider) => Promise<AiResult<T>>): Promise<T> {
    const active = this.resolve(userId);
    if (!active) throw new AiError("AI_UNAVAILABLE", "Es ist kein KI-Anbieter eingerichtet. Unter „Mein Stil“ kannst du einen eigenen API-Schlüssel hinterlegen.");
    if (!active.provider) throw new AiError("AI_UNAVAILABLE", active.error);
    const rl = this.perMinute[kind].hit(userId);
    if (!rl.ok) throw new AiError("AI_RATE_LIMIT", `Zu viele KI-Anfragen. Bitte in ${rl.retryAfterSec} Sekunden erneut versuchen.`, true);
    const day = new Date().toISOString().slice(0, 10);
    // Daily quotas protect the operator's key; users with their own key pay their own usage.
    if (active.source === "server") {
      const limit = kind === "image" ? this.cfg.aiDailyImageLimit : this.cfg.aiDailyTextLimit;
      if (getAiUsage(this.db, userId, day, kind) >= limit) {
        throw new AiError("AI_LIMIT_REACHED", `Das Tageslimit für KI-${kind === "image" ? "Bildanalysen" : "Anfragen"} (${limit}) ist erreicht. Morgen geht es weiter – oder hinterlege einen eigenen API-Schlüssel.`);
      }
    }
    const t0 = Date.now();
    try {
      const r = await fn(active.provider);
      recordAiUsage(this.db, userId, day, kind, r.usage.inputTokens, r.usage.outputTokens);
      log.info("ai", { op, provider: active.provider.id, source: active.source, model: r.usage.model, in: r.usage.inputTokens, out: r.usage.outputTokens, ms: Date.now() - t0 });
      return r.data;
    } catch (e) {
      const code = e instanceof AiError ? e.code : "AI_ERROR";
      log.warn("ai_failed", { op, provider: active.provider.id, source: active.source, code, ms: Date.now() - t0 });
      throw e instanceof AiError ? e : new AiError("AI_ERROR", "Unbekannter Fehler bei der KI-Anfrage.");
    }
  }
}
