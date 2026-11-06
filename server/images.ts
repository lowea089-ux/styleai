// Upload validation, re-encoding (strips EXIF/GPS) and private on-disk storage.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";

export class ImageError extends Error {
  constructor(
    public code: "IMAGE_TOO_LARGE" | "IMAGE_INVALID" | "IMAGE_UNSUPPORTED",
    message: string,
  ) {
    super(message);
  }
}

const MAX_PIXELS = 40_000_000;

function sniff(buf: Buffer): "jpeg" | "png" | "webp" | "isobmff" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") return "isobmff";
  return null;
}

async function validate(buf: Buffer, maxBytes: number) {
  if (buf.length > maxBytes) throw new ImageError("IMAGE_TOO_LARGE", `Das Bild ist größer als ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const kind = sniff(buf);
  if (!kind) throw new ImageError("IMAGE_INVALID", "Die Datei ist kein unterstütztes Bild (JPEG, PNG, WebP oder AVIF).");
  let meta: Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new ImageError(
      kind === "isobmff" ? "IMAGE_UNSUPPORTED" : "IMAGE_INVALID",
      kind === "isobmff"
        ? "HEIC-Fotos können nicht gelesen werden. Bitte das Foto als JPEG speichern oder in der Kamera „Maximale Kompatibilität“ wählen."
        : "Das Bild ist beschädigt oder kann nicht gelesen werden.",
    );
  }
  if (!meta.format || !["jpeg", "png", "webp", "avif", "heif"].includes(meta.format)) {
    throw new ImageError("IMAGE_UNSUPPORTED", "Dieses Bildformat wird nicht unterstützt.");
  }
  if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64) {
    throw new ImageError("IMAGE_INVALID", "Das Bild ist zu klein (mindestens 64 × 64 Pixel).");
  }
}

/** Re-encode to WebP. sharp drops all metadata (EXIF, GPS, ICC is converted to sRGB) by default. */
export async function processGarmentImage(buf: Buffer, maxBytes: number) {
  await validate(buf, maxBytes);
  const base = sharp(buf, { limitInputPixels: MAX_PIXELS }).rotate();
  const main = await base.clone().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 92 }).toBuffer();
  const thumb = await base.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 80, alphaQuality: 85 }).toBuffer();
  return { main, thumb };
}

/** Compact JPEG on white for vision models (transparent cut-outs would otherwise turn black). */
export async function toAnalysisJpeg(buf: Buffer, maxBytes: number) {
  await validate(buf, maxBytes);
  return sharp(buf, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export async function validateForForwarding(buf: Buffer, maxBytes: number) {
  await validate(buf, maxBytes);
  return sharp(buf, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}

export class ImageStore {
  constructor(private root: string) {}

  private abs(rel: string) {
    const p = path.resolve(this.root, rel);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Ungültiger Bildpfad");
    return p;
  }

  async save(userId: string, itemId: string, main: Buffer, thumb: Buffer) {
    const dir = path.join(this.root, userId);
    await mkdir(dir, { recursive: true });
    const tag = randomBytes(4).toString("hex");
    const image = `${userId}/${itemId}-${tag}.webp`;
    const thumbRel = `${userId}/${itemId}-${tag}-thumb.webp`;
    await writeFile(this.abs(image), main);
    await writeFile(this.abs(thumbRel), thumb);
    return { image, thumb: thumbRel };
  }

  read(rel: string) {
    return readFile(this.abs(rel));
  }

  async remove(...rels: string[]) {
    for (const r of rels) await unlink(this.abs(r)).catch(() => undefined);
  }

  async removeUser(userId: string) {
    await rm(this.abs(userId), { recursive: true, force: true });
  }
}
