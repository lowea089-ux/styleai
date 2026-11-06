import { Hono } from "hono";
import { aiSettingsSchema } from "../../shared/schemas";
import type { AiProviderId, AiStatus } from "../../shared/types";
import { AiError } from "../ai/provider";
import { PROVIDER_IDS, PROVIDERS } from "../ai/registry";
import type { AnalyzedGarment } from "../ai/schemas";
import { HttpError, readImage, readJson, type AppEnv, type Deps } from "../http";
import { toAnalysisJpeg } from "../images";
import * as repo from "../repo";
import { encryptSecret, keyHint } from "../secrets";

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Custom endpoints: https anywhere, plain http only on this machine (local model servers). */
function validateBaseUrl(raw: string | null): string {
  if (!raw) throw new HttpError(400, "BASE_URL_REQUIRED", "Bitte die Basis-URL der API angeben, z. B. https://api.openai.com/v1.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "BASE_URL_INVALID", "Die URL ist ungültig.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new HttpError(400, "BASE_URL_INVALID", "Nur https-Adressen oder http://localhost sind erlaubt.");
  }
  if (u.username || u.password) throw new HttpError(400, "BASE_URL_INVALID", "Zugangsdaten gehören nicht in die URL.");
  return u.toString().replace(/\/+$/, "");
}

export function aiStatus(deps: Deps, userId: string): AiStatus {
  const own = repo.getUserAiSettings(deps.db, userId);
  const resolved = deps.ai.resolve(userId);
  const user = repo.getUser(deps.db, userId)!;
  const sp = deps.ai.serverProvider;
  return {
    providers: PROVIDER_IDS.filter((id) => id !== "openai_compatible" || deps.cfg.allowCustomAiBaseUrl).map((id) => ({
      id,
      label: PROVIDERS[id].label,
      defaultVisionModel: PROVIDERS[id].defaultVisionModel,
      defaultTextModel: PROVIDERS[id].defaultTextModel,
      keyUrl: PROVIDERS[id].keyUrl,
      note: PROVIDERS[id].note,
      requiresBaseUrl: id === "openai_compatible",
    })),
    server: sp ? { providerId: sp.id, provider: sp.name, visionModel: sp.visionModel, textModel: sp.textModel } : null,
    own: own
      ? {
          providerId: own.provider as AiProviderId,
          keyHint: own.key_hint,
          baseUrl: own.base_url,
          visionModel: own.vision_model,
          textModel: own.text_model,
          updatedAt: own.updated_at,
        }
      : null,
    active:
      resolved?.provider != null
        ? { source: resolved.source, providerId: resolved.provider.id, provider: resolved.provider.name, visionModel: resolved.provider.visionModel, textModel: resolved.provider.textModel }
        : null,
    activeError: resolved && resolved.provider === null ? resolved.error : null,
    consent: !!user.ai_image_consent_at,
  };
}

export function aiRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/settings", (c) => c.json(aiStatus(deps, c.get("user").id)));

  app.put("/settings", async (c) => {
    const user = c.get("user");
    const input = await readJson(c, aiSettingsSchema);
    if (input.provider === "openai_compatible" && !deps.cfg.allowCustomAiBaseUrl) {
      throw new HttpError(403, "CUSTOM_URL_DISABLED", "Eigene API-Adressen sind auf diesem Server deaktiviert.");
    }
    const existing = repo.getUserAiSettings(deps.db, user.id);
    let apiKeyEnc: string;
    let hint: string;
    if (input.apiKey) {
      apiKeyEnc = encryptSecret(input.apiKey, deps.cfg.secretKey);
      hint = keyHint(input.apiKey);
    } else if (existing && existing.provider === input.provider) {
      apiKeyEnc = existing.api_key_enc;
      hint = existing.key_hint;
    } else if (input.provider === "openai_compatible") {
      // Local model servers often need no key.
      apiKeyEnc = encryptSecret("", deps.cfg.secretKey);
      hint = "ohne Schlüssel";
    } else {
      throw new HttpError(400, "API_KEY_REQUIRED", "Bitte den API-Schlüssel des Anbieters eingeben.");
    }
    const info = PROVIDERS[input.provider];
    if (input.provider === "openai_compatible" && (!input.visionModel || !input.textModel)) {
      throw new HttpError(400, "MODEL_REQUIRED", "Bitte Modellnamen für Bildanalyse und Text angeben.");
    }
    repo.saveUserAiSettings(deps.db, user.id, {
      provider: input.provider,
      api_key_enc: apiKeyEnc,
      key_hint: hint,
      base_url: input.provider === "openai_compatible" ? validateBaseUrl(input.baseUrl) : null,
      vision_model: input.visionModel && input.visionModel !== info.defaultVisionModel ? input.visionModel : null,
      text_model: input.textModel && input.textModel !== info.defaultTextModel ? input.textModel : null,
    });
    // Saving requires the consent checkbox for exactly this provider.
    repo.setAiConsent(deps.db, user.id, true);
    return c.json(aiStatus(deps, user.id));
  });

  app.delete("/settings", (c) => {
    repo.deleteUserAiSettings(deps.db, c.get("user").id);
    return c.json(aiStatus(deps, c.get("user").id));
  });

  app.post("/test", async (c) => {
    const t0 = Date.now();
    await deps.ai.run(c.get("user").id, "text", "connection_test", (p) => p.testConnection());
    const active = aiStatus(deps, c.get("user").id).active!;
    return c.json({ ok: true, provider: active.provider, model: active.textModel, ms: Date.now() - t0 });
  });

  app.post("/analyze", async (c) => {
    const user = c.get("user");
    const resolved = deps.ai.resolve(user.id);
    if (!resolved) throw new AiError("AI_UNAVAILABLE", "Es ist kein KI-Anbieter eingerichtet. Bitte die Angaben manuell ergänzen.");
    if (!resolved.provider) throw new AiError("AI_UNAVAILABLE", resolved.error);
    if (!user.ai_image_consent_at) throw new AiError("AI_CONSENT_REQUIRED", "Für die KI-Bildanalyse ist deine Einwilligung nötig.");
    const { buf } = await readImage(c);
    const jpeg = await toAnalysisJpeg(buf, deps.cfg.maxUploadBytes);
    const out = await deps.ai.run(user.id, "image", "analyze_garments", (p) => p.analyzeGarments(jpeg));
    const byKey = new Map(repo.listCategories(deps.db, user.id).filter((x) => x.key).map((x) => [x.key!, x]));
    const items = out.items.slice(0, 6).map((g: AnalyzedGarment) => {
      const cat = byKey.get(g.categoryKey);
      const bb = g.bbox;
      const bbox =
        bb && [bb.x, bb.y, bb.w, bb.h].every(Number.isFinite) && bb.w > 0.04 && bb.h > 0.04
          ? { x: clamp(bb.x, 0, 1), y: clamp(bb.y, 0, 1), w: clamp(bb.w, 0, 1 - clamp(bb.x, 0, 1)), h: clamp(bb.h, 0, 1 - clamp(bb.y, 0, 1)) }
          : null;
      return {
        categoryId: cat?.id ?? null,
        categoryKey: g.categoryKey,
        subtype: g.subtype?.trim().slice(0, 60) || null,
        name: g.name.trim().slice(0, 80) || cat?.name || "Kleidungsstück",
        pattern: g.pattern,
        colorNames: uniq(g.colorNames).slice(0, 3),
        // Uncertain materials are not stored – the user can still enter them.
        material: g.materialConfidence === "niedrig" ? null : g.material?.trim().slice(0, 60) || null,
        fit: g.fit,
        styles: uniq(g.styles).slice(0, 6),
        seasons: uniq(g.seasons),
        occasions: uniq(g.occasions),
        formality: Math.round(clamp(g.formality, 1, 5) * 10) / 10,
        warmth: Math.round(clamp(g.warmth, 0, 5) * 10) / 10,
        description: g.description.trim().slice(0, 600),
        brand: g.brand?.trim().slice(0, 60) || null,
        bbox,
        confidence: g.confidence,
        aiConfidence: { category: g.confidence, material: g.materialConfidence },
      };
    });
    return c.json({ items, imageQuality: out.imageQuality, notes: out.notes, provider: resolved.provider.name });
  });

  return app;
}
