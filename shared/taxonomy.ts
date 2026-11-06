// Central fashion vocabulary shared by server, client, engine and AI prompts.

export type GroupId = "tops" | "bottoms" | "more" | "shoes" | "accessories";
export type Slot = "top" | "bottom" | "onepiece" | "suit" | "outer" | "shoes" | "accessory";
export type Layer = "base" | "mid" | "outer" | "none";
export type AccessoryKind = "head" | "belt" | "bag" | "watch" | "jewelry" | "scarf" | "other";
export type LegCoverage = "full" | "short" | "none";

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "tops", label: "Oberteile" },
  { id: "bottoms", label: "Unterteile" },
  { id: "more", label: "Weitere Kleidung" },
  { id: "shoes", label: "Schuhe" },
  { id: "accessories", label: "Accessoires" },
];

export interface CategoryDef {
  key: string;
  name: string;
  group: GroupId;
  slot: Slot;
  layer: Layer;
  /** 0 (luftig) – 5 (sehr warm) */
  warmth: number;
  /** 1 (sehr leger) – 5 (formell) */
  formality: number;
  accessoryKind: AccessoryKind | null;
  /** Mid-layer that can be worn without anything underneath (Pullover yes, Strickjacke no). */
  standalone: boolean;
  beltLoops: boolean;
  legCoverage: LegCoverage;
}

const c = (
  key: string,
  name: string,
  group: GroupId,
  slot: Slot,
  layer: Layer,
  warmth: number,
  formality: number,
  extra: Partial<CategoryDef> = {},
): CategoryDef => ({
  key,
  name,
  group,
  slot,
  layer,
  warmth,
  formality,
  accessoryKind: null,
  standalone: layer === "base",
  beltLoops: false,
  legCoverage: "none",
  ...extra,
});

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  c("tshirt", "T-Shirts", "tops", "top", "base", 1, 1.5),
  c("longsleeve", "Langarmshirts", "tops", "top", "base", 1.5, 2),
  c("shirt", "Hemden", "tops", "top", "base", 1.5, 3.5),
  c("blouse", "Blusen & Tops", "tops", "top", "base", 1, 3),
  c("polo", "Poloshirts", "tops", "top", "base", 1, 2.5),
  c("sweater", "Pullover", "tops", "top", "mid", 3, 2.5, { standalone: true }),
  c("hoodie", "Hoodies", "tops", "top", "mid", 3, 1, { standalone: true }),
  c("sweatshirt", "Sweatshirts", "tops", "top", "mid", 3, 1.5, { standalone: true }),
  c("cardigan", "Strickjacken", "tops", "top", "mid", 2.5, 2.5, { standalone: false }),

  c("jeans", "Jeans", "bottoms", "bottom", "none", 2, 2, { beltLoops: true, legCoverage: "full" }),
  c("trousers", "Stoffhosen", "bottoms", "bottom", "none", 2, 3.5, { beltLoops: true, legCoverage: "full" }),
  c("chinos", "Chinos", "bottoms", "bottom", "none", 2, 2.8, { beltLoops: true, legCoverage: "full" }),
  c("cargo", "Cargo-Hosen", "bottoms", "bottom", "none", 2, 1.3, { beltLoops: true, legCoverage: "full" }),
  c("shorts", "Shorts", "bottoms", "bottom", "none", 0.5, 1.3, { legCoverage: "short" }),
  c("joggers", "Jogginghosen", "bottoms", "bottom", "none", 2, 1, { legCoverage: "full" }),
  c("skirt", "Röcke", "bottoms", "bottom", "none", 1, 2.8, { legCoverage: "short" }),

  c("blazer", "Blazer & Sakkos", "more", "top", "mid", 1.5, 4, { standalone: false }),
  c("jacket", "Jacken", "more", "outer", "outer", 2.5, 2),
  c("coat", "Mäntel", "more", "outer", "outer", 4.5, 3.5),
  c("suit", "Anzüge", "more", "suit", "mid", 2, 4.6, { legCoverage: "full" }),
  c("dress", "Kleider", "more", "onepiece", "base", 1, 3, { legCoverage: "short" }),
  c("sportswear", "Sportkleidung", "more", "top", "base", 1, 0.7),

  c("sneakers", "Sneaker", "shoes", "shoes", "none", 1, 1.6),
  c("dress_shoes", "Elegante Schuhe", "shoes", "shoes", "none", 1, 4.5),
  c("boots", "Boots", "shoes", "shoes", "none", 2.5, 3),
  c("sandals", "Sandalen", "shoes", "shoes", "none", 0, 1.5),
  c("sport_shoes", "Sportschuhe", "shoes", "shoes", "none", 1, 0.6),

  c("headwear", "Caps & Mützen", "accessories", "accessory", "none", 0.5, 1.2, { accessoryKind: "head" }),
  c("belt", "Gürtel", "accessories", "accessory", "none", 0, 3, { accessoryKind: "belt" }),
  c("bag", "Taschen", "accessories", "accessory", "none", 0, 2.8, { accessoryKind: "bag" }),
  c("watch", "Uhren", "accessories", "accessory", "none", 0, 3.2, { accessoryKind: "watch" }),
  c("jewelry", "Schmuck", "accessories", "accessory", "none", 0, 3.2, { accessoryKind: "jewelry" }),
  c("scarf", "Schals", "accessories", "accessory", "none", 1, 2.6, { accessoryKind: "scarf" }),
];

export const DEFAULT_CATEGORY_KEYS = DEFAULT_CATEGORIES.map((d) => d.key) as [string, ...string[]];

export const GROUP_DEFAULT_SLOT: Record<GroupId, Slot> = {
  tops: "top",
  bottoms: "bottom",
  more: "outer",
  shoes: "shoes",
  accessories: "accessory",
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const STYLES = [
  { id: "streetwear", label: "Streetwear" },
  { id: "casual", label: "Casual" },
  { id: "smart_casual", label: "Smart Casual" },
  { id: "old_money", label: "Old Money" },
  { id: "minimal", label: "Minimalistisch" },
  { id: "vintage", label: "Vintage" },
  { id: "grunge", label: "Grunge" },
  { id: "sporty", label: "Sporty" },
  { id: "elegant", label: "Elegant" },
  { id: "business", label: "Business" },
  { id: "skater", label: "Skater" },
  { id: "y2k", label: "Y2K" },
  { id: "preppy", label: "Preppy" },
  { id: "dark_academia", label: "Dark Academia" },
] as const;
export type StyleId = (typeof STYLES)[number]["id"];
export const STYLE_IDS = STYLES.map((s) => s.id) as [StyleId, ...StyleId[]];

/** Symmetric similarity between styles (0..1). Unlisted pairs fall back to STYLE_DEFAULT_SIM. */
const STYLE_SIM_PAIRS: [StyleId, StyleId, number][] = [
  ["streetwear", "skater", 0.85],
  ["streetwear", "y2k", 0.6],
  ["streetwear", "sporty", 0.65],
  ["streetwear", "casual", 0.6],
  ["streetwear", "grunge", 0.5],
  ["streetwear", "minimal", 0.45],
  ["casual", "smart_casual", 0.6],
  ["casual", "minimal", 0.6],
  ["casual", "sporty", 0.5],
  ["casual", "preppy", 0.5],
  ["casual", "vintage", 0.5],
  ["casual", "skater", 0.5],
  ["casual", "y2k", 0.4],
  ["casual", "grunge", 0.4],
  ["smart_casual", "business", 0.65],
  ["smart_casual", "old_money", 0.65],
  ["smart_casual", "preppy", 0.6],
  ["smart_casual", "minimal", 0.6],
  ["smart_casual", "elegant", 0.55],
  ["old_money", "preppy", 0.85],
  ["old_money", "elegant", 0.75],
  ["old_money", "business", 0.55],
  ["old_money", "dark_academia", 0.55],
  ["old_money", "minimal", 0.5],
  ["minimal", "elegant", 0.6],
  ["minimal", "business", 0.55],
  ["minimal", "sporty", 0.4],
  ["vintage", "grunge", 0.5],
  ["vintage", "dark_academia", 0.6],
  ["vintage", "y2k", 0.45],
  ["vintage", "preppy", 0.4],
  ["grunge", "skater", 0.6],
  ["grunge", "dark_academia", 0.35],
  ["sporty", "y2k", 0.4],
  ["sporty", "skater", 0.45],
  ["elegant", "business", 0.65],
  ["business", "preppy", 0.45],
  ["skater", "y2k", 0.4],
  ["preppy", "dark_academia", 0.5],
  ["minimal", "dark_academia", 0.4],
];
const STYLE_DEFAULT_SIM = 0.2;
const styleSimMap = new Map<string, number>();
for (const [a, b, v] of STYLE_SIM_PAIRS) {
  styleSimMap.set(`${a}|${b}`, v);
  styleSimMap.set(`${b}|${a}`, v);
}
export function styleSimilarity(a: StyleId, b: StyleId): number {
  if (a === b) return 1;
  return styleSimMap.get(`${a}|${b}`) ?? STYLE_DEFAULT_SIM;
}

// ---------------------------------------------------------------------------
// Occasions
// ---------------------------------------------------------------------------

export const OCCASIONS = [
  { id: "alltag", label: "Alltag", formality: 2 },
  { id: "schule_arbeit", label: "Schule / Arbeit", formality: 2.7 },
  { id: "freunde", label: "Treffen mit Freunden", formality: 2 },
  { id: "party", label: "Party", formality: 3 },
  { id: "restaurant", label: "Restaurant", formality: 3.3 },
  { id: "feier", label: "Feier", formality: 4 },
  { id: "sport", label: "Sport", formality: 0.8 },
  { id: "reise", label: "Reise", formality: 1.8 },
  { id: "formell", label: "Formeller Anlass", formality: 4.7 },
] as const;
export type OccasionId = (typeof OCCASIONS)[number]["id"];
export const OCCASION_IDS = OCCASIONS.map((o) => o.id) as [OccasionId, ...OccasionId[]];

// ---------------------------------------------------------------------------
// Patterns, fits, seasons, confidence
// ---------------------------------------------------------------------------

export const PATTERNS = [
  { id: "uni", label: "Uni", boldness: 0 },
  { id: "gestreift", label: "Gestreift", boldness: 0.4 },
  { id: "kariert", label: "Kariert", boldness: 0.5 },
  { id: "gepunktet", label: "Gepunktet", boldness: 0.5 },
  { id: "floral", label: "Floral", boldness: 0.7 },
  { id: "animal", label: "Animal Print", boldness: 0.8 },
  { id: "camouflage", label: "Camouflage", boldness: 0.7 },
  { id: "grafik", label: "Grafik / Print", boldness: 0.6 },
  { id: "logo", label: "Logo", boldness: 0.3 },
  { id: "colorblock", label: "Colorblock", boldness: 0.6 },
  { id: "paisley", label: "Paisley", boldness: 0.7 },
  { id: "argyle", label: "Argyle / Rauten", boldness: 0.5 },
  { id: "sonstiges", label: "Sonstiges Muster", boldness: 0.5 },
] as const;
export type PatternId = (typeof PATTERNS)[number]["id"];
export const PATTERN_IDS = PATTERNS.map((p) => p.id) as [PatternId, ...PatternId[]];
export const patternBoldness = (p: PatternId) => PATTERNS.find((x) => x.id === p)?.boldness ?? 0.5;

export const FITS = [
  { id: "eng", label: "Eng / Slim" },
  { id: "normal", label: "Regular" },
  { id: "locker", label: "Locker / Relaxed" },
  { id: "oversized", label: "Oversized" },
] as const;
export type FitId = (typeof FITS)[number]["id"];
export const FIT_IDS = FITS.map((f) => f.id) as [FitId, ...FitId[]];

export const SEASONS = [
  { id: "fruehling", label: "Frühling" },
  { id: "sommer", label: "Sommer" },
  { id: "herbst", label: "Herbst" },
  { id: "winter", label: "Winter" },
] as const;
export type SeasonId = (typeof SEASONS)[number]["id"];
export const SEASON_IDS = SEASONS.map((s) => s.id) as [SeasonId, ...SeasonId[]];

export const ITEM_STATUSES = [
  { id: "available", label: "Verfügbar" },
  { id: "laundry", label: "In der Wäsche" },
  { id: "cleaning", label: "In der Reinigung" },
  { id: "unavailable", label: "Nicht verfügbar" },
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number]["id"];
export const ITEM_STATUS_IDS = ITEM_STATUSES.map((s) => s.id) as [ItemStatus, ...ItemStatus[]];

export const MATERIAL_SUGGESTIONS = [
  "Baumwolle",
  "Denim",
  "Wolle",
  "Kaschmir",
  "Leinen",
  "Leder",
  "Wildleder",
  "Cord",
  "Strick",
  "Jersey",
  "Fleece",
  "Seide",
  "Viskose",
  "Polyester",
  "Nylon",
  "Daune",
  "Canvas",
];

export function seasonForDate(d: Date): SeasonId {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 5) return "fruehling";
  if (m >= 6 && m <= 8) return "sommer";
  if (m >= 9 && m <= 11) return "herbst";
  return "winter";
}

export const labelOf = {
  style: (id: string) => STYLES.find((s) => s.id === id)?.label ?? id,
  occasion: (id: string) => OCCASIONS.find((s) => s.id === id)?.label ?? id,
  pattern: (id: string) => PATTERNS.find((s) => s.id === id)?.label ?? id,
  fit: (id: string) => FITS.find((s) => s.id === id)?.label ?? id,
  season: (id: string) => SEASONS.find((s) => s.id === id)?.label ?? id,
  status: (id: string) => ITEM_STATUSES.find((s) => s.id === id)?.label ?? id,
  group: (id: string) => GROUPS.find((s) => s.id === id)?.label ?? id,
};
