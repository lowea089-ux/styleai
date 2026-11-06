// Replaces server/images.ts in the browser bundle: decoding and re-encoding with createImageBitmap and
// OffscreenCanvas instead of sharp, photos stored in IndexedDB instead of on disk. Re-encoding drops all
// metadata (EXIF, GPS) exactly like the server version.
import { Buffer } from "buffer";
import type { ImageBackend } from "../store";

export class ImageError extends Error {
  constructor(
    public code: "IMAGE_TOO_LARGE" | "IMAGE_INVALID" | "IMAGE_UNSUPPORTED",
    message: string,
  ) {
    super(message);
  }
}

const MAX_PIXELS = 40_000_000;

function sniff(b: Uint8Array): "jpeg" | "png" | "webp" | "isobmff" | null {
  if (b.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp") return "isobmff";
  return null;
}

async function decode(buf: Uint8Array, maxBytes: number): Promise<ImageBitmap> {
  if (buf.length > maxBytes) throw new ImageError("IMAGE_TOO_LARGE", `Das Bild ist größer als ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const kind = sniff(buf);
  if (!kind) throw new ImageError("IMAGE_INVALID", "Die Datei ist kein unterstütztes Bild (JPEG, PNG, WebP oder AVIF).");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([new Uint8Array(buf)]), { imageOrientation: "from-image" });
  } catch {
    throw new ImageError(
      kind === "isobmff" ? "IMAGE_UNSUPPORTED" : "IMAGE_INVALID",
      kind === "isobmff"
        ? "Dieses HEIC/AVIF-Foto kann der Browser nicht lesen. Bitte das Foto als JPEG speichern oder in der Kamera „Maximale Kompatibilität“ wählen."
        : "Das Bild ist beschädigt oder kann nicht gelesen werden.",
    );
  }
  if (bmp.width * bmp.height > MAX_PIXELS) {
    bmp.close();
    throw new ImageError("IMAGE_TOO_LARGE", "Das Bild hat zu viele Pixel.");
  }
  if (bmp.width < 64 || bmp.height < 64) {
    bmp.close();
    throw new ImageError("IMAGE_INVALID", "Das Bild ist zu klein (mindestens 64 × 64 Pixel).");
  }
  return bmp;
}

/** Scales into a max×max box (never enlarges), halving step by step for a clean downscale. */
async function encode(bmp: ImageBitmap, max: number, type: "image/webp" | "image/jpeg", quality: number, background?: string): Promise<Buffer> {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  let src: CanvasImageSource = bmp;
  let sw = bmp.width;
  let sh = bmp.height;
  while (sw / 2 >= w * 1.5) {
    const half = new OffscreenCanvas(Math.round(sw / 2), Math.round(sh / 2));
    const hc = half.getContext("2d")!;
    hc.imageSmoothingQuality = "high";
    hc.drawImage(src, 0, 0, half.width, half.height);
    src = half;
    sw = half.width;
    sh = half.height;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  // Browsers without a WebP encoder (Safari) return PNG instead – still lossless and transparent.
  const blob = await canvas.convertToBlob({ type, quality });
  return Buffer.from(await blob.arrayBuffer());
}

export async function processGarmentImage(buf: Uint8Array, maxBytes: number) {
  const bmp = await decode(buf, maxBytes);
  try {
    const main = await encode(bmp, 1400, "image/webp", 0.86);
    const thumb = await encode(bmp, 480, "image/webp", 0.8);
    return { main, thumb };
  } finally {
    bmp.close();
  }
}

/** Compact JPEG on white for vision models (transparent cut-outs would otherwise turn black). */
export async function toAnalysisJpeg(buf: Uint8Array, maxBytes: number) {
  const bmp = await decode(buf, maxBytes);
  try {
    return await encode(bmp, 1024, "image/jpeg", 0.85, "#ffffff");
  } finally {
    bmp.close();
  }
}

export async function validateForForwarding(buf: Uint8Array, maxBytes: number) {
  const bmp = await decode(buf, maxBytes);
  try {
    return await encode(bmp, 1600, "image/jpeg", 0.9, "#ffffff");
  } finally {
    bmp.close();
  }
}

const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, "0")).join("");

export class ImageStore {
  /** server/app.ts constructs one with a folder path; web/runtime.ts replaces it with one bound to IndexedDB. */
  constructor(private backend?: ImageBackend | string) {}

  private get b(): ImageBackend {
    if (!this.backend || typeof this.backend === "string") throw new Error("Bildspeicher ist nicht initialisiert.");
    return this.backend;
  }

  async save(userId: string, itemId: string, main: Uint8Array, thumb: Uint8Array) {
    const tag = hex(4);
    const image = `${userId}/${itemId}-${tag}.webp`;
    const thumbRel = `${userId}/${itemId}-${tag}-thumb.webp`;
    await this.b.put(image, main);
    await this.b.put(thumbRel, thumb);
    return { image, thumb: thumbRel };
  }

  async read(rel: string) {
    const bytes = await this.b.get(rel);
    if (!bytes) throw new Error("Bilddatei fehlt.");
    return Buffer.from(bytes);
  }

  async remove(...rels: string[]) {
    await this.b.delete(rels.filter(Boolean)).catch(() => undefined);
  }

  async removeUser(userId: string) {
    await this.b.deletePrefix(`${userId}/`);
  }
}
