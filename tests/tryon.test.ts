import { describe, expect, it } from "vitest";
import { analyzeGarment, type BottomShape, type TopShape } from "../shared/tryon/anchors";
import { LandmarkSmoother, OneEuroFilter } from "../shared/tryon/filter";
import { affineFromTriangles, applyAffine, Polyline, pt, type P } from "../shared/tryon/geometry";
import { bodyFromPose, layoutGarment, LM, type Landmark, type PieceDraw } from "../shared/tryon/layout";

type Pt = [number, number];
const TSHIRT: Pt[] = [
  [0.4, 0.18], [0.3, 0.2], [0.14, 0.32], [0.2, 0.42], [0.32, 0.36], [0.32, 0.84],
  [0.68, 0.84], [0.68, 0.36], [0.8, 0.42], [0.86, 0.32], [0.7, 0.2], [0.6, 0.18], [0.5, 0.24],
];
const PANTS: Pt[] = [[0.3, 0.05], [0.7, 0.05], [0.72, 0.95], [0.53, 0.95], [0.5, 0.4], [0.47, 0.95], [0.28, 0.95]];

function rasterize(poly: Pt[], w: number, h: number) {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5) / w;
      const py = (y + 0.5) / h;
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
      }
      a[y * w + x] = c ? 255 : 0;
    }
  return a;
}

/** Frontal pose, person facing the camera: their right side is image-left. */
function pose(overrides: Partial<Record<number, [number, number]>> = {}): Landmark[] {
  const base: Record<number, [number, number]> = {
    [LM.rightShoulder]: [420, 300],
    [LM.leftShoulder]: [580, 300],
    [LM.rightHip]: [440, 500],
    [LM.leftHip]: [560, 500],
    [LM.rightElbow]: [410, 420],
    [LM.leftElbow]: [590, 420],
    [LM.rightWrist]: [405, 530],
    [LM.leftWrist]: [595, 530],
    [LM.rightKnee]: [445, 680],
    [LM.leftKnee]: [555, 680],
    [LM.rightAnkle]: [447, 850],
    [LM.leftAnkle]: [553, 850],
    ...overrides,
  };
  return Array.from({ length: 33 }, (_, i) => (base[i] ? { x: base[i][0], y: base[i][1], visibility: 0.95 } : { x: 0, y: 0, visibility: 0.05 }));
}

const verts = (p: PieceDraw | undefined) => (p ? p.tris.flatMap((t) => t.dst) : []);

/** Where a source pixel of the garment lands: affine map of the mesh triangle that contains it. */
function mapPoint(piece: PieceDraw, p: P): P {
  for (const t of piece.tris) {
    const [a, b, c] = t.src;
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    const l1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / den;
    const l2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / den;
    if (l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6) return applyAffine(affineFromTriangles(t.src, t.dst)!, p);
  }
  throw new Error("point outside mesh");
}
const bounds = (ps: P[]) => ({
  x0: Math.min(...ps.map((p) => p.x)),
  x1: Math.max(...ps.map((p) => p.x)),
  y0: Math.min(...ps.map((p) => p.y)),
  y1: Math.max(...ps.map((p) => p.y)),
});

describe("geometry", () => {
  it("maps triangles exactly, including mirrored ones", () => {
    const s: [P, P, P] = [pt(0, 0), pt(10, 0), pt(0, 20)];
    const d: [P, P, P] = [pt(5, 5), pt(-15, 8), pt(7, 45)];
    const m = affineFromTriangles(s, d)!;
    s.forEach((p, i) => {
      const q = applyAffine(m, p);
      expect(q.x).toBeCloseTo(d[i].x, 6);
      expect(q.y).toBeCloseTo(d[i].y, 6);
    });
    expect(affineFromTriangles([pt(0, 0), pt(1, 1), pt(2, 2)], d)).toBeNull();
  });

  it("walks polylines by arc length and bends smoothly at joints", () => {
    const pl = new Polyline([pt(0, 0), pt(0, 10), pt(10, 10)]);
    expect(pl.length).toBe(20);
    expect(pl.at(15)).toEqual({ x: 5, y: 10 });
    expect(pl.at(-5)).toEqual({ x: 0, y: -5 });
    const before = pl.dir(9.999, 2);
    const after = pl.dir(10.001, 2);
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(0.01);
  });
});

describe("garment shape analysis", () => {
  it("finds torso, armpits and both sleeves of a flat-lay T-shirt", () => {
    const w = 220;
    const h = 180;
    const s = analyzeGarment(rasterize(TSHIRT, w, h), w, h, "top") as TopShape;
    expect(s.kind).toBe("top");
    expect(Math.abs(s.lT - 0.32 * w)).toBeLessThan(4);
    expect(Math.abs(s.rT - 0.68 * w)).toBeLessThan(4);
    expect(Math.abs(s.yArm - 0.36 * h)).toBeLessThan(0.05 * h);
    expect(s.yShoulder).toBeLessThan(s.yArm);
    const left = s.sleeves.left!;
    const right = s.sleeves.right!;
    expect(left.axis.x).toBeLessThan(0);
    expect(right.axis.x).toBeGreaterThan(0);
    // The normal points to the shoulder (upper) side of the sleeve.
    expect(left.normal.y).toBeLessThan(0);
    expect(left.length).toBeGreaterThan(0.12 * w);
  });

  it("separates hanging sleeves from the body even across a narrow seam gap", () => {
    const w = 200;
    const h = 220;
    const parts: Pt[][] = [
      [[0.3, 0.15], [0.7, 0.15], [0.7, 0.95], [0.3, 0.95]],
      [[0.12, 0.1], [0.88, 0.1], [0.88, 0.25], [0.12, 0.25]],
      [[0.12, 0.1], [0.285, 0.1], [0.285, 0.85], [0.12, 0.85]],
      [[0.715, 0.1], [0.88, 0.1], [0.88, 0.85], [0.715, 0.85]],
    ];
    const layers = parts.map((p) => rasterize(p, w, h));
    const a = layers[0].map((_, i) => Math.max(...layers.map((l) => l[i])));
    const s = analyzeGarment(a, w, h, "top") as TopShape;
    expect(Math.abs(s.lT - 0.3 * w)).toBeLessThan(4);
    expect(Math.abs(s.rT - 0.7 * w)).toBeLessThan(4);
    const left = s.sleeves.left!;
    expect(left.axis.y).toBeGreaterThan(0.9);
    const widest = Math.max(...left.stations.map((st) => st.half));
    expect(widest).toBeGreaterThan(0.06 * w);
    // Attached across its top end: shoulder side outwards, armpit side at the torso.
    expect(left.rootTop.x).toBeLessThan(left.rootBottom.x);
    expect(Math.abs(left.rootTop.y - left.rootBottom.y)).toBeLessThan(0.06 * h);
    expect(left.normal.x).toBeLessThan(0);

    // Raising the arm sideways must swing the whole sleeve up, armpit included.
    const r = layoutGarment(s, bodyFromPose(pose({ [LM.rightElbow]: [300, 305], [LM.rightWrist]: [190, 310] }))!, { size: 1, length: 1 });
    if (!r.ok) throw new Error(r.reason);
    const sleeve = r.pieces.find((p) => p.piece === "sleeveL")!;
    const tip = sleeve.tris[sleeve.tris.length - 1].dst;
    const c = { x: (tip[0].x + tip[1].x + tip[2].x) / 3, y: (tip[0].y + tip[1].y + tip[2].y) / 3 };
    expect(Math.abs(c.y - 310)).toBeLessThan(50);
    expect(c.x).toBeLessThan(250);
  });

  it("finds the crotch and both legs of trousers", () => {
    const w = 160;
    const h = 220;
    const s = analyzeGarment(rasterize(PANTS, w, h), w, h, "bottom") as BottomShape;
    expect(s.legs).not.toBeNull();
    expect(Math.abs(s.yCrotch! - 0.4 * h)).toBeLessThan(0.08 * h);
    expect(s.legs!.left.origin.x).toBeLessThan(s.splitX);
    expect(s.legs!.right.origin.x).toBeGreaterThan(s.splitX);
    expect(s.legs!.left.axis.y).toBeGreaterThan(0.9);
  });

  it("treats a skirt (no leg gap) as one piece", () => {
    const skirt: Pt[] = [[0.35, 0.1], [0.65, 0.1], [0.8, 0.9], [0.2, 0.9]];
    const s = analyzeGarment(rasterize(skirt, 160, 160), 160, 160, "bottom") as BottomShape;
    expect(s.legs).toBeNull();
    expect(s.yCrotch).toBeNull();
  });

  it("splits a side-by-side pair of shoes", () => {
    const pair: Pt[][] = [
      [[0.05, 0.4], [0.45, 0.4], [0.45, 0.7], [0.05, 0.7]],
      [[0.55, 0.4], [0.95, 0.4], [0.95, 0.7], [0.55, 0.7]],
    ];
    const a = rasterize(pair[0], 200, 100);
    const b = rasterize(pair[1], 200, 100);
    const s = analyzeGarment(a.map((v, i) => Math.max(v, b[i])), 200, 100, "shoes");
    expect(s && "pairSplit" in s && s.pairSplit).toBeGreaterThan(85);
    expect(s && "pairSplit" in s && s.pairSplit).toBeLessThan(115);
  });
});

describe("try-on layout", () => {
  const shirt = analyzeGarment(rasterize(TSHIRT, 220, 180), 220, 180, "top")!;
  const pants = analyzeGarment(rasterize(PANTS, 160, 220), 160, 220, "bottom")!;

  it("puts the shirt on the shoulders with the hem below the hips", () => {
    const b = bodyFromPose(pose())!;
    const r = layoutGarment(shirt, b, { size: 1, length: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = shirt as TopShape;
    const torso = r.pieces.find((p) => p.piece === "torso")!;
    const cx = (s.lT + s.rT) / 2;
    const leftEdge = mapPoint(torso, pt(s.lT, s.yArm + 4));
    const rightEdge = mapPoint(torso, pt(s.rT, s.yArm + 4));
    // Torso edges just outside the shoulder joints (420 / 580).
    expect(leftEdge.x).toBeGreaterThan(370);
    expect(leftEdge.x).toBeLessThan(420);
    expect(rightEdge.x).toBeGreaterThan(580);
    expect(rightEdge.x).toBeLessThan(630);
    expect(mapPoint(torso, pt(cx, s.yTop + 1)).y).toBeLessThan(300);
    const hem = mapPoint(torso, pt(cx, s.yHem - 1)).y;
    expect(hem).toBeGreaterThan(500);
    expect(hem).toBeLessThan(680);
  });

  it("lets short sleeves hang along the arms and follow a raised arm", () => {
    const sleeveEnd = (lms: Landmark[]) => {
      const r = layoutGarment(shirt, bodyFromPose(lms)!, { size: 1, length: 1 });
      if (!r.ok) throw new Error(r.reason);
      const tris = r.pieces.find((p) => p.piece === "sleeveL")!.tris;
      const last = tris[tris.length - 1].dst;
      return { x: (last[0].x + last[1].x + last[2].x) / 3, y: (last[0].y + last[1].y + last[2].y) / 3 };
    };
    const down = sleeveEnd(pose());
    expect(down.y).toBeGreaterThan(370);
    expect(Math.abs(down.x - 410)).toBeLessThan(60);
    const raised = sleeveEnd(pose({ [LM.rightElbow]: [300, 305], [LM.rightWrist]: [190, 310] }));
    expect(raised.x).toBeLessThan(360);
    expect(Math.abs(raised.y - 305)).toBeLessThan(60);
  });

  it("centers a short sleeve with a deep armhole on a raised arm", () => {
    const boxy: Pt[] = [[0.12, 0.15], [0.88, 0.15], [0.88, 0.45], [0.72, 0.45], [0.72, 0.95], [0.28, 0.95], [0.28, 0.45], [0.12, 0.45]];
    const s = analyzeGarment(rasterize(boxy, 220, 220), 220, 220, "top")!;
    const r = layoutGarment(s, bodyFromPose(pose({ [LM.rightElbow]: [300, 305], [LM.rightWrist]: [190, 310] }))!, { size: 1, length: 1 });
    if (!r.ok) throw new Error(r.reason);
    const tris = r.pieces.find((p) => p.piece === "sleeveL")!.tris;
    // Midpoints of the A/B pairs past the armhole: they must sit on the shoulder → elbow line (y ≈ 300–305).
    const mids = tris.filter((_, i) => i % 2 === 0 && i > 0).map((t) => (t.dst[0].y + t.dst[1].y) / 2);
    const avg = mids.reduce((a, b) => a + b, 0) / mids.length;
    expect(Math.abs(avg - 303)).toBeLessThan(25);
  });

  it("ends full-length trousers at the ankles and keeps legs separate", () => {
    const b = bodyFromPose(pose())!;
    const r = layoutGarment(pants, b, { size: 1, length: 1 }, { legCoverage: "full" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const legL = bounds(verts(r.pieces.find((p) => p.piece === "legL")));
    const legR = bounds(verts(r.pieces.find((p) => p.piece === "legR")));
    expect(Math.abs(legL.y1 - 860)).toBeLessThan(45);
    expect(legL.x1).toBeLessThan(legR.x1);
    const pelvis = bounds(verts(r.pieces.find((p) => p.piece === "pelvis")));
    // Waistband sits above the hip joints.
    expect(pelvis.y0).toBeLessThan(500);
  });

  it("reports what is missing instead of guessing", () => {
    const noBody = pose();
    for (const i of [LM.rightShoulder, LM.leftShoulder, LM.rightHip, LM.leftHip]) noBody[i].visibility = 0.1;
    expect(bodyFromPose(noBody)).toBeNull();
    const shoes = analyzeGarment(rasterize([[0.1, 0.3], [0.9, 0.3], [0.9, 0.7], [0.1, 0.7]], 100, 60), 100, 60, "shoes")!;
    const r = layoutGarment(shoes, bodyFromPose(pose())!, { size: 1, length: 1 });
    expect(r.ok).toBe(false);
  });
});

describe("landmark smoothing", () => {
  it("suppresses jitter while standing still and follows real movement", () => {
    const f = new OneEuroFilter();
    let seed = 1;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
    let maxDev = 0;
    for (let i = 0; i < 120; i++) {
      const v = f.filter(0.5 + noise(), i / 30);
      if (i > 10) maxDev = Math.max(maxDev, Math.abs(v - 0.5));
    }
    expect(maxDev).toBeLessThan(0.004);
    let v = 0;
    for (let i = 120; i < 140; i++) v = f.filter(0.7, i / 30);
    expect(Math.abs(v - 0.7)).toBeLessThan(0.01);
  });

  it("smooths whole poses", () => {
    const s = new LandmarkSmoother();
    const a = s.smooth([{ x: 0.5, y: 0.5, visibility: 1 }], 0);
    const b = s.smooth([{ x: 0.52, y: 0.5, visibility: 0 }], 1 / 30);
    expect(a[0].x).toBe(0.5);
    expect(b[0].x).toBeGreaterThan(0.5);
    expect(b[0].x).toBeLessThan(0.52);
    expect(b[0].visibility).toBeGreaterThan(0.5);
  });
});
