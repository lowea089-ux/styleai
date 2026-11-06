// Garment segmentation for photos on a reasonably plain surface, built to survive poor light.
//
// Pipeline (all at ≤ 480 px work resolution):
//  1. Lab conversion + 3×3 median (removes the chroma noise typical of dim indoor photos)
//  2. Candidate background colors from the border (k-means); a garment touching one edge is no candidate
//  3. Several interpretations ("hypotheses") of which candidates are background – needed when a garment
//     fills the frame and touches several edges, or lies small in a corner. Each is segmented and the most
//     plausible result wins (sensible size, not covering the whole frame border, preferably the center).
//  4. Per hypothesis: illumination flattening from its background border (vignetting, one-sided lamp),
//     Otsu-based adaptive tolerance, flood fill from the border that follows soft shadows but stops at real
//     contours, opening + connected components
//  5. Hole candidates: enclosed regions in background color (bag handles, gap between trouser legs). They are
//     reported, not removed – a white print on a shirt looks the same to a pixel classifier.
import { downsample, mulberry32, SRGB_TO_LINEAR, type Raster } from "./raster";

export interface SegmentOptions {
  /** User tolerance (slider, default 20). Scales the automatically chosen threshold. */
  tolerance?: number;
  /** Work resolution (longer side). */
  maxSide?: number;
}

export interface SegmentResult {
  /** 1 = garment, at work resolution. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** work size / source size */
  scale: number;
  foregroundRatio: number;
  confident: boolean;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** 1 = enclosed region in background color inside the garment (possible hole). */
  holes: Uint8Array;
  holeCount: number;
  diagnostics: { tolerance: number; separation: number; noise: number; flattened: boolean; models: number; hypothesis: string };
}

interface Model {
  l: number;
  a: number;
  b: number;
  share: number;
  spread: number;
}

const DEFAULT_TOLERANCE = 20;

interface Prepared {
  w: number;
  h: number;
  n: number;
  L0: Float32Array;
  A: Float32Array;
  B: Float32Array;
  grad: Float32Array;
  border: number[];
  center: number[];
  userScale: number;
}

interface Candidate extends Model {
  sideOk: boolean;
  centerShare: number;
}

interface Attempt {
  name: string;
  keep: Uint8Array;
  dist: Float32Array;
  tol: number;
  ratio: number;
  fgBorderShare: number;
  coversCenter: boolean;
  confident: boolean;
  separation: number;
  noise: number;
  flattened: boolean;
  models: number;
}

export function segmentGarment(src: Raster, opts: SegmentOptions = {}): SegmentResult {
  const r = downsample(src, opts.maxSide ?? 480);
  const w = r.width;
  const h = r.height;
  const n = w * h;

  // 1. Lab + median
  const L0r = new Float32Array(n);
  const A0 = new Float32Array(n);
  const B0 = new Float32Array(n);
  toLab(r.data, L0r, A0, B0);
  const L0 = median3(L0r, w, h);
  const A = median3(A0, w, h);
  const B = median3(B0, w, h);

  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const border: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (x < band || y < band || x >= w - band || y >= h - band) border.push(y * w + x);
  const center: number[] = [];
  for (let y = Math.floor(h * 0.38); y < h * 0.62; y += 2) for (let x = Math.floor(w * 0.38); x < w * 0.62; x += 2) center.push(y * w + x);
  const p: Prepared = { w, h, n, L0, A, B, grad: gradient(L0, A, B, w, h), border, center, userScale: (opts.tolerance ?? DEFAULT_TOLERANCE) / DEFAULT_TOLERANCE };

  // 2. Candidate background colors
  const cands: Candidate[] = kmeansLab(border, L0, A, B, 4)
    .filter((m) => m.share > 0.1)
    .map((m) => ({ ...m, sideOk: false, centerShare: 0 }));
  const nearest = (i: number) => {
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < cands.length; k++) {
      const m = cands[k];
      const d = (L0[i] - m.l) ** 2 + (A[i] - m.a) ** 2 + (B[i] - m.b) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return { k: best, d: Math.sqrt(bd) };
  };
  const sideHits = cands.map(() => [0, 0, 0, 0]);
  const sideTotal = [0, 0, 0, 0];
  for (const i of border) {
    const x = i % w;
    const y = (i / w) | 0;
    const { k } = nearest(i);
    const sides = [y < band, y >= h - band, x < band, x >= w - band];
    for (let s = 0; s < 4; s++) {
      if (!sides[s]) continue;
      sideTotal[s]++;
      if (k >= 0) sideHits[k][s]++;
    }
  }
  cands.forEach((c, k) => {
    c.sideOk = c.share > 0.45 || sideHits[k].filter((v, s) => v >= sideTotal[s] * 0.1).length >= 2;
  });
  // Non-exclusive: one garment color may be split into several clusters, each must still count as "in the middle".
  for (const c of cands) {
    const lim2 = Math.max(6, c.spread * 2.5) ** 2;
    let hits = 0;
    for (const i of center) if ((L0[i] - c.l) ** 2 + (A[i] - c.a) ** 2 + (B[i] - c.b) ** 2 < lim2) hits++;
    c.centerShare = hits / (center.length || 1);
  }

  // 3. Hypotheses about which candidates are background
  const base = cands.filter((c) => c.sideOk);
  const hyps: { name: string; models: Candidate[] }[] = [{ name: "rand", models: base }];
  const centerHeavy = base.filter((c) => c.centerShare > 0.5);
  if (centerHeavy.length && centerHeavy.length < base.length) {
    // The garment fills the middle and touches the frame: its color is no background.
    hyps.push({ name: "ohne-mitte", models: base.filter((c) => c.centerShare <= 0.5) });
    // A small garment off-center: the background is what covers the middle.
    const centerOnly = base.filter((c) => c.centerShare >= 0.05);
    if (centerOnly.length && centerOnly.length < base.length) hyps.push({ name: "nur-mitte", models: centerOnly });
  }

  // 4. Segment each hypothesis and keep the most plausible
  const attempts = hyps.map((hy) => attempt(p, hy.name, hy.models, cands));
  const valid = (a: Attempt) => a.ratio > 0.02 && a.ratio < 0.92 && a.fgBorderShare < 0.8;
  const rank = (a: Attempt) => (valid(a) ? 2 : 0) + (a.coversCenter ? 1 : 0) - Math.abs(Math.log(Math.max(0.01, a.ratio) / 0.3)) * 0.1;
  let best = attempts[0];
  for (const a of attempts.slice(1)) if (rank(a) > rank(best) + 1e-9) best = a;

  // 5. Hole candidates in the chosen result
  const { holes, count: holeCount } = findHoles(best, w, h);

  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (best.keep[y * w + x]) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return {
    mask: best.keep,
    width: w,
    height: h,
    scale: w / src.width,
    foregroundRatio: best.ratio,
    confident: best.confident && valid(best),
    bbox: x1 < 0 ? null : { x0, y0, x1, y1 },
    holes,
    holeCount,
    diagnostics: {
      tolerance: round1(best.tol),
      separation: round1(best.separation),
      noise: round1(best.noise),
      flattened: best.flattened,
      models: best.models,
      hypothesis: best.name,
    },
  };
}

function attempt(p: Prepared, name: string, chosen: Candidate[], all: Candidate[]): Attempt {
  const { w, h, n, L0, A, B, grad, border, center } = p;
  // Border pixels that belong to the chosen background colors
  const bgBorder = chosen.length
    ? border.filter((i) => {
        let best = -1;
        let bd = Infinity;
        all.forEach((m, k) => {
          const d = (L0[i] - m.l) ** 2 + (A[i] - m.a) ** 2 + (B[i] - m.b) ** 2;
          if (d < bd) {
            bd = d;
            best = k;
          }
        });
        return chosen.includes(all[best]);
      })
    : [];
  const flat = bgBorder.length > 50 ? flattenIllumination(L0, w, h, bgBorder) : null;
  const L = flat ?? L0;
  const models = bgBorder.length ? kmeansLab(bgBorder, L, A, B, Math.min(4, chosen.length + 1)).filter((m) => m.share > 0.06) : [];

  const dist = new Float32Array(n).fill(models.length ? 0 : 1e9);
  if (models.length) {
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (let k = 0; k < models.length; k++) {
        const m = models[k];
        const d = (L[i] - m.l) ** 2 + (A[i] - m.a) ** 2 + (B[i] - m.b) ** 2;
        if (d < best) best = d;
      }
      dist[i] = Math.sqrt(best);
    }
  }

  // Adaptive tolerance
  const noise = models.length ? models.reduce((s, m) => s + m.spread * m.share, 0) / models.reduce((s, m) => s + m.share, 0) : 0;
  const split = otsu(dist);
  const bimodal = split.upperShare > 0.02 && split.upperShare < 0.92 && split.upperMean > split.lowerMean * 2 + 4;
  const baseTol = bimodal ? Math.max(3, Math.min(34, split.threshold)) : DEFAULT_TOLERANCE;
  const tol = Math.max(2.5, baseTol * p.userScale);
  const separation = bimodal ? split.upperMean : 0;

  // Flood fill from the border; follows smooth shadows, stops at contours
  const gSorted = Float32Array.from(grad).sort();
  const edgeT = Math.max(gSorted[Math.floor(gSorted.length * 0.9)], tol * 0.45);
  const step2 = (tol * 0.42) ** 2;
  const drift = tol * 2;
  const sure = tol * 0.55;
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (const i of border) {
    if (!bg[i] && dist[i] < tol) {
      bg[i] = 1;
      queue[qt++] = i;
    }
  }
  const visit = (i: number, j: number) => {
    if (bg[j]) return;
    const dm = dist[j];
    if (dm > sure && grad[j] >= edgeT) return;
    if (dm < tol || (dm < drift && (L[j] - L[i]) ** 2 + (A[j] - A[i]) ** 2 + (B[j] - B[i]) ** 2 < step2)) {
      bg[j] = 1;
      queue[qt++] = j;
    }
  };
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w;
    if (x > 0) visit(i, i - 1);
    if (x < w - 1) visit(i, i + 1);
    if (i >= w) visit(i, i - w);
    if (i < n - w) visit(i, i + w);
  }

  // Opening, then keep significant components
  const fg0 = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg0[i] = bg[i] ? 0 : 1;
  const fg = dilate(erode(fg0, w, h), w, h);
  const keep = new Uint8Array(n);
  const label = new Int32Array(n).fill(-1);
  let fgCount = 0;
  const comp = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!fg[i] || label[i] >= 0) continue;
    let cn = 0;
    qh = qt = 0;
    queue[qt++] = i;
    label[i] = i;
    while (qh < qt) {
      const k = queue[qh++];
      comp[cn++] = k;
      const x = k % w;
      if (x > 0 && fg[k - 1] && label[k - 1] < 0) (label[k - 1] = i), (queue[qt++] = k - 1);
      if (x < w - 1 && fg[k + 1] && label[k + 1] < 0) (label[k + 1] = i), (queue[qt++] = k + 1);
      if (k >= w && fg[k - w] && label[k - w] < 0) (label[k - w] = i), (queue[qt++] = k - w);
      if (k < n - w && fg[k + w] && label[k + w] < 0) (label[k + w] = i), (queue[qt++] = k + w);
    }
    if (cn >= n * 0.015) {
      for (let c = 0; c < cn; c++) keep[comp[c]] = 1;
      fgCount += cn;
    }
  }
  let borderFg = 0;
  for (const i of border) borderFg += keep[i];
  let centerFg = 0;
  for (const i of center) centerFg += keep[i];
  const ratio = fgCount / n;
  const fgBorderShare = borderFg / border.length;
  return {
    name,
    keep,
    dist,
    tol,
    ratio,
    fgBorderShare,
    coversCenter: centerFg > center.length * 0.5,
    // A frame-filling garment may cover much of the border; the other checks still have to pass.
    confident: models.length > 0 && bimodal && ratio > 0.04 && ratio < 0.9 && separation >= tol * 1.4 && fgBorderShare < 0.75,
    separation,
    noise,
    flattened: !!flat,
    models: models.length,
  };
}

/** Enclosed regions of the garment mask whose color matches the background (≥ 0.2 % of the image). */
function findHoles(a: Attempt, w: number, h: number): { holes: Uint8Array; count: number } {
  const n = w * h;
  const holes = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const comp = new Int32Array(n);
  const limit = a.tol * 0.8;
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s] || !a.keep[s] || a.dist[s] >= limit) continue;
    let qh = 0;
    let qt = 0;
    let cn = 0;
    let sum = 0;
    let touchesEdge = false;
    queue[qt++] = s;
    seen[s] = 1;
    while (qh < qt) {
      const i = queue[qh++];
      comp[cn++] = i;
      sum += a.dist[i];
      const x = i % w;
      const y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && a.keep[j] && a.dist[j] < limit) {
          seen[j] = 1;
          queue[qt++] = j;
        }
      }
    }
    if (!touchesEdge && cn >= n * 0.002 && sum / cn < a.tol * 0.6) {
      for (let c = 0; c < cn; c++) holes[comp[c]] = 1;
      count++;
    }
  }
  return { holes, count };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------

function toLab(px: Uint8ClampedArray, L: Float32Array, A: Float32Array, B: Float32Array) {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  for (let i = 0; i < L.length; i++) {
    const R = SRGB_TO_LINEAR[px[i * 4]];
    const G = SRGB_TO_LINEAR[px[i * 4 + 1]];
    const Bl = SRGB_TO_LINEAR[px[i * 4 + 2]];
    const fx = f((R * 0.4124564 + G * 0.3575761 + Bl * 0.1804375) / 0.95047);
    const fy = f(R * 0.2126729 + G * 0.7151522 + Bl * 0.072175);
    const fz = f((R * 0.0193339 + G * 0.119192 + Bl * 0.9503041) / 1.08883);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
}

/** 3×3 median with a 19-comparison sorting network (clamped borders). */
function median3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w;
    const yc = y * w;
    const yp = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : x;
      let p0 = src[ym + xm], p1 = src[ym + x], p2 = src[ym + xp];
      let p3 = src[yc + xm], p4 = src[yc + x], p5 = src[yc + xp];
      let p6 = src[yp + xm], p7 = src[yp + x], p8 = src[yp + xp];
      let t: number;
      if (p1 > p2) (t = p1), (p1 = p2), (p2 = t);
      if (p4 > p5) (t = p4), (p4 = p5), (p5 = t);
      if (p7 > p8) (t = p7), (p7 = p8), (p8 = t);
      if (p0 > p1) (t = p0), (p0 = p1), (p1 = t);
      if (p3 > p4) (t = p3), (p3 = p4), (p4 = t);
      if (p6 > p7) (t = p6), (p6 = p7), (p7 = t);
      if (p1 > p2) (t = p1), (p1 = p2), (p2 = t);
      if (p4 > p5) (t = p4), (p4 = p5), (p5 = t);
      if (p7 > p8) (t = p7), (p7 = p8), (p8 = t);
      if (p0 > p3) (t = p0), (p0 = p3), (p3 = t);
      if (p5 > p8) (t = p5), (p5 = p8), (p8 = t);
      if (p4 > p7) (t = p4), (p4 = p7), (p7 = t);
      if (p3 > p6) (t = p3), (p3 = p6), (p6 = t);
      if (p1 > p4) (t = p1), (p1 = p4), (p4 = t);
      if (p2 > p5) (t = p2), (p2 = p5), (p5 = t);
      if (p4 > p7) (t = p4), (p4 = p7), (p7 = t);
      if (p4 > p2) (t = p4), (p4 = p2), (p2 = t);
      if (p6 > p4) (t = p6), (p6 = p4), (p4 = t);
      if (p4 > p2) (t = p4), (p4 = p2), (p2 = t);
      out[yc + x] = p4;
    }
  }
  return out;
}

/** Otsu split of a distance histogram (0..80 in 0.5 steps). */
function otsu(d: Float32Array) {
  const bins = 160;
  const hist = new Float64Array(bins);
  for (let i = 0; i < d.length; i++) hist[Math.min(bins - 1, Math.max(0, Math.floor(d[i] * 2)))]++;
  const total = d.length;
  let sumAll = 0;
  for (let b = 0; b < bins; b++) sumAll += (b + 0.5) * hist[b];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let bestT = 0;
  for (let b = 0; b < bins - 1; b++) {
    wB += hist[b];
    sumB += (b + 0.5) * hist[b];
    const wF = total - wB;
    if (wB === 0 || wF === 0) continue;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      bestT = b + 1;
    }
  }
  let wL = 0;
  let sL = 0;
  for (let b = 0; b < bestT; b++) {
    wL += hist[b];
    sL += (b + 0.5) * hist[b];
  }
  const wU = total - wL;
  return {
    threshold: bestT / 2,
    lowerMean: wL ? sL / wL / 2 : 0,
    upperMean: wU ? (sumAll - sL) / wU / 2 : 0,
    upperShare: wU / total,
  };
}

/**
 * Fit L ≈ c0 + c1·x + c2·y + c3·x² + c4·y² + c5·xy on the border (two reweighting passes against garment
 * pixels touching the frame) and subtract the variation. Returns null when the light is already even.
 */
function flattenIllumination(L: Float32Array, w: number, h: number, border: number[]): Float32Array | null {
  const feats = (i: number, f: Float64Array) => {
    const x = (i % w) / w - 0.5;
    const y = ((i / w) | 0) / h - 0.5;
    f[0] = 1;
    f[1] = x;
    f[2] = y;
    f[3] = x * x;
    f[4] = y * y;
    f[5] = x * y;
  };
  const f = new Float64Array(6);
  const step = Math.max(1, Math.floor(border.length / 3000));
  const pts = border.filter((_, k) => k % step === 0);
  let weights = new Float32Array(pts.length).fill(1);
  let coef: number[] | null = null;
  const evalAt = (i: number) => {
    feats(i, f);
    return coef![0] + coef![1] * f[1] + coef![2] * f[2] + coef![3] * f[3] + coef![4] * f[4] + coef![5] * f[5];
  };
  for (let pass = 0; pass < 3; pass++) {
    const M = Array.from({ length: 6 }, () => new Array<number>(7).fill(0));
    pts.forEach((i, k) => {
      const wt = weights[k];
      if (!wt) return;
      feats(i, f);
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) M[r][c] += wt * f[r] * f[c];
        M[r][6] += wt * f[r] * L[i];
      }
    });
    coef = solve(M);
    if (!coef) return null;
    const res = pts.map((i) => Math.abs(L[i] - evalAt(i)));
    const sorted = [...res].sort((a, b) => a - b);
    const mad = Math.max(1.5, sorted[Math.floor(sorted.length / 2)]);
    weights = Float32Array.from(res, (v) => (v < 3 * mad ? 1 : 0));
  }
  if (!coef) return null;
  const n = w * h;
  const fit = new Float32Array(n);
  let fmin = Infinity;
  let fmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = evalAt(i);
    fit[i] = v;
    if (v < fmin) fmin = v;
    if (v > fmax) fmax = v;
  }
  if (fmax - fmin < 5) return null;
  let ref = 0;
  let cnt = 0;
  pts.forEach((i, k) => {
    if (weights[k]) {
      ref += fit[i];
      cnt++;
    }
  });
  ref /= cnt || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = L[i] - Math.max(-30, Math.min(30, fit[i] - ref));
  return out;
}

function solve(M: number[][]): number[] | null {
  const n = M.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fct = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= fct * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Sobel magnitude on L plus half-weighted a/b, in Lab units (≈ step height for a sharp edge). */
function gradient(L: Float32Array, A: Float32Array, B: Float32Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  const sq = (C: Float32Array, ym: number, yc: number, yp: number, xm: number, x: number, xp: number) => {
    const gx = C[ym + xp] + 2 * C[yc + xp] + C[yp + xp] - C[ym + xm] - 2 * C[yc + xm] - C[yp + xm];
    const gy = C[yp + xm] + 2 * C[yp + x] + C[yp + xp] - C[ym + xm] - 2 * C[ym + x] - C[ym + xp];
    return (gx * gx + gy * gy) / 64;
  };
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w;
    const yc = y * w;
    const yp = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : x;
      g[yc + x] = Math.sqrt(sq(L, ym, yc, yp, xm, x, xp) + 0.5 * (sq(A, ym, yc, yp, xm, x, xp) + sq(B, ym, yc, yp, xm, x, xp)));
    }
  }
  return g;
}

function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = m[i] && (x === 0 || m[i - 1]) && (x === w - 1 || m[i + 1]) && (y === 0 || m[i - w]) && (y === h - 1 || m[i + w]) ? 1 : 0;
    }
  return out;
}

function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ? 1 : 0;
    }
  return out;
}

function kmeansLab(idx: number[], L: Float32Array, A: Float32Array, B: Float32Array, k: number): Model[] {
  const rand = mulberry32(7);
  const pts = idx.length > 4000 ? idx.filter((_, i) => i % Math.ceil(idx.length / 4000) === 0) : idx;
  if (!pts.length) return [];
  const d2 = (p: number, c: { l: number; a: number; b: number }) => (L[p] - c.l) ** 2 + (A[p] - c.a) ** 2 + (B[p] - c.b) ** 2;
  // k-means++ seeding spreads the initial centers over the distinct border colors.
  const first = pts[Math.floor(rand() * pts.length)];
  const centers = [{ l: L[first], a: A[first], b: B[first] }];
  while (centers.length < k) {
    const d = pts.map((p) => {
      let m = Infinity;
      for (const c of centers) m = Math.min(m, d2(p, c));
      return m;
    });
    const sum = d.reduce((s, v) => s + v, 0);
    if (sum <= 0) break;
    let t = rand() * sum;
    let j = 0;
    for (; j < d.length - 1; j++) {
      t -= d[j];
      if (t <= 0) break;
    }
    centers.push({ l: L[pts[j]], a: A[pts[j]], b: B[pts[j]] });
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 10; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = d2(p, centers[j]);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      assign[i] = best;
      const a = acc[best];
      a[0] += L[p];
      a[1] += A[p];
      a[2] += B[p];
      a[3]++;
    }
    centers.forEach((c, j) => {
      const a = acc[j];
      if (a[3]) {
        c.l = a[0] / a[3];
        c.a = a[1] / a[3];
        c.b = a[2] / a[3];
      }
    });
  }
  return centers.map((c, j) => {
    const ds: number[] = [];
    for (let i = 0; i < pts.length; i++) if (assign[i] === j) ds.push(Math.sqrt(d2(pts[i], c)));
    ds.sort((a, b) => a - b);
    // Median distance: robust against a few garment pixels that touch the frame.
    return { ...c, share: ds.length / pts.length, spread: ds.length ? ds[Math.floor(ds.length / 2)] : 0 };
  });
}
