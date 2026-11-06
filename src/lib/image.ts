// Client-side image pipeline: decode → downscale → light correction → background removal → crop → colors.
// Runs fully in the browser; the original photo never leaves the device unless the user saves or analyses it.
// The algorithms live in shared/vision (pure functions, unit-tested); this file adapts them to canvases.
import { extractColors, type ItemColor } from "../../shared/color";
import { analyzeLighting, applyLighting, type LightingAnalysis } from "../../shared/vision/lighting";
import type { Raster } from "../../shared/vision/raster";
import { refineAlpha, type AlphaMatte } from "../../shared/vision/refine";
import { segmentGarment } from "../../shared/vision/segment";

export class ImageLoadError extends Error {}

export async function loadImage(file: File, maxSide = 1600): Promise<HTMLCanvasElement> {
  if (file.size > 25 * 1024 * 1024) throw new ImageLoadError("Das Foto ist größer als 25 MB.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    throw new ImageLoadError(
      heic
        ? "Dein Browser kann HEIC-Fotos nicht öffnen. Bitte das Foto als JPEG exportieren (iPhone: Einstellungen → Kamera → Formate → „Maximale Kompatibilität“)."
        : "Diese Datei konnte nicht als Bild geöffnet werden.",
    );
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export interface CutoutResult {
  canvas: HTMLCanvasElement;
  /** Share of the image classified as garment. */
  foregroundRatio: number;
  /** Heuristic confidence that the background was uniform enough. */
  confident: boolean;
  /** Enclosed regions in background color (bag handle, gap between legs) – not cut unless asked to. */
  holeCount: number;
  /** Alpha (0..255) at the size of the source photo, for manual touch-ups. */
  alpha: Uint8ClampedArray;
}

export function canvasToRaster(c: HTMLCanvasElement): Raster {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
}

export function rasterToCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = r.width;
  c.height = r.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return c;
}

export interface LightFix {
  canvas: HTMLCanvasElement;
  analysis: LightingAnalysis;
  /** True when exposure or white balance was changed. */
  applied: boolean;
}

/** Brighten dim photos and neutralize lamp color casts; well-lit photos are returned unchanged. */
export function correctLighting(src: HTMLCanvasElement): LightFix {
  const raster = canvasToRaster(src);
  const analysis = analyzeLighting(raster);
  if (!analysis.needsCorrection) return { canvas: src, analysis, applied: false };
  return { canvas: rasterToCanvas(applyLighting(raster, analysis)), analysis, applied: true };
}

/** Short German explanation of what the light correction changed (for the review card). */
export function describeLightFix(a: LightingAnalysis): string | null {
  if (!a.needsCorrection) return null;
  if (a.lowLight && a.colorCast) return "Dunkles Foto mit Farbstich – Helligkeit und Farben wurden automatisch korrigiert.";
  if (a.lowLight) return "Dunkles Foto – die Helligkeit wurde automatisch angehoben.";
  return "Farbstich durch Lampenlicht erkannt – die Farben wurden neutralisiert.";
}

/**
 * Background removal for garments photographed on a reasonably plain surface. Segmentation runs on a
 * downscaled copy (shared/vision/segment), the edge is then refined against the full photo.
 * `cutHoles` also removes enclosed regions in background color (handles, gaps between legs).
 */
export function removeBackground(src: HTMLCanvasElement, tolerance = 20, opts: { cutHoles?: boolean } = {}): CutoutResult {
  const raster = canvasToRaster(src);
  const seg = segmentGarment(raster, { tolerance });
  const used = opts.cutHoles && seg.holeCount ? { ...seg, mask: seg.mask.map((v, i) => (v && !seg.holes[i] ? 1 : 0)) } : seg;
  const alpha = matteToAlpha(refineAlpha(raster, used), src.width, src.height);
  return { canvas: composeCutout(src, alpha), foregroundRatio: seg.foregroundRatio, confident: seg.confident, holeCount: seg.holeCount, alpha };
}

/** Scale a matte to the photo size (smooth) and return its alpha bytes. */
function matteToAlpha(matte: AlphaMatte, W: number, H: number): Uint8ClampedArray {
  const mask = document.createElement("canvas");
  mask.width = matte.width;
  mask.height = matte.height;
  const mctx = mask.getContext("2d")!;
  const md = mctx.createImageData(matte.width, matte.height);
  for (let i = 0; i < matte.alpha.length; i++) md.data[i * 4 + 3] = Math.round(matte.alpha[i] * 255);
  mctx.putImageData(md, 0, 0);
  const big = document.createElement("canvas");
  big.width = W;
  big.height = H;
  const bctx = big.getContext("2d", { willReadFrequently: true })!;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(mask, 0, 0, W, H);
  const px = bctx.getImageData(0, 0, W, H).data;
  const alpha = new Uint8ClampedArray(W * H);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  return alpha;
}

/** The photo with the given alpha, cropped to the visible garment plus a small margin. */
export function composeCutout(src: HTMLCanvasElement, alpha: Uint8ClampedArray): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const img = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H);
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = alpha[y * W + x];
      img.data[(y * W + x) * 4 + 3] = a;
      if (a > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  const full = document.createElement("canvas");
  full.width = W;
  full.height = H;
  full.getContext("2d")!.putImageData(img, 0, 0);
  if (x1 < 0) return full;
  const pad = Math.round(Math.max(W, H) * 0.03);
  const X0 = Math.max(0, x0 - pad);
  const Y0 = Math.max(0, y0 - pad);
  const X1 = Math.min(W, x1 + 1 + pad);
  const Y1 = Math.min(H, y1 + 1 + pad);
  const c = document.createElement("canvas");
  c.width = X1 - X0;
  c.height = Y1 - Y0;
  c.getContext("2d")!.drawImage(full, X0, Y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/** Alpha of a cut-out image that has the same size as the photo (e.g. from Photoroom), else null. */
export function alphaOf(cutout: HTMLCanvasElement, like: HTMLCanvasElement): Uint8ClampedArray | null {
  if (cutout.width !== like.width || cutout.height !== like.height) return null;
  const px = cutout.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, cutout.width, cutout.height).data;
  const alpha = new Uint8ClampedArray(cutout.width * cutout.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  return alpha;
}

export function cropNormalized(src: HTMLCanvasElement, bbox: { x: number; y: number; w: number; h: number }, pad = 0.03) {
  const x = Math.max(0, (bbox.x - pad) * src.width);
  const y = Math.max(0, (bbox.y - pad) * src.height);
  const w = Math.min(src.width - x, (bbox.w + 2 * pad) * src.width);
  const h = Math.min(src.height - y, (bbox.h + 2 * pad) * src.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

/** Dominant garment colors. Uses alpha if the canvas is a cut-out, otherwise the central region. */
export function canvasColors(canvas: HTMLCanvasElement): ItemColor[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let transparent = 0;
  for (let i = 3; i < data.data.length; i += 16) if (data.data[i] < 200) transparent++;
  if (transparent / (data.data.length / 16) > 0.02) return extractColors(data.data, canvas.width, canvas.height);
  const cx = Math.round(canvas.width * 0.2);
  const cy = Math.round(canvas.height * 0.2);
  const center = ctx.getImageData(cx, cy, canvas.width - 2 * cx, canvas.height - 2 * cy);
  return extractColors(center.data, center.width, center.height);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild konnte nicht erzeugt werden."))), type, quality));
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}
