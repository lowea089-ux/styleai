// Shape analysis of a cut-out garment image for the virtual try-on.
//
// From the alpha mask we find where the torso, shoulder seams, armpits and sleeves of a top are, or the
// waistband, crotch and both legs of trousers. The layout step (layout.ts) then maps exactly these parts
// onto the body. Works on flat-lay and hanger photos; all values are in analysis-image pixels.
import { dist, dot, mid, norm, perp, pt, sub, type P } from "./geometry";

export type GarmentKind = "top" | "onepiece" | "bottom" | "shoes" | "head" | "scarf" | "belt" | "bag" | "watch";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Station {
  /** Fraction along the strip axis (0 = root, 1 = tip). */
  t: number;
  /** Offset of the strip center along `normal`. */
  offset: number;
  /** Half width across the strip. */
  half: number;
}

/** A sleeve or trouser leg: an axis from root to tip with measured widths. */
export interface StripShape {
  origin: P;
  axis: P;
  normal: P;
  length: number;
  stations: Station[];
}

export interface SleeveShape extends StripShape {
  /** Shoulder seam point and armpit point on the torso edge. */
  rootTop: P;
  rootBottom: P;
}

export interface TopShape {
  kind: "top" | "onepiece";
  w: number;
  h: number;
  box: Box;
  /** Torso edges (columns) and center. */
  lT: number;
  rT: number;
  yTop: number;
  yShoulder: number;
  yArm: number;
  yHem: number;
  /** Sleeve pixels: x < lT (left) or x > rT (right), and y < sleeveYLimit. */
  sleeveYLimit: number;
  sleeves: { left: SleeveShape | null; right: SleeveShape | null };
}

export interface BottomShape {
  kind: "bottom";
  w: number;
  h: number;
  box: Box;
  yWaist: number;
  waistL: number;
  waistR: number;
  yCrotch: number | null;
  splitX: number;
  yHem: number;
  legs: { left: StripShape; right: StripShape } | null;
}

export interface FlatShape {
  kind: "shoes" | "head" | "scarf" | "belt" | "bag" | "watch";
  w: number;
  h: number;
  box: Box;
  /** Shoes: x where a side-by-side pair splits into left and right shoe. */
  pairSplit: number | null;
}

export type GarmentShape = TopShape | BottomShape | FlatShape;

interface Run {
  l: number;
  r: number;
}

class Mask {
  readonly m: Uint8Array;
  count = 0;
  constructor(
    alpha: ArrayLike<number>,
    readonly w: number,
    readonly h: number,
  ) {
    this.m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (alpha[i] > 110) (this.m[i] = 1), this.count++;
  }
  at(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.m[y * this.w + x] : 0;
  }
  /**
   * Runs of a row; gaps narrower than `gap` are bridged. With `center`, only gaps near the middle are
   * bridged (open jacket, zip line) – a narrow gap at the side separates a hanging sleeve from the body.
   */
  runs(y: number, gap: number, center?: { x: number; band: number }): Run[] {
    const out: Run[] = [];
    let start = -1;
    for (let x = 0; x <= this.w; x++) {
      const on = x < this.w && this.at(x, Math.round(y));
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        const last = out[out.length - 1];
        const gapMid = last ? (last.r + start) / 2 : 0;
        if (last && start - last.r - 1 < gap && (!center || Math.abs(gapMid - center.x) < center.band)) last.r = x - 1;
        else out.push({ l: start, r: x - 1 });
        start = -1;
      }
    }
    return out;
  }
  /** The run containing x, or the nearest one; gaps are only bridged around x. */
  runNear(y: number, x: number, gap: number, band = Infinity): Run | null {
    let best: Run | null = null;
    let bd = Infinity;
    for (const r of this.runs(y, gap, { x, band })) {
      const d = x < r.l ? r.l - x : x > r.r ? x - r.r : 0;
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Drop specks: keep connected components with at least `minShare` of all mask pixels. */
function cleanSpecks(mask: Mask, minShare: number): { comps: Box[] } {
  const { w, h, m } = mask;
  const label = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  const comps: { box: Box; pixels: number[] }[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || label[i] >= 0) continue;
    let qh = 0;
    let qt = 0;
    queue[qt++] = i;
    label[i] = comps.length;
    const pixels: number[] = [];
    const box = { x0: w, y0: h, x1: -1, y1: -1 };
    while (qh < qt) {
      const k = queue[qh++];
      pixels.push(k);
      const x = k % w;
      const y = (k / w) | 0;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      for (const j of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
        if (j >= 0 && m[j] && label[j] < 0) {
          label[j] = comps.length;
          queue[qt++] = j;
        }
      }
    }
    comps.push({ box, pixels });
  }
  const kept: Box[] = [];
  let count = 0;
  for (const c of comps) {
    if (c.pixels.length < mask.count * minShare) for (const k of c.pixels) m[k] = 0;
    else {
      kept.push(c.box);
      count += c.pixels.length;
    }
  }
  mask.count = count;
  return { comps: kept };
}

function bbox(mask: Mask): Box | null {
  let x0 = mask.w;
  let y0 = mask.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < mask.h; y++)
    for (let x = 0; x < mask.w; x++)
      if (mask.m[y * mask.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Measure center offset and half width of a strip at the given axial fractions. */
function measureStrip(pixels: P[], origin: P, axis: P, normal: P, length: number, ts: number[]): Station[] {
  const bins = ts.map(() => ({ lo: Infinity, hi: -Infinity }));
  for (const p of pixels) {
    const rel = sub(p, origin);
    const t = dot(rel, axis) / length;
    const v = dot(rel, normal);
    ts.forEach((tt, k) => {
      if (Math.abs(t - tt) <= 0.08) {
        bins[k].lo = Math.min(bins[k].lo, v);
        bins[k].hi = Math.max(bins[k].hi, v);
      }
    });
  }
  const st: (Station | null)[] = ts.map((t, k) => (bins[k].hi >= bins[k].lo ? { t, offset: (bins[k].lo + bins[k].hi) / 2, half: (bins[k].hi - bins[k].lo) / 2 + 0.5 } : null));
  // Fill gaps from neighbours (or a plausible default when nothing was measured).
  return st.map((s, k) => {
    if (s) return s;
    const prev = st.slice(0, k).reverse().find(Boolean);
    const next = st.slice(k + 1).find(Boolean);
    const ref = prev ?? next;
    return { t: ts[k], offset: ref?.offset ?? 0, half: ref?.half ?? length * 0.25 };
  });
}

export function analyzeGarment(alpha: ArrayLike<number>, w: number, h: number, kind: GarmentKind): GarmentShape | null {
  const mask = new Mask(alpha, w, h);
  if (mask.count < 30) return null;
  const { comps } = cleanSpecks(mask, kind === "shoes" ? 0.08 : 0.04);
  const box = bbox(mask);
  if (!box) return null;
  if (kind === "top" || kind === "onepiece") return analyzeTop(mask, box, kind);
  if (kind === "bottom") return analyzeBottom(mask, box);
  let pairSplit: number | null = null;
  if (kind === "shoes" && comps.length >= 2) {
    const [a, b] = [...comps].sort((p, q) => (q.x1 - q.x0) * (q.y1 - q.y0) - (p.x1 - p.x0) * (p.y1 - p.y0)).slice(0, 2).sort((p, q) => p.x0 - q.x0);
    const overlap = Math.max(0, a.x1 - b.x0);
    if (overlap < 0.2 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) pairSplit = (Math.min(a.x1, b.x0) + Math.max(a.x1, b.x0)) / 2;
  }
  return { kind, w, h, box, pairSplit };
}

function analyzeTop(mask: Mask, box: Box, kind: "top" | "onepiece"): TopShape {
  const H = box.y1 - box.y0 + 1;
  const W = box.x1 - box.x0 + 1;
  const gap = Math.max(2, Math.round(W * 0.06));
  const band = W * 0.12;
  const yAt = (f: number) => Math.round(box.y0 + f * H);

  // Torso center from the lower body, which never contains horizontal sleeves.
  const xs: number[] = [];
  for (let y = yAt(0.55); y <= yAt(0.85); y++) for (let x = box.x0; x <= box.x1; x++) if (mask.at(x, y)) xs.push(x);
  const cx = median(xs);
  const runAt = (y: number) => mask.runNear(y, cx, gap, band);
  const lower: number[] = [];
  for (let y = yAt(0.55); y <= yAt(0.85); y++) {
    const r = runAt(y);
    if (r) lower.push(r.r - r.l + 1);
  }
  const wTorso = median(lower);

  // Armpit: the lowest row (scanning upwards) where sleeves make the row clearly wider than the torso.
  let yArm: number | null = null;
  for (let y = yAt(0.72); y >= box.y0; y--) {
    const r = runAt(y);
    if (r && r.r - r.l + 1 > 1.15 * wTorso + 2) {
      yArm = y + 1;
      break;
    }
  }
  const horizontalSleeves = yArm !== null;
  const arm = yArm ?? yAt(0.3);

  const ls: number[] = [];
  const rs: number[] = [];
  for (let y = Math.round(arm + 0.03 * H); y <= Math.round(arm + 0.2 * H); y++) {
    const r = runAt(y);
    if (r) ls.push(r.l), rs.push(r.r);
  }
  const lT = ls.length ? median(ls) : box.x0;
  const rT = rs.length ? median(rs) : box.x1;

  let yTop = box.y1;
  let yHem = box.y0;
  for (let x = lT; x <= rT; x++)
    for (let y = box.y0; y <= box.y1; y++)
      if (mask.at(x, y)) {
        yTop = Math.min(yTop, y);
        yHem = Math.max(yHem, y);
      }
  const firstY = (x: number) => {
    for (let y = box.y0; y <= box.y1; y++) if (mask.at(Math.round(x), y)) return y;
    return yTop;
  };
  const inset = 0.12 * (rT - lT);
  let yShoulder = (firstY(lT + inset) + firstY(rT - inset)) / 2;
  yShoulder = Math.max(yTop, Math.min(yTop + 0.25 * H, yShoulder));

  const sleeveYLimit = kind === "onepiece" ? arm + 0.35 * H : box.y0 + 0.93 * H;
  const sleeve = (side: "left" | "right"): SleeveShape | null => {
    const pixels: P[] = [];
    for (let y = box.y0; y < sleeveYLimit; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        const outside = side === "left" ? x < lT - 1 : x > rT + 1;
        if (outside && mask.at(x, y)) pixels.push(pt(x, y));
      }
    if (pixels.length < Math.max(12, mask.count * 0.015)) return null;
    const edge = side === "left" ? lT : rT;
    const tipFrom = (root: P) => {
      let maxD = 0;
      for (const p of pixels) maxD = Math.max(maxD, dist(p, root));
      let tx = 0;
      let ty = 0;
      let tn = 0;
      for (const p of pixels)
        if (dist(p, root) >= 0.9 * maxD) {
          tx += p.x;
          ty += p.y;
          tn++;
        }
      return pt(tx / tn, ty / tn);
    };
    // Sideways sleeve: the armhole is the torso edge between shoulder seam and armpit.
    let rootTop = pt(edge, yShoulder);
    let rootBottom = pt(edge, horizontalSleeves ? arm : yShoulder + 0.25 * H);
    let root = mid(rootTop, rootBottom);
    let tip = tipFrom(root);
    if (Math.abs(norm(sub(tip, root)).y) > 0.8) {
      // Hanging sleeve (hanger photo, folded flat-lay): its axis runs parallel to the torso edge, so it is
      // attached across its top end – from the outer shoulder point to the armpit at the torso.
      const top = Math.min(...pixels.map((p) => p.y));
      const topRow = pixels.filter((p) => p.y <= top + Math.max(2, 0.04 * H)).map((p) => p.x);
      const outer = side === "left" ? Math.min(...topRow) : Math.max(...topRow);
      rootTop = pt(outer, top);
      rootBottom = pt(edge, top + 0.04 * H);
      root = mid(rootTop, rootBottom);
      tip = tipFrom(root);
    }
    const length = dist(tip, root);
    if (length < 3) return null;
    const axis = norm(sub(tip, root));
    // The normal points to the shoulder side of the sleeve: up for a sideways sleeve, outwards for a
    // hanging one – in both cases away from the armpit.
    let normal = perp(axis);
    if (dot(normal, pt(side === "left" ? -1 : 1, -1)) < 0) normal = { x: -normal.x, y: -normal.y };
    const stations = measureStrip(pixels, root, axis, normal, length, [0.2, 0.4, 0.6, 0.8, 1]);
    return { origin: root, axis, normal, length, stations, rootTop, rootBottom };
  };

  return {
    kind,
    w: mask.w,
    h: mask.h,
    box,
    lT,
    rT,
    yTop,
    yShoulder,
    yArm: arm,
    yHem,
    sleeveYLimit,
    sleeves: { left: sleeve("left"), right: sleeve("right") },
  };
}

function analyzeBottom(mask: Mask, box: Box): BottomShape {
  const H = box.y1 - box.y0 + 1;
  const W = box.x1 - box.x0 + 1;
  const gap = Math.max(2, Math.round(W * 0.06));
  const xs: number[] = [];
  for (let y = box.y0; y <= box.y0 + 0.15 * H; y++) for (let x = box.x0; x <= box.x1; x++) if (mask.at(x, y)) xs.push(x);
  const cx0 = median(xs);
  const yWaist = box.y0;
  const wr = mask.runNear(box.y0 + Math.max(1, 0.03 * H), cx0, gap) ?? { l: box.x0, r: box.x1 };
  const cx = (wr.l + wr.r) / 2;

  // Crotch: first row from which the middle stays empty while both legs continue.
  const small = Math.max(1, Math.round(W * 0.015));
  const gapAt = (y: number) => {
    const runs = mask.runs(y, small);
    const hit = runs.some((r) => r.l <= cx + 1 && r.r >= cx - 1);
    return !hit && runs.some((r) => r.r < cx) && runs.some((r) => r.l > cx);
  };
  let yCrotch: number | null = null;
  for (let y = Math.round(box.y0 + 0.18 * H); y <= box.y0 + 0.8 * H; y++) {
    if (gapAt(y) && gapAt(y + 2) && gapAt(y + 4)) {
      yCrotch = y;
      break;
    }
  }
  let splitX = cx;
  let legs: BottomShape["legs"] = null;
  if (yCrotch !== null) {
    const runs = mask.runs(Math.min(box.y1, yCrotch + 0.05 * H), small);
    const leftRun = runs.filter((r) => r.r < cx).pop();
    const rightRun = runs.find((r) => r.l > cx);
    if (leftRun && rightRun) splitX = (leftRun.r + rightRun.l) / 2;
    const leg = (side: "left" | "right"): StripShape | null => {
      const pixels: P[] = [];
      for (let y = yCrotch!; y <= box.y1; y++)
        for (let x = box.x0; x <= box.x1; x++) if ((side === "left" ? x < splitX : x > splitX) && mask.at(x, y)) pixels.push(pt(x, y));
      if (pixels.length < 12) return null;
      const centerAt = (y: number) => {
        const rr = mask.runs(y, small).filter((r) => (side === "left" ? r.r < splitX : r.l > splitX));
        if (!rr.length) return null;
        return pt((Math.min(...rr.map((r) => r.l)) + Math.max(...rr.map((r) => r.r))) / 2, y);
      };
      const top = centerAt(yCrotch! + 2) ?? pt(side === "left" ? (box.x0 + splitX) / 2 : (splitX + box.x1) / 2, yCrotch!);
      const bottom = centerAt(box.y1 - Math.max(1, Math.round(0.02 * H))) ?? pt(top.x, box.y1);
      const length = dist(top, bottom);
      if (length < 3) return null;
      const axis = norm(sub(bottom, top));
      const normal = perp(axis);
      const stations = measureStrip(pixels, top, axis, normal, length, [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1]);
      return { origin: top, axis, normal, length, stations };
    };
    const left = leg("left");
    const right = leg("right");
    if (left && right) legs = { left, right };
    else yCrotch = null;
  }
  return { kind: "bottom", w: mask.w, h: mask.h, box, yWaist, waistL: wr.l, waistR: wr.r, yCrotch, splitX, yHem: box.y1, legs };
}
