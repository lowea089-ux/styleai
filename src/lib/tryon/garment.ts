// Prepares wardrobe items for the try-on: loads the stored cut-out, removes the background if the item was
// saved with its original photo, analyses the shape and splits it into drawable pieces.
import { analyzeGarment, type GarmentKind, type GarmentShape } from "../../../shared/tryon/anchors";
import type { PieceId } from "../../../shared/tryon/layout";
import type { Category, ClothingItem, OutfitRole } from "../../../shared/types";
import { removeBackground } from "../image";

export interface PreparedGarment {
  itemId: string;
  name: string;
  role: OutfitRole;
  kind: GarmentKind;
  /** Draw order: lower first. */
  order: number;
  image: HTMLCanvasElement;
  /** Small data URL for the garment chips. */
  thumb: string;
  shape: GarmentShape;
  /** Image pixels per shape-analysis pixel. */
  scale: number;
  pieces: Partial<Record<PieceId, HTMLCanvasElement>>;
  legCoverage: "full" | "short" | "none";
  /** Outer layers are drawn a little larger so they cover what is underneath. */
  sizeBoost: number;
  warning?: string;
}

export function kindForRole(role: OutfitRole): GarmentKind | null {
  switch (role) {
    case "top":
    case "base":
    case "mid":
    case "outer":
      return "top";
    case "onepiece":
    case "suit":
      return "onepiece";
    case "bottom":
      return "bottom";
    case "shoes":
      return "shoes";
    case "acc:head":
      return "head";
    case "acc:scarf":
      return "scarf";
    case "acc:belt":
      return "belt";
    case "acc:bag":
      return "bag";
    case "acc:watch":
      return "watch";
    default:
      // Jewelry and other small accessories are too small to place convincingly.
      return null;
  }
}

const ORDER: Record<string, number> = {
  shoes: 10,
  bottom: 20,
  "acc:belt": 25,
  onepiece: 30,
  suit: 30,
  top: 40,
  base: 40,
  mid: 50,
  outer: 60,
  "acc:scarf": 70,
  "acc:watch": 80,
  "acc:bag": 85,
  "acc:head": 90,
};

const MAX_SIDE = 900;
const SHAPE_SIDE = 220;

async function loadItemImage(url: string): Promise<HTMLCanvasElement> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Bild konnte nicht geladen werden.");
  const bmp = await createImageBitmap(await res.blob());
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

function transparentShare(c: HTMLCanvasElement) {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let t = 0;
  let n = 0;
  for (let i = 3; i < d.length; i += 64) {
    n++;
    if (d[i] < 200) t++;
  }
  return t / Math.max(1, n);
}

type Rect = [x0: number, y0: number, x1: number, y1: number];

/** Copy of `src` restricted to the union of rectangles (other pixels transparent). */
function crop(src: HTMLCanvasElement, ...rects: Rect[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of rects) ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  ctx.drawImage(src, 0, 0);
  return c;
}

function buildPieces(img: HTMLCanvasElement, shape: GarmentShape, k: number): PreparedGarment["pieces"] {
  const W = img.width;
  const H = img.height;
  if (shape.kind === "top" || shape.kind === "onepiece") {
    const yl = shape.sleeveYLimit * k;
    const ya = shape.yArm * k;
    const torso = crop(img, [0, 0, W, H]);
    const tctx = torso.getContext("2d")!;
    const pieces: PreparedGarment["pieces"] = { torso };
    // Sleeves reach 2 px into the torso along the armhole only, so the joint has no visible seam.
    if (shape.sleeves.left) {
      tctx.clearRect(0, 0, (shape.lT - 1) * k, yl);
      pieces.sleeveL = crop(img, [0, 0, (shape.lT + 2) * k, ya], [0, ya, (shape.lT - 1) * k, yl]);
    }
    if (shape.sleeves.right) {
      tctx.clearRect((shape.rT + 1) * k, 0, W, yl);
      pieces.sleeveR = crop(img, [(shape.rT - 2) * k, 0, W, ya], [(shape.rT + 1) * k, ya, W, yl]);
    }
    return pieces;
  }
  if (shape.kind === "bottom" && shape.legs && shape.yCrotch !== null) {
    const yc = shape.yCrotch * k;
    return {
      pelvis: crop(img, [0, 0, W, yc + 2 * k]),
      legL: crop(img, [0, yc - 2 * k, shape.splitX * k, H]),
      legR: crop(img, [shape.splitX * k, yc - 2 * k, W, H]),
    };
  }
  return { whole: img };
}

export async function prepareGarment(item: ClothingItem, category: Category | undefined, role: OutfitRole): Promise<PreparedGarment | null> {
  const kind = kindForRole(role);
  if (!kind) return null;
  let image = await loadItemImage(item.imageUrl);
  let warning: string | undefined;
  if (transparentShare(image) < 0.02) {
    // Saved as "Original" with background: cut it out on the fly for the try-on.
    const cut = removeBackground(image, 20);
    image = cut.canvas;
    if (!cut.confident) warning = "Hintergrund ließ sich nicht sicher entfernen";
  }
  const s = Math.min(1, SHAPE_SIDE / Math.max(image.width, image.height));
  const w = Math.max(8, Math.round(image.width * s));
  const h = Math.max(8, Math.round(image.height * s));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(image, 0, 0, w, h);
  const px = sctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
  const shape = analyzeGarment(alpha, w, h, kind);
  if (!shape) return null;
  const k = image.width / w;
  const ts = Math.min(1, 96 / Math.max(image.width, image.height));
  const tc = document.createElement("canvas");
  tc.width = Math.max(1, Math.round(image.width * ts));
  tc.height = Math.max(1, Math.round(image.height * ts));
  tc.getContext("2d")!.drawImage(image, 0, 0, tc.width, tc.height);
  return {
    itemId: item.id,
    name: item.name,
    role,
    kind,
    order: ORDER[role] ?? 45,
    image,
    thumb: tc.toDataURL("image/png"),
    shape,
    scale: k,
    pieces: buildPieces(image, shape, k),
    legCoverage: category?.legCoverage ?? "full",
    sizeBoost: role === "outer" ? 1.1 : role === "mid" ? 1.04 : 1,
    warning,
  };
}
