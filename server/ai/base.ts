// Shared request building and answer validation for every provider.
// Providers only implement `complete()`: send one request, return raw text + usage.
import { z } from "zod";
import { AiError, type AiProvider, type AiResult, type AiUsage, type ExplainInput, type ProviderId, type StylistInput } from "./provider";
import { EXPLAIN_SYSTEM, GARMENT_SYSTEM, STYLIST_SYSTEM } from "./prompts";
import { explainSchema, garmentAnalysisSchema, stylistSchema, toStructuredSchema } from "./schemas";

export type Effort = "low" | "medium" | "high";

export interface CompletionRequest {
  model: string;
  effort: Effort;
  maxTokens: number;
  system: string;
  /** Text blocks in order. The first one is stable (cacheable) when `cacheFirst` is set. */
  texts: string[];
  cacheFirst?: boolean;
  image?: { mediaType: "image/jpeg"; data: Buffer };
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}

export interface Completion {
  text: string;
  usage: AiUsage;
  stop: "end" | "max_tokens" | "refusal";
}

const pingSchema = z.object({ ok: z.boolean() });

const SCHEMAS = {
  garment: toStructuredSchema(garmentAnalysisSchema),
  explain: toStructuredSchema(explainSchema),
  stylist: toStructuredSchema(stylistSchema),
  ping: toStructuredSchema(pingSchema),
};

/** Pull the JSON object out of a model answer (tolerates code fences and leaked <think> blocks). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no json");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export function explainText(input: ExplainInput): string {
  const candidates = input.candidates
    .map(
      (c) =>
        `Kandidat ${c.id} (Regel-Score ${c.ruleScore}/100):\n` +
        c.items
          .map(
            (i) =>
              `  - [${i.role}] ${i.name} | ${i.category} | Farben: ${i.colors.join(", ") || "?"} | Muster: ${i.pattern}${i.material ? ` | ${i.material}` : ""}${i.fit ? ` | ${i.fit}` : ""}${i.styles.length ? ` | Stil: ${i.styles.join(", ")}` : ""}`,
          )
          .join("\n"),
    )
    .join("\n\n");
  const req = [
    `Gewünschte Stile: ${input.styles.join(", ") || "keine Angabe"}${input.customStyle ? ` + eigener Stil: "${input.customStyle}"` : ""}`,
    `Anlass: ${input.occasion ?? "keine Angabe"}${input.customOccasion ? ` + "${input.customOccasion}"` : ""}`,
    `Wetter: ${input.weather ?? "unbekannt"}`,
    `Auffälligkeit 0–1: ${input.boldness.toFixed(1)}, Experimentierfreude 0–1: ${input.experimental.toFixed(1)}`,
    `Anzahl gewünschter Outfits: ${input.count}`,
  ].join("\n");
  return `${req}\n\n${candidates}`;
}

export function stylistTexts(input: StylistInput): [string, string] {
  const wardrobe = input.wardrobe
    .map((w) => `${w.id} | ${w.name} | ${w.category} | ${w.colors.join("/")}${w.status !== "available" ? " | nicht verfügbar" : ""}`)
    .join("\n");
  return [
    `Kleiderschrank (ID | Name | Kategorie | Farben):\n${wardrobe || "(leer)"}`,
    `Heute: ${input.today}. Wetter: ${input.weather ?? "unbekannt"}. Bevorzugte Stile laut Profil: ${input.preferredStyles.join(", ") || "keine"}.\n\nNachricht: ${input.message}`,
  ];
}

export abstract class BaseProvider implements AiProvider {
  abstract readonly id: ProviderId;
  abstract readonly name: string;

  constructor(
    readonly visionModel: string,
    readonly textModel: string,
  ) {}

  /** One request to the provider. Must map transport errors to AiError. */
  protected abstract complete(req: CompletionRequest): Promise<Completion>;

  private async structured<T>(req: CompletionRequest, schema: z.ZodType<T>): Promise<AiResult<T>> {
    let problem = "";
    // One extra attempt if the answer fails our own validation.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.complete(req);
      if (res.stop === "refusal") throw new AiError("AI_REFUSED", "Die KI hat die Anfrage abgelehnt. Bitte formuliere sie anders.");
      if (res.stop === "max_tokens") {
        problem = "Antwort abgeschnitten";
        continue;
      }
      let json: unknown;
      try {
        json = extractJson(res.text);
      } catch {
        problem = "kein gültiges JSON";
        continue;
      }
      const parsed = schema.safeParse(json);
      if (parsed.success) return { data: parsed.data, usage: res.usage };
      problem = "Schema-Verletzung";
    }
    throw new AiError("AI_INVALID_RESPONSE", `Die KI hat keine verwertbare Antwort geliefert (${problem}).`, true);
  }

  analyzeGarments(jpeg: Buffer) {
    return this.structured(
      {
        model: this.visionModel,
        effort: "low",
        maxTokens: 8000,
        system: GARMENT_SYSTEM,
        texts: ["Analysiere die Kleidungsstücke auf diesem Foto. Antworte ausschließlich mit JSON nach dem Schema."],
        image: { mediaType: "image/jpeg", data: jpeg },
        schemaName: "garment_analysis",
        jsonSchema: SCHEMAS.garment,
      },
      garmentAnalysisSchema,
    );
  }

  explainOutfits(input: ExplainInput) {
    return this.structured(
      { model: this.textModel, effort: "medium", maxTokens: 12000, system: EXPLAIN_SYSTEM, texts: [explainText(input)], schemaName: "outfit_explanations", jsonSchema: SCHEMAS.explain },
      explainSchema,
    );
  }

  interpretStylistMessage(input: StylistInput) {
    return this.structured(
      {
        model: this.textModel,
        effort: "low",
        maxTokens: 6000,
        system: STYLIST_SYSTEM,
        // Wardrobe first: it changes rarely, so providers with prompt caching can reuse it.
        texts: stylistTexts(input),
        cacheFirst: true,
        schemaName: "stylist_request",
        jsonSchema: SCHEMAS.stylist,
      },
      stylistSchema,
    );
  }

  testConnection() {
    return this.structured(
      {
        model: this.textModel,
        effort: "low",
        maxTokens: 2000,
        system: "Du bist ein Verbindungstest. Antworte nur mit JSON.",
        texts: ['Antworte mit {"ok": true}.'],
        schemaName: "connection_test",
        jsonSchema: SCHEMAS.ping,
      },
      pingSchema,
    );
  }
}

/** Scales retry waits; tests set it to 0. */
export const retryTiming = { scale: 1 };

/** Retry helper for providers without built-in retries (429, 5xx, network). `isRetryable` returns a wait in ms or null. */
export async function withRetries<T>(fn: () => Promise<T>, isRetryable: (e: unknown) => number | null, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const wait = isRetryable(e);
      if (wait === null || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, wait * (i + 1) * retryTiming.scale));
    }
  }
  throw lastError;
}
