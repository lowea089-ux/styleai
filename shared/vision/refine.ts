// Edge refinement: lifts the coarse work-resolution mask to a sharper alpha matte that follows the real
// garment outline (guided filter, He et al. 2010), instead of a blurred upscale.
import { boxMean, downsample, resizeChannel, SRGB_TO_LINEAR, type Raster } from "./raster";
import type { SegmentResult } from "./segment";

export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const II = new Float32Array(n);
  const Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    II[i] = I[i] * I[i];
    Ip[i] = I[i] * p[i];
  }
  const mI = boxMean(I, w, h, r);
  const mp = boxMean(p, w, h, r);
  const mII = boxMean(II, w, h, r);
  const mIp = boxMean(Ip, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const cov = mIp[i] - mI[i] * mp[i];
    a[i] = cov / (varI + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxMean(a, w, h, r);
  const mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

export interface AlphaMatte {
  alpha: Float32Array;
  width: number;
  height: number;
}

/** Alpha matte (0..1) at up to `maxSide` px for the source photo, guided by its lightness. */
export function refineAlpha(src: Raster, seg: SegmentResult, maxSide = 1024): AlphaMatte {
  const g = downsample(src, maxSide);
  const W = g.width;
  const H = g.height;
  const I = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    // Perceptual lightness spreads dark tones apart, which matters for dim photos.
    const y = 0.2126 * SRGB_TO_LINEAR[g.data[o]] + 0.7152 * SRGB_TO_LINEAR[g.data[o + 1]] + 0.0722 * SRGB_TO_LINEAR[g.data[o + 2]];
    I[i] = Math.cbrt(y);
  }
  const { mask, width: w, height: h } = seg;
  const coarse = Float32Array.from(mask);
  const p = resizeChannel(coarse, w, h, W, H);
  const k = W / w;
  const q = guidedFilter(I, p, W, H, Math.max(2, Math.round(2 * k)), 0.002);
  // Trust region: the refined edge may move at most ~2 work pixels away from the coarse edge.
  const outer = resizeChannel(Float32Array.from(grow(mask, w, h, 2)), w, h, W, H);
  const inner = resizeChannel(Float32Array.from(shrink(mask, w, h, 2)), w, h, W, H);
  const alpha = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (outer[i] < 0.5) continue;
    if (inner[i] > 0.5) {
      alpha[i] = 1;
      continue;
    }
    const t = Math.max(0, Math.min(1, (q[i] - 0.2) / 0.6));
    alpha[i] = t * t * (3 - 2 * t);
  }
  return { alpha, width: W, height: H };
}

function grow(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = m;
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        out[i] = cur[i] || (x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w]) ? 1 : 0;
      }
    cur = out;
  }
  return cur;
}

function shrink(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = m;
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        out[i] = cur[i] && x > 0 && cur[i - 1] && x < w - 1 && cur[i + 1] && y > 0 && cur[i - w] && y < h - 1 && cur[i + w] ? 1 : 0;
      }
    cur = out;
  }
  return cur;
}
