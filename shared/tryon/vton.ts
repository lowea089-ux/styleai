// What Decart's Lucy VTON needs for a try-on: the garments for the reference image (top above bottom, as in
// Decart's outfit-builder example) and an English instruction in the style of Decart's examples
// ("Substitute the current top with a navy blue hoodie …"). Only real wardrobe items are used.
import type { Category, ClothingItem, OutfitItemRef, OutfitRole } from "../types";

const COLOR_EN: Record<string, string> = {
  schwarz: "black",
  anthrazit: "charcoal",
  grau: "grey",
  hellgrau: "light grey",
  weiss: "white",
  creme: "cream",
  beige: "beige",
  camel: "camel",
  braun: "brown",
  khaki: "khaki",
  oliv: "olive",
  navy: "navy blue",
  jeansblau: "denim blue",
  hellblau: "light blue",
  blau: "blue",
  petrol: "petrol blue",
  tuerkis: "turquoise",
  dunkelgruen: "dark green",
  gruen: "green",
  mint: "mint green",
  lila: "purple",
  flieder: "lilac",
  rosa: "light pink",
  pink: "pink",
  rot: "red",
  bordeaux: "burgundy",
  orange: "orange",
  terracotta: "terracotta",
  senf: "mustard yellow",
  gelb: "yellow",
  gold: "gold",
  silber: "silver",
};

const GARMENT_EN: Record<string, string> = {
  tshirt: "t-shirt",
  longsleeve: "long-sleeve shirt",
  shirt: "button-up shirt",
  blouse: "blouse",
  polo: "polo shirt",
  sweater: "knit sweater",
  hoodie: "hoodie",
  sweatshirt: "sweatshirt",
  cardigan: "cardigan",
  jeans: "jeans",
  trousers: "tailored trousers",
  chinos: "chinos",
  cargo: "cargo pants",
  shorts: "shorts",
  joggers: "joggers",
  skirt: "skirt",
  blazer: "blazer",
  jacket: "jacket",
  coat: "coat",
  suit: "suit",
  dress: "dress",
  sportswear: "sports top",
  sneakers: "sneakers",
  dress_shoes: "dress shoes",
  boots: "boots",
  sandals: "sandals",
  sport_shoes: "running shoes",
  headwear: "cap",
  scarf: "scarf",
};

/** Fallback noun by outfit slot for custom categories. */
const SLOT_EN: Record<string, string> = { top: "top", bottom: "pants", onepiece: "dress", suit: "suit", outer: "jacket", shoes: "shoes", accessory: "accessory" };

const PATTERN_EN: Record<string, string> = {
  gestreift: "striped",
  kariert: "checked",
  gepunktet: "polka-dot",
  floral: "floral",
  animal: "animal-print",
  camouflage: "camouflage",
  grafik: "graphic-print",
  logo: "logo",
  colorblock: "color-block",
  paisley: "paisley",
  argyle: "argyle",
};

const MATERIAL_EN: Record<string, string> = {
  baumwolle: "cotton",
  denim: "denim",
  wolle: "wool",
  kaschmir: "cashmere",
  leinen: "linen",
  leder: "leather",
  wildleder: "suede",
  cord: "corduroy",
  strick: "knit",
  jersey: "jersey",
  fleece: "fleece",
  seide: "silk",
  nylon: "nylon",
  daune: "down",
  canvas: "canvas",
};

const PLURAL = new Set(["jeans", "tailored trousers", "chinos", "cargo pants", "shorts", "joggers", "pants", "sneakers", "dress shoes", "boots", "sandals", "running shoes", "shoes"]);

export interface VtonGarment {
  item: ClothingItem;
  category: Category | undefined;
  role: OutfitRole;
}

export interface VtonPlan {
  key: string;
  /** German label for the selection chip. */
  label: string;
  /** Items whose photos form the reference image, top to bottom. */
  itemIds: string[];
  prompt: string;
}

function noun(g: VtonGarment): string {
  const key = g.category?.key;
  return (key && GARMENT_EN[key]) || SLOT_EN[g.item.slotOverride ?? g.category?.slot ?? "top"] || "garment";
}

/** e.g. "navy blue striped wool knit sweater" – built only from stored attributes. */
export function describeGarment(g: VtonGarment): string {
  const n = noun(g);
  const words: string[] = [];
  const [c1, c2] = g.item.colors;
  if (c1 && COLOR_EN[c1.family]) words.push(COLOR_EN[c1.family]);
  if (c2 && c2.ratio >= 0.2 && COLOR_EN[c2.family] && c2.family !== c1?.family) words.push("and", COLOR_EN[c2.family]);
  if (PATTERN_EN[g.item.pattern]) words.push(PATTERN_EN[g.item.pattern]);
  const mat = g.item.material ? MATERIAL_EN[g.item.material.trim().toLowerCase()] : undefined;
  if (mat && !n.split(" ").includes(mat)) words.push(mat);
  words.push(n);
  return words.join(" ");
}

const withArticle = (phrase: string, plural: boolean) => (plural ? phrase : `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`);
const phrase = (g: VtonGarment) => withArticle(describeGarment(g), PLURAL.has(noun(g)));

function target(g: VtonGarment): string {
  if (g.role === "shoes") return "shoes";
  if (g.role === "acc:head") return "headwear";
  if (g.role === "onepiece" || g.role === "suit") return "outfit";
  if (g.role === "bottom") return noun(g) === "skirt" || noun(g) === "shorts" ? "bottoms" : "pants";
  return "top";
}

const UPPER: OutfitRole[] = ["outer", "mid", "top", "base"];

export function collectGarments(refs: OutfitItemRef[], items: Map<string, ClothingItem>, cats: Map<string, Category>): VtonGarment[] {
  return refs.flatMap((r) => {
    const item = items.get(r.itemId);
    return item ? [{ item, category: cats.get(item.categoryId), role: r.role }] : [];
  });
}

/** Selection options for the live try-on: the whole outfit first, then each wearable piece alone. */
export function vtonPlans(garments: VtonGarment[]): VtonPlan[] {
  const byRole = (roles: OutfitRole[]) => roles.map((r) => garments.find((g) => g.role === r)).filter((g): g is VtonGarment => !!g);
  const uppers = byRole(UPPER);
  const bottom = garments.find((g) => g.role === "bottom");
  const full = garments.find((g) => g.role === "onepiece" || g.role === "suit");
  const plans: VtonPlan[] = [];

  // Upper body: outermost layer in the image, the one underneath named in the text.
  const [outer, inner] = uppers;
  const upperText = outer ? (inner ? `${phrase(outer)} worn over ${phrase(inner)}` : phrase(outer)) : null;
  let whole: VtonPlan | null = null;
  if (full) {
    const over = outer && outer.role === "outer" ? ` with ${phrase(outer)} worn over it` : "";
    whole = { key: "outfit", label: "Ganzes Outfit", itemIds: [full.item.id], prompt: `Substitute the current outfit with ${phrase(full)}${over}` };
  } else if (outer && bottom) {
    whole = { key: "outfit", label: "Ganzes Outfit", itemIds: [outer.item.id, bottom.item.id], prompt: `Substitute the current outfit with ${upperText} on top and ${phrase(bottom)} on the bottom` };
  }
  if (whole) plans.push(whole);

  for (const g of garments) {
    if (!["outer", "mid", "top", "base", "bottom", "onepiece", "suit", "shoes", "acc:head"].includes(g.role)) continue;
    plans.push({ key: g.item.id, label: g.item.name, itemIds: [g.item.id], prompt: `Substitute the current ${target(g)} with ${phrase(g)}` });
  }
  // A layered top without trousers: offer the layers together as well.
  if (!whole && outer && inner) plans.unshift({ key: "outfit", label: "Ganzes Outfit", itemIds: [outer.item.id], prompt: `Substitute the current top with ${upperText}` });
  return plans;
}
