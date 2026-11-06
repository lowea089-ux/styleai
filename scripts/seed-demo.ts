// Creates a local demo account with a clearly marked sample wardrobe ("Beispieldaten").
// Images are simple drawn silhouettes, not photos. Usage: npm run seed:demo
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getFamily, type ColorFamilyId } from "../shared/color";
import type { ItemInput } from "../shared/schemas";
import { hashPassword } from "../server/auth";
import { loadConfig } from "../server/config";
import { openDatabase } from "../server/db";
import { ImageStore, processGarmentImage } from "../server/images";
import * as repo from "../server/repo";
import path from "node:path";

const EMAIL = process.env.DEMO_EMAIL ?? "demo@styleai.test";
const PASSWORD = process.env.DEMO_PASSWORD ?? "styleai-demo-2026";

const SHAPES: Record<string, string> = {
  tee: "M62 48 L100 26 Q120 40 140 26 L178 48 L204 98 L172 110 L172 222 L68 222 L68 110 L36 98 Z",
  shirt: "M62 44 L104 24 L120 44 L136 24 L178 44 L214 196 L188 204 L172 120 L172 226 L68 226 L68 120 L52 204 L26 196 Z M120 44 L120 226",
  sweater: "M60 44 Q120 20 180 44 L216 200 Q204 214 188 206 L172 116 L174 224 L66 224 L68 116 L52 206 Q36 214 24 200 Z",
  hoodie: "M60 52 Q74 8 120 10 Q166 8 180 52 L216 202 Q204 214 188 206 L172 118 L174 226 L66 226 L68 118 L52 206 Q36 214 24 200 Z M98 52 Q120 74 142 52",
  pants: "M72 16 L168 16 L178 228 L132 228 L120 86 L108 228 L62 228 Z",
  shorts: "M66 50 L174 50 L186 170 L132 176 L120 110 L108 176 L54 170 Z",
  jacket: "M58 40 L100 22 L120 52 L140 22 L182 40 L216 204 L188 210 L172 116 L174 222 L66 222 L68 116 L52 210 L24 204 Z M120 52 L120 222",
  coat: "M60 30 L100 14 L120 48 L140 14 L180 30 L212 210 L186 214 L176 110 L184 232 L56 232 L64 110 L54 214 L28 210 Z M120 48 L120 232",
  sneaker: "M24 150 Q26 118 64 114 L104 100 Q126 96 140 118 Q170 130 206 138 Q222 146 216 170 L28 170 Z",
  boot: "M70 40 L132 40 L136 132 Q176 140 204 152 Q218 162 212 182 L56 182 Q58 140 70 128 Z",
  loafer: "M30 150 Q34 124 74 120 L130 116 Q172 122 204 140 Q220 152 212 168 L34 168 Z",
  cap: "M48 140 Q50 70 120 66 Q190 70 192 140 Z M150 136 Q200 130 224 150 Q200 160 150 150 Z",
  belt: "M16 106 L224 106 L224 134 L16 134 Z M150 98 L184 98 L184 142 L150 142 Z",
  scarf: "M90 10 L150 10 L150 180 L170 230 L136 230 L124 190 L112 230 L78 230 L90 180 Z",
  bag: "M50 90 L190 90 L200 220 L40 220 Z M84 90 Q84 40 120 40 Q156 40 156 90",
  dress: "M88 18 L104 18 Q120 40 136 18 L152 18 L160 84 L206 228 L34 228 L80 84 Z",
};

async function silhouette(shape: string, color: ColorFamilyId) {
  const hex = getFamily(color)!.hex;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 240 240">
    <path d="${SHAPES[shape]}" fill="${hex}" stroke="rgba(0,0,0,0.28)" stroke-width="2.4" stroke-linejoin="round"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

type Seed = [shape: string, key: string, color: ColorFamilyId, name: string, extra?: Partial<ItemInput>];
const ITEMS: Seed[] = [
  ["tee", "tshirt", "weiss", "Weißes T-Shirt", { styles: ["casual", "minimal", "streetwear"], material: "Baumwolle" }],
  ["tee", "tshirt", "schwarz", "Schwarzes T-Shirt", { styles: ["streetwear", "minimal", "grunge"] }],
  ["shirt", "shirt", "hellblau", "Hellblaues Oxford-Hemd", { styles: ["smart_casual", "business", "preppy"], formality: 3.5 }],
  ["sweater", "sweater", "navy", "Navy Strickpullover", { styles: ["preppy", "old_money", "smart_casual"], material: "Wolle", seasons: ["herbst", "winter"] }],
  ["sweater", "sweater", "bordeaux", "Bordeaux Rollkragen", { subtype: "Rollkragenpullover", styles: ["dark_academia", "old_money", "elegant"], seasons: ["herbst", "winter"] }],
  ["hoodie", "hoodie", "grau", "Grauer Hoodie", { styles: ["streetwear", "sporty", "casual"] }],
  ["pants", "jeans", "jeansblau", "Blaue Straight-Jeans", { styles: ["casual", "streetwear"], material: "Denim", fit: "normal" }],
  ["pants", "chinos", "beige", "Beige Chino", { styles: ["smart_casual", "preppy", "old_money"], fit: "normal" }],
  ["pants", "trousers", "anthrazit", "Anthrazit Stoffhose", { styles: ["business", "elegant", "minimal"], fit: "eng" }],
  ["pants", "cargo", "oliv", "Oliv Cargo-Hose", { styles: ["streetwear", "skater"], fit: "locker" }],
  ["shorts", "shorts", "khaki", "Khaki Shorts", { styles: ["casual"], seasons: ["sommer"] }],
  ["jacket", "jacket", "braun", "Braune Bomberjacke", { subtype: "Bomberjacke", material: "Leder", styles: ["streetwear", "casual", "vintage"], warmth: 2.5 }],
  ["coat", "coat", "camel", "Camel Mantel", { styles: ["old_money", "elegant", "smart_casual"], material: "Wolle", warmth: 4.5, seasons: ["herbst", "winter"] }],
  ["jacket", "jacket", "schwarz", "Schwarze Regenjacke", { subtype: "Regenjacke", material: "Nylon", styles: ["sporty", "minimal"], warmth: 2, tags: ["wasserabweisend"] }],
  ["dress", "dress", "schwarz", "Schwarzes Kleid", { styles: ["elegant", "minimal"], formality: 3.8 }],
  ["sneaker", "sneakers", "weiss", "Weiße Sneaker", { styles: ["casual", "streetwear", "minimal"] }],
  ["boot", "boots", "schwarz", "Schwarze Chelsea Boots", { subtype: "Chelsea Boots", styles: ["grunge", "smart_casual", "minimal"], material: "Leder" }],
  ["loafer", "dress_shoes", "braun", "Braune Loafer", { styles: ["old_money", "preppy", "smart_casual"], material: "Leder" }],
  ["cap", "headwear", "schwarz", "Schwarze Cap", { styles: ["streetwear", "sporty"] }],
  ["belt", "belt", "braun", "Brauner Ledergürtel", { styles: ["smart_casual", "old_money"], material: "Leder" }],
  ["scarf", "scarf", "grau", "Grauer Wollschal", { styles: ["minimal", "casual"], material: "Wolle", seasons: ["winter", "herbst"] }],
  ["bag", "bag", "schwarz", "Schwarze Umhängetasche", { styles: ["minimal", "smart_casual"] }],
];

const cfg = loadConfig();
const db = openDatabase(cfg.dataDir);
const store = new ImageStore(path.join(cfg.dataDir, "uploads"));

const existing = repo.findUserByEmail(db, EMAIL);
if (existing) {
  repo.deleteUser(db, existing.id);
  await store.removeUser(existing.id);
}
const user = repo.createUser(db, EMAIL, await hashPassword(PASSWORD), "Demo");
repo.updatePreferences(db, user.id, {
  onboardingCompleted: true,
  preferredStyles: ["smart_casual", "minimal"],
  typicalOccasions: ["alltag", "schule_arbeit"],
  locationName: "Hamburg",
  locationLat: 53.55,
  locationLon: 9.99,
});
const cats = new Map(repo.listCategories(db, user.id).map((c) => [c.key, c]));
for (const [shape, key, color, name, extra] of ITEMS) {
  const cat = cats.get(key)!;
  const { main, thumb } = await processGarmentImage(await silhouette(shape, color), cfg.maxUploadBytes);
  const id = randomUUID();
  const paths = await store.save(user.id, id, main, thumb);
  repo.createItem(
    db,
    user.id,
    {
      categoryId: cat.id,
      subtype: null,
      name,
      colors: [{ family: color, hex: getFamily(color)!.hex, ratio: 0.95 }],
      pattern: "uni",
      material: null,
      fit: null,
      styles: [],
      seasons: [],
      occasions: [],
      formality: cat.formality,
      warmth: cat.warmth,
      slotOverride: null,
      description: "Beispieldaten – gezeichnete Silhouette, kein echtes Foto.",
      brand: null,
      purchaseDate: null,
      priceCents: null,
      status: "available",
      favorite: false,
      aiAnalyzed: false,
      aiConfidence: null,
      ...extra,
      tags: ["Beispieldaten", ...(extra?.tags ?? [])],
    },
    paths,
    id,
  );
}
console.log(`Demo-Konto angelegt: ${EMAIL} (${ITEMS.length} Beispiel-Teile). Passwort siehe README bzw. DEMO_PASSWORD.`);
