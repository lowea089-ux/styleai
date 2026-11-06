// Manual touch-ups of a cut-out: magic wand (tap a region of similar color) and soft brush strokes on the
// alpha channel. Pure functions on RGBA/alpha buffers, used by the cut-out editor.
import { SRGB_TO_LINEAR } from "./raster";

function lab(rgba: Uint8ClampedArray, i: number): [number, number, number] {
  const R = SRGB_TO_LINEAR[rgba[i * 4]];
  const G = SRGB_TO_LINEAR[rgba[i * 4 + 1]];
  const B = SRGB_TO_LINEAR[rgba[i * 4 + 2]];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047);
  const fy = f(R * 0.2126729 + G * 0.7151522 + B * 0.072175);
  const fz = f((R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Contiguous region of similar color around (x, y). A pixel joins when it is close to the tapped color, or
 * when it continues a smooth gradient (folds, shadows) while staying within twice the tolerance.
 * `allowed` restricts the region (e.g. only visible pixels when erasing).
 */
export function regionGrow(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, tolerance: number, allowed: (i: number) => boolean): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n);
  const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
  const seed = sy * w + sx;
  if (!allowed(seed)) return out;
  const cache = new Float32Array(n * 3).fill(Number.NaN);
  const get = (i: number) => {
    if (Number.isNaN(cache[i * 3])) {
      const [l, a, b] = lab(rgba, i);
      cache[i * 3] = l;
      cache[i * 3 + 1] = a;
      cache[i * 3 + 2] = b;
    }
    return i * 3;
  };
  const s = get(seed);
  const L0 = cache[s];
  const A0 = cache[s + 1];
  const B0 = cache[s + 2];
  const tol2 = tolerance * tolerance;
  const step2 = (tolerance * 0.35) ** 2;
  const far2 = (tolerance * 2) ** 2;
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  queue[qt++] = seed;
  out[seed] = 1;
  while (qh < qt) {
    const i = queue[qh++];
    const ci = get(i);
    const px = i % w;
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? (px > 0 ? i - 1 : -1) : k === 1 ? (px < w - 1 ? i + 1 : -1) : k === 2 ? (i >= w ? i - w : -1) : i < n - w ? i + w : -1;
      if (j < 0 || out[j] || !allowed(j)) continue;
      const cj = get(j);
      const dSeed = (cache[cj] - L0) ** 2 + (cache[cj + 1] - A0) ** 2 + (cache[cj + 2] - B0) ** 2;
      const dStep = (cache[cj] - cache[ci]) ** 2 + (cache[cj + 1] - cache[ci + 1]) ** 2 + (cache[cj + 2] - cache[ci + 2]) ** 2;
      if (dSeed < tol2 || (dSeed < far2 && dStep < step2)) {
        out[j] = 1;
        queue[qt++] = j;
      }
    }
  }
  return out;
}

/** Set the region to `value` (0 = cut away, 255 = keep) with a one-pixel soft edge. */
export function applyRegion(alpha: Uint8ClampedArray, region: Uint8Array, w: number, h: number, value: 0 | 255) {
  for (let i = 0; i < region.length; i++) if (region[i]) alpha[i] = value;
  for (let i = 0; i < region.length; i++) {
    if (region[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if ((x > 0 && region[i - 1]) || (x < w - 1 && region[i + 1]) || (y > 0 && region[i - w]) || (y < h - 1 && region[i + w])) alpha[i] = (alpha[i] + value) >> 1;
  }
}

/**
 * Soft round brush along a stroke segment. Returns the touched rectangle (for partial redraws).
 * Erasing lowers alpha, restoring raises it; the outer 30 % of the radius fades.
 */
export function brushStroke(alpha: Uint8ClampedArray, w: number, h: number, from: { x: number; y: number }, to: { x: number; y: number }, radius: number, mode: "erase" | "restore") {
  const r = Math.max(1, radius);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, r / 3)));
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let s = 0; s <= steps; s++) {
    const cx = from.x + ((to.x - from.x) * s) / steps;
    const cy = from.y + ((to.y - from.y) * s) / steps;
    const bx0 = Math.max(0, Math.floor(cx - r));
    const by0 = Math.max(0, Math.floor(cy - r));
    const bx1 = Math.min(w - 1, Math.ceil(cx + r));
    const by1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const f = Math.min(1, (r - d) / (0.3 * r));
        const i = y * w + x;
        alpha[i] = mode === "erase" ? Math.min(alpha[i], Math.round(255 * (1 - f))) : Math.max(alpha[i], Math.round(255 * f));
      }
    x0 = Math.min(x0, bx0);
    y0 = Math.min(y0, by0);
    x1 = Math.max(x1, bx1);
    y1 = Math.max(y1, by1);
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
