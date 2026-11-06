// Maps analysed garment shapes onto a detected body (MediaPipe pose landmarks, pixel coordinates).
//
// Each garment is split into pieces (torso + sleeves, pelvis + legs) that are drawn as triangle meshes.
// The torso follows the shoulder line and the body axis; sleeves follow shoulder → elbow → wrist, legs
// follow hip → knee → ankle. Near the joints the piece mapping blends into the torso/pelvis mapping, so
// sleeves stay attached at the armhole while the arm moves.
import type { BottomShape, FlatShape, GarmentShape, SleeveShape, StripShape, TopShape } from "./anchors";
import { add, angle, dist, lerp, mid, mul, norm, perp, Polyline, pt, rotate, smoothstep, sub, dot, type P } from "./geometry";

export interface Landmark {
  x: number;
  y: number;
  visibility: number;
}

/** MediaPipe pose landmark indices. "left/right" are the person's sides. */
export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
} as const;

/** Hand landmarks (wrist, pinky, index, thumb) of both hands. */
export const HAND_LANDMARKS = [15, 16, 17, 18, 19, 20, 21, 22];

// Body proportions used when a landmark is hidden, and for pose-independent garment scaling.
/** Expected frontal shoulder-landmark distance relative to the shoulder→hip length. */
export const SHOULDER_PER_TORSO = 0.8;
/** Expected frontal hip-landmark distance relative to the shoulder→hip length. */
export const HIP_PER_TORSO = 0.5;
/** Garment torso width relative to the shoulder-landmark distance (clothes extend past the joints). */
export const TOP_WIDTH = 1.22;
/** Trouser waist width relative to the expected frontal shoulder distance. */
export const BOTTOM_WIDTH = 0.92;

/**
 * Body in image coordinates. Suffix L = image-left, R = image-right; in an unmirrored camera image the
 * person faces the camera, so image-left is the person's right side.
 */
export interface Body {
  sL: P;
  sR: P;
  hL: P;
  hR: P;
  eL: P;
  eR: P;
  wL: P;
  wR: P;
  kL: P;
  kR: P;
  aL: P;
  aR: P;
  heelL: P | null;
  heelR: P | null;
  toeL: P | null;
  toeR: P | null;
  eyeL: P | null;
  eyeR: P | null;
  earL: P | null;
  earR: P | null;
  mouth: P | null;
  nose: P | null;
  ms: P;
  mh: P;
  /** Shoulder→hip length and shoulder distance in px. */
  T: number;
  D: number;
  /** Shoulder distance a frontal pose of this body would have. */
  Dfront: number;
  hipWidth: number;
  down: P;
  shoulderDir: P;
  hipDir: P;
  shouldersVisible: boolean;
  hipsVisible: boolean;
  hands: P[];
}

export function bodyFromPose(lm: Landmark[], minVis = 0.5): Body | null {
  const v = (i: number) => (lm[i] && lm[i].visibility >= minVis ? pt(lm[i].x, lm[i].y) : null);
  const s12 = v(LM.rightShoulder);
  const s11 = v(LM.leftShoulder);
  const h24 = v(LM.rightHip);
  const h23 = v(LM.leftHip);
  const shouldersVisible = !!(s12 && s11);
  const hipsVisible = !!(h24 && h23);
  if (!shouldersVisible && !hipsVisible) return null;

  let sL: P, sR: P, hL: P, hR: P;
  if (shouldersVisible && hipsVisible) {
    sL = s12!;
    sR = s11!;
    hL = h24!;
    hR = h23!;
  } else if (shouldersVisible) {
    sL = s12!;
    sR = s11!;
    const D = dist(sL, sR);
    const down = downOf(norm(sub(sR, sL)));
    const mh = add(mid(sL, sR), mul(down, D / SHOULDER_PER_TORSO));
    const half = mul(norm(sub(sR, sL)), (D / SHOULDER_PER_TORSO) * HIP_PER_TORSO * 0.5);
    hL = sub(mh, half);
    hR = add(mh, half);
  } else {
    hL = h24!;
    hR = h23!;
    const Hd = dist(hL, hR);
    const T = Hd / HIP_PER_TORSO;
    const up = mul(downOf(norm(sub(hR, hL))), -1);
    const ms = add(mid(hL, hR), mul(up, T));
    const half = mul(norm(sub(hR, hL)), T * SHOULDER_PER_TORSO * 0.5);
    sL = sub(ms, half);
    sR = add(ms, half);
  }
  const ms = mid(sL, sR);
  const mh = mid(hL, hR);
  const T = Math.max(1, dist(ms, mh));
  const D = dist(sL, sR);
  const down = norm(sub(mh, ms));
  const or = (p: P | null, fallback: P) => p ?? fallback;
  const eL = or(v(LM.rightElbow), add(sL, mul(down, 0.58 * T)));
  const eR = or(v(LM.leftElbow), add(sR, mul(down, 0.58 * T)));
  const wL = or(v(LM.rightWrist), add(eL, mul(down, 0.52 * T)));
  const wR = or(v(LM.leftWrist), add(eR, mul(down, 0.52 * T)));
  const kL = or(v(LM.rightKnee), add(hL, mul(down, 0.9 * T)));
  const kR = or(v(LM.leftKnee), add(hR, mul(down, 0.9 * T)));
  const aL = or(v(LM.rightAnkle), add(kL, mul(down, 0.85 * T)));
  const aR = or(v(LM.leftAnkle), add(kR, mul(down, 0.85 * T)));
  const ml = v(LM.mouthLeft);
  const mr = v(LM.mouthRight);
  return {
    sL,
    sR,
    hL,
    hR,
    eL,
    eR,
    wL,
    wR,
    kL,
    kR,
    aL,
    aR,
    heelL: v(LM.rightHeel),
    heelR: v(LM.leftHeel),
    toeL: v(LM.rightFoot),
    toeR: v(LM.leftFoot),
    eyeL: v(LM.rightEye),
    eyeR: v(LM.leftEye),
    earL: v(LM.rightEar),
    earR: v(LM.leftEar),
    mouth: ml && mr ? mid(ml, mr) : null,
    nose: v(LM.nose),
    ms,
    mh,
    T,
    D,
    Dfront: SHOULDER_PER_TORSO * T,
    hipWidth: dist(hL, hR),
    down,
    shoulderDir: norm(sub(sR, sL)),
    hipDir: norm(sub(hR, hL)),
    shouldersVisible,
    hipsVisible,
    hands: HAND_LANDMARKS.map(v).filter((p): p is P => !!p),
  };
}

/** Unit vector perpendicular to `across` that points down the image. */
function downOf(across: P): P {
  const p = perp(across);
  return p.y >= 0 ? p : mul(p, -1);
}

export type PieceId = "whole" | "torso" | "sleeveL" | "sleeveR" | "pelvis" | "legL" | "legR";

export interface Tri {
  src: [P, P, P];
  dst: [P, P, P];
}

export interface PieceDraw {
  piece: PieceId;
  tris: Tri[];
}

export interface Fit {
  /** Overall size (1 = default). */
  size: number;
  /** Length of torso, sleeves and legs (1 = default). */
  length: number;
}

export type LayoutResult = { ok: true; pieces: PieceDraw[] } | { ok: false; reason: string };

export interface LayoutOptions {
  legCoverage?: "full" | "short" | "none";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function layoutGarment(shape: GarmentShape, b: Body, fit: Fit, opts: LayoutOptions = {}): LayoutResult {
  switch (shape.kind) {
    case "top":
    case "onepiece":
      if (!b.shouldersVisible) return { ok: false, reason: "Schultern nicht im Bild" };
      return { ok: true, pieces: layoutTop(shape, b, fit) };
    case "bottom":
      if (!b.hipsVisible && !b.shouldersVisible) return { ok: false, reason: "Hüfte nicht im Bild" };
      return { ok: true, pieces: layoutBottom(shape, b, fit, opts.legCoverage ?? "full") };
    case "shoes": {
      const pieces = layoutShoes(shape, b);
      return pieces.length ? { ok: true, pieces } : { ok: false, reason: "Füße nicht im Bild" };
    }
    default: {
      const p = layoutAccessory(shape, b, fit);
      return p ? { ok: true, pieces: [p] } : { ok: false, reason: shape.kind === "head" ? "Kopf nicht erkannt" : "Position nicht erkannt" };
    }
  }
}

/** Grid mesh over a source rectangle with a point mapping. */
function gridMesh(xs: number[], ys: number[], map: (p: P) => P): Tri[] {
  const tris: Tri[] = [];
  const dst = ys.map((y) => xs.map((x) => map(pt(x, y))));
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      const s00 = pt(xs[i], ys[j]);
      const s10 = pt(xs[i + 1], ys[j]);
      const s01 = pt(xs[i], ys[j + 1]);
      const s11 = pt(xs[i + 1], ys[j + 1]);
      tris.push({ src: [s00, s10, s11], dst: [dst[j][i], dst[j][i + 1], dst[j + 1][i + 1]] });
      tris.push({ src: [s00, s11, s01], dst: [dst[j][i], dst[j + 1][i + 1], dst[j + 1][i]] });
    }
  return tris;
}

const range = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

/** Strip mesh along a sleeve/leg: pairs of points (A = normal side, B = opposite side) per row. */
function stripMesh(rows: [P, P][], map: (p: P) => P, dstRows?: [P, P][]): Tri[] {
  const tris: Tri[] = [];
  const dst = dstRows ?? rows.map(([a, b]) => [map(a), map(b)] as [P, P]);
  for (let k = 0; k < rows.length - 1; k++) {
    const [a0, b0] = rows[k];
    const [a1, b1] = rows[k + 1];
    tris.push({ src: [a0, b0, a1], dst: [dst[k][0], dst[k][1], dst[k + 1][0]] });
    tris.push({ src: [b0, b1, a1], dst: [dst[k][1], dst[k + 1][1], dst[k + 1][0]] });
  }
  return tris;
}

function stationRows(st: StripShape, margin: number, tEnd = 1.06): [P, P][] {
  const rows: [P, P][] = [];
  const stations = [...st.stations];
  const last = stations[stations.length - 1];
  if (last.t < tEnd) stations.push({ ...last, t: tEnd });
  for (const s of stations) {
    const c = add(add(st.origin, mul(st.axis, s.t * st.length)), mul(st.normal, s.offset));
    const h = s.half * 1.15 + margin;
    rows.push([add(c, mul(st.normal, h)), sub(c, mul(st.normal, h))]);
  }
  return rows;
}

/**
 * Maps a point of a strip (sleeve/leg) along a body path, blending into `rootMap` near the root.
 * `target` is the unblended position along the limb.
 */
function stripMapper(st: StripShape, path: Polyline, pathLength: number, widthScale: number, blendEnd: number, rootMap: (p: P) => P, bend: number) {
  const target = (p: P): P => {
    const rel = sub(p, st.origin);
    const t = dot(rel, st.axis) / st.length;
    const v = dot(rel, st.normal);
    const s = Math.max(0, t) * pathLength;
    const dir = path.dir(s, bend);
    const n2 = rotate(st.normal, angle(dir) - angle(st.axis));
    return add(path.at(s), mul(n2, v * widthScale));
  };
  const map = (p: P): P => {
    const w = smoothstep(0, blendEnd, dot(sub(p, st.origin), st.axis) / st.length);
    return w >= 1 ? target(p) : lerp(rootMap(p), target(p), w);
  };
  return { map, target };
}

function layoutTop(s: TopShape, b: Body, fit: Fit): PieceDraw[] {
  const gw = Math.max(4, s.rT - s.lT);
  const Deff = clamp(b.D, 0.35 * b.Dfront, 1.5 * b.Dfront);
  const k = TOP_WIDTH * fit.size;
  // Width follows the visible shoulders (narrower when turned), length the pose-independent torso size.
  const sx = (k * Deff) / gw;
  const sy = ((k * b.Dfront) / gw) * fit.length;
  const cx = (s.lT + s.rT) / 2;
  const axis = new Polyline([b.ms, b.mh, mid(b.kL, b.kR), mid(b.aL, b.aR)]);
  const lateralAt = (d: number) => norm(lerp(b.shoulderDir, b.hipDir, smoothstep(0, b.T, d)));
  const torsoMap = (p: P): P => {
    const d = (p.y - s.yShoulder) * sy;
    return add(axis.at(d), mul(lateralAt(d), (p.x - cx) * sx));
  };
  const m = Math.max(2, 0.03 * (s.box.x1 - s.box.x0));
  const ys = [...new Set([s.yTop - m, s.yShoulder, s.yArm, ...range(s.yArm, s.yHem + m, 6).slice(1)].map((y) => Math.round(y * 10) / 10))].sort((a, b) => a - b);
  const pieces: PieceDraw[] = [{ piece: "torso", tris: gridMesh(range(s.box.x0 - m, s.box.x1 + m, 6), ys, torsoMap) }];

  const sleeve = (sl: SleeveShape, elbow: P, wrist: P, piece: PieceId) => {
    const shoulder = piece === "sleeveL" ? b.sL : b.sR;
    // 0 = arm hanging, 1 = arm raised to the side (or higher).
    const elevation = Math.acos(clamp(dot(norm(sub(elbow, shoulder)), b.down), -1, 1));
    const raise = smoothstep(0.35, 1.57, elevation);
    // A hanging sleeve starts at the middle of the armhole; on a raised arm it has to run along the
    // shoulder → elbow line, so its start moves to the shoulder joint.
    const start = lerp(torsoMap(sl.origin), shoulder, raise);
    const forearm = norm(sub(wrist, elbow));
    const path = new Polyline([start, elbow, wrist, add(wrist, mul(forearm, b.T))]);
    // Long sleeves end at the wrist (like full-length trousers at the ankle); short ones keep their length.
    const toWrist = dist(start, elbow) + dist(elbow, wrist);
    const natural = sl.length * sy;
    const sleeveLen = natural > 0.85 * toWrist ? (toWrist + 0.04 * b.T) * fit.length : natural;
    const { map, target } = stripMapper(sl, path, sleeveLen, sy * 0.95, 0.22, torsoMap, 0.06 * b.T);
    const margin = 0.06 * sl.length + 2;
    // First row: the armhole itself, on the torso edge.
    const up = norm(sub(sl.rootTop, sl.rootBottom));
    const rows: [P, P][] = [[add(sl.rootTop, mul(up, margin)), sub(sl.rootBottom, mul(up, margin))], ...stationRows(sl, margin)];
    const dst = rows.map(([a, bb]) => [map(a), map(bb)] as [P, P]);
    // Raising the arm pulls the underarm fabric up with it: the armpit corner follows the sleeve
    // instead of staying low on the chest (which would draw a "bat wing" under a raised arm).
    if (raise > 0) dst[0][1] = lerp(dst[0][1], target(rows[0][1]), raise);
    pieces.push({ piece, tris: stripMesh(rows, map, dst) });
  };
  if (s.sleeves.left) sleeve(s.sleeves.left, b.eL, b.wL, "sleeveL");
  if (s.sleeves.right) sleeve(s.sleeves.right, b.eR, b.wR, "sleeveR");
  return pieces;
}

/** Waist width the trousers should have on this body, and the waist center. */
function waistOf(b: Body, size: number) {
  const ratio = clamp(b.hipWidth / (HIP_PER_TORSO * b.T), 0.35, 1.5);
  return { width: BOTTOM_WIDTH * size * b.Dfront * ratio, center: sub(b.mh, mul(b.down, 0.17 * b.T)) };
}

function layoutBottom(s: BottomShape, b: Body, fit: Fit, legCoverage: "full" | "short" | "none"): PieceDraw[] {
  const gw = Math.max(4, s.waistR - s.waistL);
  const waist = waistOf(b, fit.size);
  const sx = waist.width / gw;
  const sy = ((BOTTOM_WIDTH * fit.size * b.Dfront) / gw) * fit.length;
  const cx = (s.waistL + s.waistR) / 2;
  const axis = new Polyline([waist.center, mid(b.kL, b.kR), mid(b.aL, b.aR)]);
  const pelvisMap = (p: P): P => add(axis.at((p.y - s.yWaist) * sy), mul(b.hipDir, (p.x - cx) * sx));
  const m = Math.max(2, 0.03 * (s.box.x1 - s.box.x0));
  const xs = range(s.box.x0 - m, s.box.x1 + m, 6);
  if (!s.legs || s.yCrotch === null) return [{ piece: "whole", tris: gridMesh(xs, range(s.yWaist - m, s.yHem + m, 8), pelvisMap) }];

  const pieces: PieceDraw[] = [{ piece: "pelvis", tris: gridMesh(xs, range(s.yWaist - m, s.yCrotch + m, 3), pelvisMap) }];
  const leg = (st: StripShape, knee: P, ankle: P, piece: PieceId) => {
    const start = pelvisMap(st.origin);
    const path = new Polyline([start, knee, ankle, add(ankle, mul(b.down, b.T))]);
    // Full-length trousers end at the ankle; shorts and skirts keep their own length.
    const length = legCoverage === "full" ? dist(start, knee) + dist(knee, ankle) + 0.05 * b.T : st.length * sy;
    const { map } = stripMapper(st, path, length, Math.max(sx, 0.75 * sy), 0.15, pelvisMap, 0.06 * b.T);
    const margin = 0.05 * st.length + 2;
    const rows = stationRows(st, margin, 1.04);
    // Start slightly above the crotch so legs and pelvis overlap without a seam.
    const first = st.stations[0];
    const c = add(sub(st.origin, mul(st.axis, 0.05 * st.length)), mul(st.normal, first.offset));
    const h = first.half * 1.15 + margin;
    rows.unshift([add(c, mul(st.normal, h)), sub(c, mul(st.normal, h))]);
    pieces.push({ piece, tris: stripMesh(rows, map) });
  };
  leg(s.legs.left, b.kL, b.aL, "legL");
  leg(s.legs.right, b.kR, b.aR, "legR");
  return pieces;
}

/** Two triangles mapping a source rectangle onto an oriented destination rectangle. */
function rectTris(src: { x0: number; y0: number; x1: number; y1: number }, center: P, ex: P, width: number, height: number, mirror = false, rotate90 = false): Tri[] {
  const ey = perp(ex);
  const hw = mul(ex, width / 2);
  const hh = mul(ey, height / 2);
  const tl = sub(sub(center, hw), hh);
  const tr = sub(add(center, hw), hh);
  const br = add(add(center, hw), hh);
  const bl = add(sub(center, hw), hh);
  let s = [pt(src.x0, src.y0), pt(src.x1, src.y0), pt(src.x1, src.y1), pt(src.x0, src.y1)];
  if (mirror) s = [s[1], s[0], s[3], s[2]];
  // Rotating the source by 90° lets a long scarf hang down or a vertical belt photo lie across the waist.
  if (rotate90) s = [s[3], s[0], s[1], s[2]];
  return [
    { src: [s[0], s[1], s[2]], dst: [tl, tr, br] },
    { src: [s[0], s[2], s[3]], dst: [tl, br, bl] },
  ];
}

function layoutShoes(s: FlatShape, b: Body): PieceDraw[] {
  const tris: Tri[] = [];
  const box = s.box;
  const halves =
    s.pairSplit !== null
      ? [
          { ...box, x1: s.pairSplit },
          { ...box, x0: s.pairSplit },
        ]
      : [box, box];
  const feet = [
    { ankle: b.aL, heel: b.heelL, toe: b.toeL },
    { ankle: b.aR, heel: b.heelR, toe: b.toeR },
  ];
  feet.forEach((f, i) => {
    if (!f.toe && !f.heel) return;
    const src = halves[i];
    const aspect = (src.y1 - src.y0) / Math.max(1, src.x1 - src.x0);
    const width = 0.42 * b.T;
    const height = width * aspect;
    const ground = Math.max(f.toe?.y ?? 0, f.heel?.y ?? 0, f.ankle.y + 0.06 * b.T);
    const cxp = f.toe ? lerp(f.ankle, f.toe, 0.6).x : f.ankle.x;
    const center = add(pt(cxp, ground + 0.02 * b.T), mul(perp(b.hipDir), -height / 2));
    // A single shoe photo is mirrored for the other foot.
    tris.push(...rectTris(src, center, b.hipDir, width, height, s.pairSplit === null && i === 0));
  });
  return tris.length ? [{ piece: "whole", tris }] : [];
}

function layoutAccessory(s: FlatShape, b: Body, fit: Fit): PieceDraw | null {
  const box = s.box;
  const bw = Math.max(1, box.x1 - box.x0);
  const bh = Math.max(1, box.y1 - box.y0);
  const aspect = bh / bw;
  let tris: Tri[] | null = null;
  switch (s.kind) {
    case "head": {
      const ears = b.earL && b.earR ? { l: b.earL, r: b.earR } : null;
      const eyes = b.eyeL && b.eyeR ? mid(b.eyeL, b.eyeR) : null;
      if (!eyes) return null;
      const span = ears ? dist(ears.l, ears.r) : dist(b.eyeL!, b.eyeR!) * 1.9;
      const ex = ears ? norm(sub(ears.r, ears.l)) : norm(sub(b.eyeR!, b.eyeL!));
      const up = mul(downOf(ex), -1);
      const width = 2.0 * span * fit.size;
      const height = width * aspect;
      const bottom = add(eyes, mul(up, 0.32 * span));
      tris = rectTris(box, add(bottom, mul(up, height / 2)), ex, width, height);
      break;
    }
    case "scarf": {
      const landscape = aspect < 1;
      const long = 0.75 * b.T * fit.size;
      const short = long * (landscape ? aspect : 1 / aspect);
      const top = sub(b.ms, mul(b.down, 0.1 * b.T));
      tris = rectTris(box, add(top, mul(b.down, long / 2)), b.shoulderDir, short, long, false, landscape);
      break;
    }
    case "belt": {
      const waist = waistOf(b, fit.size);
      const portrait = aspect > 1;
      const width = waist.width * 1.02;
      const height = width * (portrait ? 1 / aspect : aspect);
      tris = rectTris(box, waist.center, b.hipDir, width, height, false, portrait);
      break;
    }
    case "bag": {
      const height = 0.42 * b.T * fit.size;
      const width = height / aspect;
      const center = add(sub(b.hL, mul(b.shoulderDir, 0.32 * b.D)), mul(b.down, 0.1 * b.T));
      tris = rectTris(box, center, b.hipDir, width, height);
      break;
    }
    case "watch": {
      const size = 0.17 * b.D * fit.size;
      tris = rectTris(box, b.wR, norm(sub(b.wR, b.eR)), size, size * aspect);
      break;
    }
    default:
      return null;
  }
  return { piece: "whole", tris };
}
