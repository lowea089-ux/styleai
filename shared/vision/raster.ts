// Minimal RGBA raster helpers. Pure functions on ImageData-like buffers, so the photo pipeline runs in the
// browser and in the Node tests alike.

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function createRaster(width: number, height: number): Raster {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

/** sRGB byte → linear light (0..1). */
export const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const LIN_STEPS = 4096;
const LINEAR_TO_SRGB = (() => {
  const t = new Uint8ClampedArray(LIN_STEPS + 1);
  for (let i = 0; i <= LIN_STEPS; i++) {
    const v = i / LIN_STEPS;
    t[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  }
  return t;
})();

/** Linear light (0..1, clamped) → sRGB byte. */
export function linearToSrgb8(v: number): number {
  return LINEAR_TO_SRGB[Math.round(Math.max(0, Math.min(1, v)) * LIN_STEPS)];
}

/** CIE L* (0..100) from relative luminance. */
export function lightnessFromY(y: number): number {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

export function yFromLightness(l: number): number {
  const f = (l + 16) / 116;
  return f > 6 / 29 ? f * f * f : (l / (24389 / 27));
}

/**
 * Area-average downscale so the longer side is at most `maxSide`. Each source pixel is added to exactly one
 * target pixel, which averages sensor noise instead of aliasing it (unlike nearest-neighbour sampling).
 */
export function downsample(src: Raster, maxSide: number): Raster {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (s >= 1) return src;
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const acc = new Float32Array(w * h * 4);
  const cnt = new Float32Array(w * h);
  const sx = w / src.width;
  const sy = h / src.height;
  const d = src.data;
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(h - 1, (y * sy) | 0) * w;
    for (let x = 0; x < src.width; x++) {
      const t = ty + Math.min(w - 1, (x * sx) | 0);
      const o = (y * src.width + x) * 4;
      acc[t * 4] += d[o];
      acc[t * 4 + 1] += d[o + 1];
      acc[t * 4 + 2] += d[o + 2];
      acc[t * 4 + 3] += d[o + 3];
      cnt[t]++;
    }
  }
  const out = createRaster(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = cnt[i] || 1;
    out.data[i * 4] = acc[i * 4] / n;
    out.data[i * 4 + 1] = acc[i * 4 + 1] / n;
    out.data[i * 4 + 2] = acc[i * 4 + 2] / n;
    out.data[i * 4 + 3] = acc[i * 4 + 3] / n;
  }
  return out;
}

/** Bilinear resize of a single-channel float map. */
export function resizeChannel(src: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  const fx = w / W;
  const fy = h / H;
  for (let y = 0; y < H; y++) {
    const sy = Math.max(0, Math.min(h - 1, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.max(0, Math.min(w - 1, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const wx = sx - x0;
      const top = src[y0 * w + x0] * (1 - wx) + src[y0 * w + x1] * wx;
      const bot = src[y1 * w + x0] * (1 - wx) + src[y1 * w + x1] * wx;
      out[y * W + x] = top * (1 - wy) + bot * wy;
    }
  }
  return out;
}

/** Box-filtered mean over a (2r+1)² window using an integral image. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const W1 = w + 1;
  const ii = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** Deterministic PRNG for tests and reproducible sampling. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
