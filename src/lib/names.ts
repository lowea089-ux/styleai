import { colorLabel } from "../../shared/color";
import type { Category } from "../../shared/types";

const SINGULAR: Record<string, string> = {
  tshirt: "T-Shirt",
  longsleeve: "Langarmshirt",
  shirt: "Hemd",
  blouse: "Bluse",
  polo: "Poloshirt",
  sweater: "Pullover",
  hoodie: "Hoodie",
  sweatshirt: "Sweatshirt",
  cardigan: "Strickjacke",
  jeans: "Jeans",
  trousers: "Stoffhose",
  chinos: "Chino",
  cargo: "Cargo-Hose",
  shorts: "Shorts",
  joggers: "Jogginghose",
  skirt: "Rock",
  blazer: "Blazer",
  jacket: "Jacke",
  coat: "Mantel",
  suit: "Anzug",
  dress: "Kleid",
  sportswear: "Sportteil",
  sneakers: "Sneaker",
  dress_shoes: "Lederschuhe",
  boots: "Boots",
  sandals: "Sandalen",
  sport_shoes: "Sportschuhe",
  headwear: "Cap",
  belt: "Gürtel",
  bag: "Tasche",
  watch: "Uhr",
  jewelry: "Schmuck",
  scarf: "Schal",
};

export const singularOf = (c: Category | undefined) => (c ? (c.key && SINGULAR[c.key]) || c.name : "Kleidungsstück");

export function suggestName(category: Category | undefined, primaryColor: string | undefined) {
  const base = singularOf(category);
  return primaryColor ? `${base} in ${colorLabel(primaryColor)}` : base;
}
