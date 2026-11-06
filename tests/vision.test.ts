import { describe, expect, it } from "vitest";
import { extractColors, type ColorFamilyId } from "../shared/color";
import { analyzeLighting, applyLighting } from "../shared/vision/lighting";
import { createRaster, downsample, linearToSrgb8, mulberry32, SRGB_TO_LINEAR, type Raster } from "../shared/vision/raster";
import { applyRegion, brushStroke, regionGrow } from "../shared/vision/edit";
import { refineAlpha } from "../shared/vision/refine";
import { segmentGarment, type SegmentResult } from "../shared/vision/segment";

type RGB = [number, number, number];
type Pt = [number, number];

const TSHIRT: Pt[] = [
  [0.4, 0.18], [0.3, 0.2], [0.14, 0.32], [0.2, 0.42], [0.32, 0.36], [0.32, 0.84],
  [0.68, 0.84], [0.68, 0.36], [0.8, 0.42], [0.86, 0.32], [0.7, 0.2], [0.6, 0.18], [0.5, 0.24],
];

function inside(poly: Pt[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

interface SceneOpts {
  garment: RGB;
  bg: RGB;
  poly?: Pt[];
  /** Overall light level (1 = well exposed). */
  light?: number;
  /** Multiplier per linear channel (warm bulb ≈ [1, 0.8, 0.5]). */
  cast?: RGB;
  /** Light falling off from left to right (0..1). */
  gradient?: number;
  vignette?: number;
  /** Gaussian sensor noise (σ in 8-bit units). */
  noise?: number;
  /** Darkening in fabric folds (0..1). */
  folds?: number;
  seed?: number;
}

function scene(o: SceneOpts, w = 640, h = 520): { raster: Raster; truth: Uint8Array } {
  const r = createRaster(w, h);
  const truth = new Uint8Array(w * h);
  const rand = mulberry32(o.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const lin = (c: RGB) => c.map((v) => SRGB_TO_LINEAR[v]);
  const g = lin(o.garment);
  const b = lin(o.bg);
  const cast = o.cast ?? [1, 1, 1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      const isG = inside(o.poly ?? TSHIRT, nx, ny);
      truth[y * w + x] = isG ? 1 : 0;
      let k = (o.light ?? 1) * (1 - (o.gradient ?? 0) * nx);
      const rr = Math.hypot(nx - 0.5, ny - 0.5) / 0.7071;
      k *= 1 - (o.vignette ?? 0) * rr * rr;
      if (isG && o.folds) k *= 1 - o.folds * Math.max(0, Math.sin(nx * 38 + ny * 9)) ** 3;
      const base = isG ? g : b;
      for (let c = 0; c < 3; c++) {
        const v = linearToSrgb8(base[c] * k * cast[c]) + gauss() * (o.noise ?? 0);
        r.data[(y * w + x) * 4 + c] = v;
      }
      r.data[(y * w + x) * 4 + 3] = 255;
    }
  return { raster: r, truth };
}

function iou(seg: SegmentResult, truth: Uint8Array, W: number, H: number) {
  let inter = 0;
  let uni = 0;
  for (let y = 0; y < seg.height; y++)
    for (let x = 0; x < seg.width; x++) {
      const t = truth[Math.min(H - 1, Math.floor(((y + 0.5) / seg.height) * H)) * W + Math.min(W - 1, Math.floor(((x + 0.5) / seg.width) * W))];
      const p = seg.mask[y * seg.width + x];
      if (t && p) inter++;
      if (t || p) uni++;
    }
  return inter / uni;
}

function pipeline(raster: Raster) {
  const lighting = analyzeLighting(raster);
  const corrected = lighting.needsCorrection ? applyLighting(raster, lighting) : raster;
  const seg = segmentGarment(corrected);
  return { lighting, corrected, seg };
}

/** Colors of the masked garment pixels, like the app does on the cut-out. */
function garmentColors(img: Raster, seg: SegmentResult) {
  const small = downsample(img, Math.max(seg.width, seg.height));
  const data = new Uint8ClampedArray(small.data);
  for (let i = 0; i < seg.width * seg.height; i++) data[i * 4 + 3] = seg.mask[i] ? 255 : 0;
  return extractColors(data, small.width, small.height);
}

const GRAY_AXIS: ColorFamilyId[] = ["weiss", "hellgrau", "grau"];

describe("lighting correction", () => {
  it("leaves well-lit photos untouched", () => {
    const { raster } = scene({ garment: [32, 42, 72], bg: [205, 203, 198] });
    const a = analyzeLighting(raster);
    expect(a.exposureGain).toBe(1);
    expect(a.lowLight).toBe(false);
    for (const g of a.wbGains) expect(Math.abs(g - 1)).toBeLessThan(0.08);
  });

  it("does not gray out a large colored garment in good light", () => {
    const big: Pt[] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.85], [0.1, 0.85]];
    const { raster } = scene({ garment: [190, 40, 45], bg: [240, 240, 238], poly: big });
    const a = analyzeLighting(raster);
    expect(a.exposureGain).toBe(1);
    for (const g of a.wbGains) expect(Math.abs(g - 1)).toBeLessThan(0.12);
  });

  it("detects dim, warm light and brightens it", () => {
    const { raster } = scene({ garment: [235, 235, 232], bg: [120, 125, 130], light: 0.16, cast: [1, 0.8, 0.5], noise: 4 });
    const a = analyzeLighting(raster);
    expect(a.lowLight).toBe(true);
    expect(a.colorCast).toBe(true);
    expect(a.exposureGain).toBeGreaterThan(1.5);
    // Blue must be lifted relative to red to undo the yellow cast.
    expect(a.wbGains[2]).toBeGreaterThan(a.wbGains[0]);
  });

  it("names a white shirt under a warm dim bulb as white/gray instead of beige", () => {
    const { raster } = scene({ garment: [238, 238, 235], bg: [110, 116, 124], light: 0.18, cast: [1, 0.78, 0.48], noise: 4, seed: 3 });
    const raw = segmentGarment(raster);
    const rawFamily = garmentColors(raster, raw)[0]?.family;
    expect(GRAY_AXIS).not.toContain(rawFamily);
    const { corrected, seg } = pipeline(raster);
    expect(GRAY_AXIS).toContain(garmentColors(corrected, seg)[0]?.family);
  });

  it("keeps a white shirt white in a very dark, tinted photo with a lamp from one side", () => {
    const { raster } = scene({ garment: [238, 238, 234], bg: [118, 122, 128], light: 0.17, gradient: 0.45, cast: [1, 0.8, 0.5], noise: 5, seed: 11 });
    const { corrected, seg } = pipeline(raster);
    expect(["weiss", "hellgrau"]).toContain(garmentColors(corrected, seg)[0]?.family);
  });
});

describe("segmentation in poor light", () => {
  it("cuts out cleanly in good light", () => {
    const { raster, truth } = scene({ garment: [32, 42, 72], bg: [205, 203, 198] });
    const { seg, corrected } = pipeline(raster);
    expect(iou(seg, truth, 640, 520)).toBeGreaterThan(0.95);
    expect(seg.confident).toBe(true);
    expect(garmentColors(corrected, seg)[0].family).toBe("navy");
  });

  it("finds the outline in a dark, noisy, warm photo", () => {
    const { raster, truth } = scene({ garment: [32, 42, 72], bg: [205, 203, 198], light: 0.15, cast: [1, 0.82, 0.55], noise: 6, seed: 2 });
    const { seg } = pipeline(raster);
    expect(iou(seg, truth, 640, 520)).toBeGreaterThan(0.9);
  });

  it("handles a lamp from one side plus vignetting", () => {
    const { raster, truth } = scene({ garment: [70, 70, 74], bg: [150, 140, 125], light: 0.7, gradient: 0.65, vignette: 0.35, noise: 3, seed: 4 });
    const { seg } = pipeline(raster);
    expect(seg.diagnostics.flattened).toBe(true);
    expect(iou(seg, truth, 640, 520)).toBeGreaterThan(0.9);
  });

  it("separates a black shirt from a dark floor in low light", () => {
    const { raster, truth } = scene({ garment: [24, 24, 26], bg: [92, 72, 58], light: 0.35, noise: 4, seed: 5 });
    const { seg } = pipeline(raster);
    expect(iou(seg, truth, 640, 520)).toBeGreaterThan(0.88);
  });

  it("keeps a garment that touches the bottom edge", () => {
    const touching: Pt[] = TSHIRT.map(([x, y]) => [x, y > 0.8 ? 1.01 : y] as Pt);
    const { raster, truth } = scene({ garment: [180, 40, 45], bg: [236, 236, 233] , poly: touching });
    const { seg } = pipeline(raster);
    expect(iou(seg, truth, 640, 520)).toBeGreaterThan(0.92);
  });

  it("refines the matte to full resolution without leaking", () => {
    const { raster, truth } = scene({ garment: [32, 42, 72], bg: [205, 203, 198], light: 0.3, noise: 3 });
    const { seg, corrected } = pipeline(raster);
    const m = refineAlpha(corrected, seg, 640);
    let wrong = 0;
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        const t = truth[Math.floor(((y + 0.5) / m.height) * 520) * 640 + Math.floor(((x + 0.5) / m.width) * 640)];
        if ((m.alpha[y * m.width + x] > 0.5 ? 1 : 0) !== t) wrong++;
      }
    expect(wrong / (m.width * m.height)).toBeLessThan(0.012);
  });
});

describe("hard scenes", () => {
  const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  it("cuts out a garment that fills the frame and touches three edges", () => {
    // Background only shows at the top; the garment's color dominates the border.
    const big = rect(-0.05, 0.12, 1.05, 1.05);
    const { raster, truth } = scene({ garment: [150, 30, 40], bg: [230, 230, 226], poly: big });
    const { seg } = pipeline(raster);
    expect(seg.diagnostics.hypothesis).toBe("ohne-mitte");
    expect(iou(seg, truth, 640, 520)).toBeGreaterThan(0.95);
    expect(seg.confident).toBe(true);
  });

  it("finds a small garment lying in a corner", () => {
    const corner = rect(0.62, 0.6, 1.05, 1.05);
    const { raster, truth } = scene({ garment: [40, 110, 60], bg: [226, 222, 214], poly: corner });
    const { seg } = pipeline(raster);
    expect(iou(seg, truth, 640, 520)).toBeGreaterThan(0.95);
  });

  it("suggests enclosed holes instead of cutting them, and cutting them helps", () => {
    // Trousers whose legs touch at the hem: the gap between them is enclosed background.
    const legs: Pt[] = rect(0.3, 0.06, 0.72, 0.95);
    const gap: Pt[] = [[0.5, 0.42], [0.54, 0.9], [0.46, 0.9]];
    const r = createRaster(640, 520);
    const truth = new Uint8Array(640 * 520);
    for (let y = 0; y < 520; y++)
      for (let x = 0; x < 640; x++) {
        const g = inside(legs, x / 640, y / 520) && !inside(gap, x / 640, y / 520);
        truth[y * 640 + x] = g ? 1 : 0;
        r.data.set(g ? [60, 84, 120, 255] : [228, 226, 220, 255], (y * 640 + x) * 4);
      }
    const seg = segmentGarment(r);
    expect(seg.holeCount).toBe(1);
    const cut = { ...seg, mask: seg.mask.map((v, i) => (v && !seg.holes[i] ? 1 : 0)) };
    expect(iou(cut, truth, 640, 520)).toBeGreaterThan(iou(seg, truth, 640, 520) + 0.03);
  });
});

describe("cut-out touch-ups", () => {
  it("selects a contiguous region of similar color, following soft shading", () => {
    const w = 60;
    const h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Left: blue with a lightness gradient (fold); right of x = 40: white.
        const v = x < 40 ? [30 + x, 60 + x, 140 + x, 255] : [245, 245, 245, 255];
        rgba.set(v, (y * w + x) * 4);
      }
    const all = () => true;
    const region = regionGrow(rgba, w, h, 2, 20, 12, all);
    let left = 0;
    let right = 0;
    for (let i = 0; i < w * h; i++) if (region[i]) i % w < 40 ? left++ : right++;
    expect(left).toBe(40 * h);
    expect(right).toBe(0);
    // Restricted to an allowed area.
    const half = regionGrow(rgba, w, h, 2, 20, 12, (i) => i % w < 20);
    expect(half.reduce((s, v) => s + v, 0)).toBe(20 * h);
  });

  it("erases and restores alpha with a soft brush", () => {
    const w = 50;
    const h = 50;
    const alpha = new Uint8ClampedArray(w * h).fill(255);
    const box = brushStroke(alpha, w, h, { x: 10, y: 25 }, { x: 40, y: 25 }, 5, "erase")!;
    expect(alpha[25 * w + 25]).toBe(0);
    expect(alpha[5 * w + 25]).toBe(255);
    expect(box.w).toBeGreaterThan(30);
    brushStroke(alpha, w, h, { x: 25, y: 25 }, { x: 25, y: 25 }, 5, "restore");
    expect(alpha[25 * w + 25]).toBe(255);
    const region = new Uint8Array(w * h);
    region[0] = 1;
    applyRegion(alpha, region, w, h, 0);
    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBe(127);
  });
});

describe("garment colors", () => {
  it("does not report fold shadows as a second color", () => {
    const { raster } = scene({ garment: [200, 40, 42], bg: [236, 236, 233], folds: 0.55, seed: 6 });
    const { seg, corrected } = pipeline(raster);
    const fams = garmentColors(corrected, seg).map((c) => c.family);
    expect(fams[0]).toBe("rot");
    expect(fams).not.toContain("bordeaux");
  });

  it("keeps both colors of a two-tone garment", () => {
    const w = 120;
    const h = 120;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(i % w < 60 ? [20, 20, 22, 255] : [244, 244, 240, 255], i * 4);
    const fams = extractColors(data, w, h).map((c) => c.family);
    expect(fams).toContain("schwarz");
    expect(fams).toContain("weiss");
  });
});
