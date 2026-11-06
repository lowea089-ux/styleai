// Zod schemas for every API input. The server validates with these; the client reuses the inferred types.
import { z } from "zod";
import { COLOR_IDS } from "./color";
import {
  FIT_IDS,
  ITEM_STATUS_IDS,
  OCCASION_IDS,
  PATTERN_IDS,
  SEASON_IDS,
  STYLE_IDS,
} from "./taxonomy";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT erwartet");
const id = z.string().min(1).max(64);
const SLOTS = ["top", "bottom", "onepiece", "suit", "outer", "shoes", "accessory"] as const;
const LAYERS = ["base", "mid", "outer", "none"] as const;
const GROUPS = ["tops", "bottoms", "more", "shoes", "accessories"] as const;
const ACC_KINDS = ["head", "belt", "bag", "watch", "jewelry", "scarf", "other"] as const;
const ROLES = [
  "top",
  "base",
  "mid",
  "bottom",
  "onepiece",
  "suit",
  "outer",
  "shoes",
  ...ACC_KINDS.map((k) => `acc:${k}` as const),
] as const;

export const itemColorSchema = z.object({
  family: z.enum(COLOR_IDS),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ratio: z.number().min(0).max(1),
});

export const itemInputSchema = z.object({
  categoryId: id,
  subtype: z.string().trim().max(60).nullable().default(null),
  name: z.string().trim().min(1, "Bitte einen Namen angeben").max(80),
  colors: z.array(itemColorSchema).max(5).default([]),
  pattern: z.enum(PATTERN_IDS).default("uni"),
  material: z.string().trim().max(60).nullable().default(null),
  fit: z.enum(FIT_IDS).nullable().default(null),
  styles: z.array(z.enum(STYLE_IDS)).max(6).default([]),
  seasons: z.array(z.enum(SEASON_IDS)).max(4).default([]),
  occasions: z.array(z.enum(OCCASION_IDS)).max(9).default([]),
  formality: z.number().min(0).max(5).default(2.5),
  warmth: z.number().min(0).max(5).default(1.5),
  slotOverride: z.enum(SLOTS).nullable().default(null),
  description: z.string().trim().max(600).default(""),
  brand: z.string().trim().max(60).nullable().default(null),
  purchaseDate: isoDate.nullable().default(null),
  priceCents: z.number().int().min(0).max(10_000_000).nullable().default(null),
  status: z.enum(ITEM_STATUS_IDS).default("available"),
  favorite: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  aiAnalyzed: z.boolean().default(false),
  aiConfidence: z.record(z.string(), z.enum(["hoch", "mittel", "niedrig"])).nullable().default(null),
});
export type ItemInput = z.infer<typeof itemInputSchema>;
export const itemPatchSchema = itemInputSchema.partial();
export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  group: z.enum(GROUPS),
  slot: z.enum(SLOTS),
  layer: z.enum(LAYERS).default("none"),
  warmth: z.number().min(0).max(5).default(1.5),
  formality: z.number().min(0).max(5).default(2.5),
  accessoryKind: z.enum(ACC_KINDS).nullable().default(null),
  standalone: z.boolean().default(true),
  beltLoops: z.boolean().default(false),
  legCoverage: z.enum(["full", "short", "none"]).default("none"),
});
export const categoryPatchSchema = categoryInputSchema.partial().extend({ sortOrder: z.number().int().optional() });

export const weatherSchema = z.object({
  tempC: z.number().min(-60).max(60),
  feelsLikeC: z.number().min(-70).max(70).nullable().optional(),
  tempMinC: z.number().min(-60).max(60).nullable().optional(),
  tempMaxC: z.number().min(-60).max(60).nullable().optional(),
  precipitationProbability: z.number().min(0).max(100).nullable().optional(),
  precipitationMm: z.number().min(0).max(500).nullable().optional(),
  windKmh: z.number().min(0).max(300).nullable().optional(),
  weatherCode: z.number().int().nullable().optional(),
  description: z.string().max(80).nullable().optional(),
  locationName: z.string().max(120).nullable().optional(),
  source: z.enum(["open-meteo", "manuell"]),
});

export const generateRequestSchema = z.object({
  styles: z.array(z.enum(STYLE_IDS)).max(5).default([]),
  customStyle: z.string().trim().max(200).nullable().default(null),
  occasion: z.enum(OCCASION_IDS).nullable().default(null),
  customOccasion: z.string().trim().max(200).nullable().default(null),
  colors: z.array(z.enum(COLOR_IDS)).max(8).default([]),
  mustInclude: z.array(id).max(6).default([]),
  exclude: z.array(id).max(500).default([]),
  preferFavorites: z.boolean().default(false),
  weather: weatherSchema.nullable().default(null),
  formality: z.number().min(1).max(5).nullable().default(null),
  boldness: z.number().min(0).max(1).nullable().default(null),
  experimental: z.number().min(0).max(1).nullable().default(null),
  count: z.number().int().min(1).max(8).default(3),
  seed: z.number().int().optional(),
  avoidKeys: z.array(z.string().max(800)).max(200).default([]),
  trendId: z.string().max(60).nullable().default(null),
  similarTo: z.array(id).max(12).nullable().default(null),
  useAi: z.boolean().default(true),
  date: isoDate.nullable().default(null),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type GenerateRequestInput = z.input<typeof generateRequestSchema>;

export const outfitItemRefSchema = z.object({ itemId: id, role: z.enum(ROLES) });

export const swapRequestSchema = z.object({
  items: z.array(outfitItemRefSchema).min(1).max(12),
  replaceItemId: id,
  request: generateRequestSchema.default(generateRequestSchema.parse({})),
});

export const scoreRequestSchema = z.object({
  items: z.array(outfitItemRefSchema).min(1).max(12),
  request: generateRequestSchema.default(generateRequestSchema.parse({})),
});

const explanationSchema = z.object({
  title: z.string().max(160),
  summary: z.string().max(1200),
  colorNotes: z.string().max(800),
  layeringNotes: z.string().max(800),
  accessoryNotes: z.string().max(800),
  weatherNotes: z.string().max(800),
  occasionNotes: z.string().max(800),
  source: z.enum(["regelbasiert", "ki"]),
});

export const outfitInputSchema = z.object({
  name: z.string().trim().min(1).max(80).default("Mein Outfit"),
  items: z.array(outfitItemRefSchema).min(1).max(12),
  styles: z.array(z.enum(STYLE_IDS)).max(5).default([]),
  occasion: z.enum(OCCASION_IDS).nullable().default(null),
  weather: weatherSchema.nullable().default(null),
  explanation: explanationSchema.nullable().default(null),
  score: z.number().min(0).max(100).nullable().default(null),
  breakdown: z.record(z.string(), z.number()).nullable().default(null),
  source: z.enum(["generiert", "manuell", "ki"]).default("manuell"),
  saved: z.boolean().default(true),
  favorite: z.boolean().default(false),
});
export type OutfitInput = z.infer<typeof outfitInputSchema>;
export const outfitPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  items: z.array(outfitItemRefSchema).min(1).max(12).optional(),
  favorite: z.boolean().optional(),
  saved: z.boolean().optional(),
  explanation: explanationSchema.nullable().optional(),
  score: z.number().min(0).max(100).nullable().optional(),
  breakdown: z.record(z.string(), z.number()).nullable().optional(),
});

export const feedbackSchema = z.object({
  kind: z.enum(["like", "dislike", "save", "wear", "swap", "remove_item"]),
  itemIds: z.array(id).min(1).max(12),
  outfitId: id.nullable().default(null),
  fromItemId: id.nullable().default(null),
  toItemId: id.nullable().default(null),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

export const calendarInputSchema = z.object({
  date: isoDate,
  outfitId: id,
  status: z.enum(["planned", "worn"]).default("planned"),
  note: z.string().trim().max(200).nullable().default(null),
});
export const calendarPatchSchema = z.object({
  status: z.enum(["planned", "worn"]).optional(),
  note: z.string().trim().max(200).nullable().optional(),
  date: isoDate.optional(),
});

export const preferencesPatchSchema = z.object({
  preferredStyles: z.array(z.enum(STYLE_IDS)).max(8).optional(),
  customStyle: z.string().trim().max(200).nullable().optional(),
  favoriteColors: z.array(z.enum(COLOR_IDS)).max(12).optional(),
  avoidedColors: z.array(z.enum(COLOR_IDS)).max(12).optional(),
  typicalOccasions: z.array(z.enum(OCCASION_IDS)).max(9).optional(),
  experimental: z.number().min(0).max(1).optional(),
  boldness: z.number().min(0).max(1).optional(),
  personalizationEnabled: z.boolean().optional(),
  avoidRepeatDays: z.number().int().min(0).max(60).optional(),
  onboardingCompleted: z.boolean().optional(),
  locationName: z.string().trim().max(120).nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLon: z.number().min(-180).max(180).nullable().optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail-Adresse angeben").max(200),
  password: z.string().min(10, "Das Passwort muss mindestens 10 Zeichen lang sein").max(200),
  displayName: z.string().trim().min(1, "Bitte einen Namen angeben").max(60),
  /** Invite code, required when the server sets REGISTRATION_CODE. */
  code: z.string().trim().max(200).optional(),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().min(1).max(200),
});

const modelName = z
  .string()
  .trim()
  .max(120)
  .regex(/^[\w.:/@-]*$/, "Ungültiger Modellname")
  .nullable()
  .default(null)
  .transform((v) => v || null);

export const aiSettingsSchema = z.object({
  provider: z.enum(["anthropic", "groq", "gemini", "openai_compatible"]),
  /** null keeps the stored key (only when the provider stays the same). */
  apiKey: z.string().trim().max(500).nullable().default(null),
  baseUrl: z.string().trim().max(300).nullable().default(null),
  visionModel: modelName,
  textModel: modelName,
  consent: z.literal(true, { error: "Bitte stimme der Übertragung an den gewählten Anbieter zu." }),
});
export type AiSettingsInput = z.input<typeof aiSettingsSchema>;

export const tryonSettingsSchema = z.object({
  /** null/omitted keeps the stored key; a new key is checked with Decart before it is saved. */
  apiKey: z.string().trim().min(8, "Der Schlüssel ist zu kurz.").max(500).nullable().default(null),
  maxSessionSeconds: z.number().int().min(20).max(300).optional(),
  consent: z.literal(true, { error: "Bitte stimme der Übertragung des Kamerabilds an Decart zu." }),
});
export type TryonSettingsInput = z.input<typeof tryonSettingsSchema>;

export const stylistMessageSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  weather: weatherSchema.nullable().default(null),
  useAi: z.boolean().default(true),
});
