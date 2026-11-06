// 2D helpers for the virtual try-on: points, affine maps between triangles, polylines.

export interface P {
  x: number;
  y: number;
}

export const pt = (x: number, y: number): P => ({ x, y });
export const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
export const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
export const len = (a: P) => Math.hypot(a.x, a.y);
export const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a: P): P => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Perpendicular, rotated +90° in image coordinates (y down). */
export const perp = (a: P): P => ({ x: -a.y, y: a.x });
export const angle = (a: P) => Math.atan2(a.y, a.x);
export const rotate = (a: P, rad: number): P => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Canvas transform (a, b, c, d, e, f) that maps the source triangle onto the destination triangle. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function affineFromTriangles(s: [P, P, P], d: [P, P, P]): Affine | null {
  const [s0, s1, s2] = s;
  const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(den) < 1e-9) return null;
  // Solve for x' = a·x + c·y + e and y' = b·x + d·y + f.
  const solve = (v0: number, v1: number, v2: number) => {
    const p = ((v1 - v0) * (s2.y - s0.y) - (v2 - v0) * (s1.y - s0.y)) / den;
    const q = ((v2 - v0) * (s1.x - s0.x) - (v1 - v0) * (s2.x - s0.x)) / den;
    return [p, q, v0 - p * s0.x - q * s0.y];
  };
  const [a, c, e] = solve(d[0].x, d[1].x, d[2].x);
  const [b, dd, f] = solve(d[0].y, d[1].y, d[2].y);
  return { a, b, c, d: dd, e, f };
}

export const applyAffine = (m: Affine, p: P): P => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

export const triArea = (t: [P, P, P]) => ((t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y)) / 2;

/** Arc-length parametrised polyline; points before the start or past the end are extrapolated. */
export class Polyline {
  private cum: number[] = [0];
  constructor(private pts: P[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + dist(pts[i - 1], pts[i]));
  }
  get length() {
    return this.cum[this.cum.length - 1];
  }
  private seg(s: number) {
    let i = 0;
    while (i < this.pts.length - 2 && s > this.cum[i + 1]) i++;
    return i;
  }
  at(s: number): P {
    if (this.pts.length === 1) return this.pts[0];
    const i = this.seg(s);
    const d = norm(sub(this.pts[i + 1], this.pts[i]));
    return add(this.pts[i], mul(d, s - this.cum[i]));
  }
  /** Unit direction, blended over ±`blend` around joints so sleeves and legs bend smoothly. */
  dir(s: number, blend = 0): P {
    if (this.pts.length === 1) return pt(0, 1);
    const i = this.seg(s);
    let d = norm(sub(this.pts[i + 1], this.pts[i]));
    if (blend > 0) {
      // Same weight function on both sides of a joint J, so the direction is continuous through it.
      if (i + 2 < this.pts.length && s > this.cum[i + 1] - blend) {
        const nd = norm(sub(this.pts[i + 2], this.pts[i + 1]));
        d = norm(lerp(d, nd, smoothstep(this.cum[i + 1] - blend, this.cum[i + 1] + blend, s)));
      } else if (i > 0 && s < this.cum[i] + blend) {
        const pd = norm(sub(this.pts[i], this.pts[i - 1]));
        d = norm(lerp(pd, d, smoothstep(this.cum[i] - blend, this.cum[i] + blend, s)));
      }
    }
    return d;
  }
}
