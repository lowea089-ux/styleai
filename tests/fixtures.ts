import { getFamily, type ColorFamilyId } from "../shared/color";
import { buildContext, toEngineItems, type ProfileInput } from "../shared/engine/context";
import { generateRequestSchema, type GenerateRequestInput } from "../shared/schemas";
import { DEFAULT_CATEGORIES } from "../shared/taxonomy";
import type { Category, ClothingItem } from "../shared/types";

export const categories: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({
  ...c,
  id: `cat-${c.key}`,
  sortOrder: i,
  isDefault: true,
}));

let n = 0;
export function item(key: string, color: ColorFamilyId, extra: Partial<ClothingItem> = {}): ClothingItem {
  const cat = categories.find((c) => c.key === key)!;
  const id = extra.id ?? `${key}-${color}-${++n}`;
  return {
    id,
    categoryId: cat.id,
    subtype: null,
    name: `${cat.name} ${color}`,
    imageUrl: "",
    thumbUrl: "",
    colors: [{ family: color, hex: getFamily(color)!.hex, ratio: 0.9 }],
    pattern: "uni",
    material: null,
    fit: null,
    styles: [],
    seasons: [],
    occasions: [],
    formality: cat.formality,
    warmth: cat.warmth,
    slotOverride: null,
    description: "",
    brand: null,
    purchaseDate: null,
    priceCents: null,
    status: "available",
    favorite: false,
    tags: [],
    aiAnalyzed: false,
    aiConfidence: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wearCount: 0,
    lastWornOn: null,
    ...extra,
  };
}

export const profile: ProfileInput = {
  preferredStyles: [],
  favoriteColors: [],
  avoidedColors: [],
  experimental: 0.3,
  boldness: 0.4,
  personalizationEnabled: true,
  avoidRepeatDays: 7,
};

export function ctx(req: GenerateRequestInput = {}, extra: Partial<Parameters<typeof buildContext>[0]> = {}) {
  return buildContext({ request: generateRequestSchema.parse({ seed: 7, ...req }), profile, today: new Date("2026-10-27T12:00:00"), ...extra });
}

export const engine = (items: ClothingItem[]) => toEngineItems(items, categories, new Date("2026-10-27T12:00:00"));

/** A small but realistic wardrobe. */
export function wardrobe() {
  return [
    item("tshirt", "weiss", { id: "tee-white", styles: ["casual", "minimal", "streetwear"] }),
    item("tshirt", "schwarz", { id: "tee-black", styles: ["streetwear", "minimal"] }),
    item("shirt", "hellblau", { id: "shirt-blue", styles: ["smart_casual", "business"], formality: 3.5 }),
    item("sweater", "navy", { id: "sweater-navy", styles: ["preppy", "smart_casual", "old_money"] }),
    item("hoodie", "grau", { id: "hoodie-grey", styles: ["streetwear", "casual", "sporty"] }),
    item("jeans", "jeansblau", { id: "jeans", styles: ["casual", "streetwear"] }),
    item("chinos", "beige", { id: "chinos", styles: ["smart_casual", "preppy", "old_money"] }),
    item("cargo", "oliv", { id: "cargo", styles: ["streetwear", "skater"] }),
    item("shorts", "beige", { id: "shorts", styles: ["casual"], seasons: ["sommer"] }),
    item("jacket", "schwarz", { id: "jacket", styles: ["streetwear", "casual"], warmth: 2.5 }),
    item("coat", "camel", { id: "coat", styles: ["old_money", "elegant", "smart_casual"], warmth: 4.5 }),
    item("sneakers", "weiss", { id: "sneakers", styles: ["casual", "streetwear", "minimal"] }),
    item("dress_shoes", "braun", { id: "loafers", styles: ["old_money", "smart_casual", "business"] }),
    item("boots", "schwarz", { id: "boots", styles: ["grunge", "casual"] }),
    item("belt", "braun", { id: "belt", styles: ["smart_casual"] }),
    item("headwear", "schwarz", { id: "cap", styles: ["streetwear"] }),
  ];
}
