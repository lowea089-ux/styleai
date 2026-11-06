// Output schemas for every AI call. Zod is the single source of truth: it generates the JSON schema
// sent to the model (structured outputs) and validates the answer again before anything is stored.
import { z } from "zod";
import { COLOR_IDS } from "../../shared/color";
import { DEFAULT_CATEGORY_KEYS, FIT_IDS, OCCASION_IDS, PATTERN_IDS, SEASON_IDS, STYLE_IDS } from "../../shared/taxonomy";

const confidence = z.enum(["hoch", "mittel", "niedrig"]);

export const garmentSchema = z.object({
  categoryKey: z.enum(DEFAULT_CATEGORY_KEYS),
  subtype: z.string().nullable(),
  name: z.string(),
  pattern: z.enum(PATTERN_IDS),
  colorNames: z.array(z.enum(COLOR_IDS)),
  material: z.string().nullable(),
  materialConfidence: confidence,
  fit: z.enum(FIT_IDS).nullable(),
  styles: z.array(z.enum(STYLE_IDS)),
  seasons: z.array(z.enum(SEASON_IDS)),
  occasions: z.array(z.enum(OCCASION_IDS)),
  formality: z.number(),
  warmth: z.number(),
  description: z.string(),
  brand: z.string().nullable(),
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
  confidence,
});

export const garmentAnalysisSchema = z.object({
  items: z.array(garmentSchema),
  imageQuality: z.enum(["gut", "mittel", "schlecht"]),
  notes: z.string().nullable(),
});
export type GarmentAnalysis = z.infer<typeof garmentAnalysisSchema>;
export type AnalyzedGarment = z.infer<typeof garmentSchema>;

export const explainSchema = z.object({
  outfits: z.array(
    z.object({
      candidateId: z.string(),
      title: z.string(),
      summary: z.string(),
      colorNotes: z.string(),
      layeringNotes: z.string(),
      accessoryNotes: z.string(),
      weatherNotes: z.string(),
      occasionNotes: z.string(),
    }),
  ),
});
export type ExplainOutput = z.infer<typeof explainSchema>;

export const stylistSchema = z.object({
  intent: z.enum(["outfit", "frage"]),
  reply: z.string(),
  styles: z.array(z.enum(STYLE_IDS)),
  customStyle: z.string().nullable(),
  occasion: z.enum(OCCASION_IDS).nullable(),
  customOccasion: z.string().nullable(),
  colors: z.array(z.enum(COLOR_IDS)),
  mustIncludeItemIds: z.array(z.string()),
  excludeItemIds: z.array(z.string()),
  formality: z.number().nullable(),
  boldness: z.number().nullable(),
  experimental: z.number().nullable(),
  temperatureC: z.number().nullable(),
  rain: z.boolean().nullable(),
  count: z.number().nullable(),
});
export type StylistOutput = z.infer<typeof stylistSchema>;

const UNSUPPORTED = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
]);

/** Convert a Zod schema into the JSON-schema subset supported by structured outputs. */
export function toStructuredSchema(schema: z.ZodType): Record<string, unknown> {
  return sanitize(z.toJSONSchema(schema)) as Record<string, unknown>;
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (UNSUPPORTED.has(k)) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, sanitize(pv)])) : sanitize(v);
  }
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    const { type: _t, ...rest } = out;
    const nonNull = types.filter((t) => t !== "null");
    const variants: Record<string, unknown>[] = nonNull.map((t) => ({ ...rest, type: t }));
    if (types.includes("null")) variants.push({ type: "null" });
    return variants.length === 1 ? variants[0] : { anyOf: variants };
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}
