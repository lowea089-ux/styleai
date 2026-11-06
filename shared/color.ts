// Color science helpers: named color families, sRGB <-> Lab, CIEDE2000,
// dominant color extraction from pixels and outfit color harmony.

export type Temperature = "warm" | "cool" | "neutral";

export interface ColorFamily {
  id: string;
  label: string;
  hex: string;
  /** Classic neutrals combine with almost everything. */
  neutral: boolean;
  temperature: Temperature;
}

export const COLOR_FAMILIES = [
  { id: "schwarz", label: "Schwarz", hex: "#151515", neutral: true, temperature: "neutral" },
  { id: "anthrazit", label: "Anthrazit", hex: "#3b3b3e", neutral: true, temperature: "neutral" },
  { id: "grau", label: "Grau", hex: "#8a8a8e", neutral: true, temperature: "neutral" },
  { id: "hellgrau", label: "Hellgrau", hex: "#c9c9cc", neutral: true, temperature: "neutral" },
  { id: "weiss", label: "Weiß", hex: "#f7f7f4", neutral: true, temperature: "neutral" },
  { id: "creme", label: "Creme", hex: "#eee6d3", neutral: true, temperature: "warm" },
  { id: "beige", label: "Beige", hex: "#d6c1a1", neutral: true, temperature: "warm" },
  { id: "camel", label: "Camel", hex: "#b88a5a", neutral: true, temperature: "warm" },
  { id: "braun", label: "Braun", hex: "#5e4130", neutral: true, temperature: "warm" },
  { id: "khaki", label: "Khaki", hex: "#9b9468", neutral: true, temperature: "warm" },
  { id: "oliv", label: "Oliv", hex: "#5b5f35", neutral: true, temperature: "warm" },
  { id: "navy", label: "Navy", hex: "#1d2741", neutral: true, temperature: "cool" },
  { id: "jeansblau", label: "Jeansblau", hex: "#4b6584", neutral: true, temperature: "cool" },
  { id: "hellblau", label: "Hellblau", hex: "#9fc3e3", neutral: false, temperature: "cool" },
  { id: "blau", label: "Blau", hex: "#2c5db3", neutral: false, temperature: "cool" },
  { id: "petrol", label: "Petrol", hex: "#1b5b63", neutral: false, temperature: "cool" },
  { id: "tuerkis", label: "Türkis", hex: "#3bb3b0", neutral: false, temperature: "cool" },
  { id: "dunkelgruen", label: "Dunkelgrün", hex: "#1e4a37", neutral: false, temperature: "cool" },
  { id: "gruen", label: "Grün", hex: "#3d8c4d", neutral: false, temperature: "cool" },
  { id: "mint", label: "Mint", hex: "#a9dcc1", neutral: false, temperature: "cool" },
  { id: "lila", label: "Lila", hex: "#64478f", neutral: false, temperature: "cool" },
  { id: "flieder", label: "Flieder", hex: "#c3b0de", neutral: false, temperature: "cool" },
  { id: "rosa", label: "Rosa", hex: "#efb9c6", neutral: false, temperature: "warm" },
  { id: "pink", label: "Pink", hex: "#d94f8a", neutral: false, temperature: "cool" },
  { id: "rot", label: "Rot", hex: "#c12c2c", neutral: false, temperature: "warm" },
  { id: "bordeaux", label: "Bordeaux", hex: "#6a1f2b", neutral: false, temperature: "warm" },
  { id: "orange", label: "Orange", hex: "#e3772b", neutral: false, temperature: "warm" },
  { id: "terracotta", label: "Terracotta", hex: "#b95c3c", neutral: false, temperature: "warm" },
  { id: "senf", label: "Senfgelb", hex: "#c39c22", neutral: false, temperature: "warm" },
  { id: "gelb", label: "Gelb", hex: "#efcd39", neutral: false, temperature: "warm" },
  { id: "gold", label: "Gold", hex: "#c8a548", neutral: true, temperature: "warm" },
  { id: "silber", label: "Silber", hex: "#bfc1c4", neutral: true, temperature: "cool" },
] as const satisfies readonly ColorFamily[];

export type ColorFamilyId = (typeof COLOR_FAMILIES)[number]["id"];
export const COLOR_IDS = COLOR_FAMILIES.map((f) => f.id) as [ColorFamilyId, ...ColorFamilyId[]];
const familyById = new Map<string, ColorFamily>(COLOR_FAMILIES.map((f) => [f.id, f]));
export const getFamily = (id: string): ColorFamily | undefined => familyById.get(id);
export const colorLabel = (id: string) => familyById.get(id)?.label ?? id;

export interface ItemColor {
  family: ColorFamilyId;
  hex: string;
  /** Share of the garment's visible area (0..1). */
  ratio: number;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];
export type Lab = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

const srgbToLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

export function rgbToLab([r, g, b]: RGB): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // D65
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToLch([L, a, b]: Lab): [number, number, number] {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

export const hexToLab = (hex: string) => rgbToLab(hexToRgb(hex));

/** CIEDE2000 color difference. `kL` > 1 makes lightness differences count less (e.g. shading on fabric). */
export function deltaE2000(l1: Lab, l2: Lab, kL = 1): number {
  const [L1, a1, b1] = l1;
  const [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

const familyLabs = COLOR_FAMILIES.map((f) => ({ id: f.id, lab: hexToLab(f.hex) }));

/** Name a color by its perceptually nearest family. */
export function nearestFamily(rgb: RGB): ColorFamilyId {
  const lab = rgbToLab(rgb);
  const [, C] = labToLch(lab);
  let best: ColorFamilyId = "grau";
  let bestD = Infinity;
  for (const f of familyLabs) {
    // Metallic families are never inferred from pixels.
    if (f.id === "gold" || f.id === "silber") continue;
    let d = deltaE2000(lab, f.lab);
    // Very unsaturated pixels should map to the gray axis rather than a tinted family.
    const fam = familyById.get(f.id)!;
    if (C < 6 && !["schwarz", "anthrazit", "grau", "hellgrau", "weiss"].includes(fam.id)) d += 6;
    if (d < bestD) {
      bestD = d;
      best = f.id as ColorFamilyId;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Dominant color extraction (k-means in Lab on foreground pixels)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Extract up to `maxColors` dominant colors of a garment.
 * `data` is RGBA (canvas ImageData layout); transparent pixels are ignored.
 */
export function extractColors(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  maxColors = 3,
): ItemColor[] {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 9000));
  const samples: { rgb: RGB; lab: Lab }[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (data[o + 3] < 200) continue;
    const rgb: RGB = [data[o], data[o + 1], data[o + 2]];
    samples.push({ rgb, lab: rgbToLab(rgb) });
  }
  if (samples.length < 20) return [];
  // Deep crease shadows and specular highlights are lighting, not fabric color. Trim them when the
  // lightness range is wide; a two-tone garment keeps both tones because they make up the bulk.
  const ls = samples.map((s) => s.lab[0]).sort((a, b) => a - b);
  const lo = ls[Math.floor(ls.length * 0.04)];
  const hi = ls[Math.floor(ls.length * 0.985)];
  if (hi - lo > 25) {
    const kept = samples.filter((s) => s.lab[0] >= lo && s.lab[0] <= hi);
    if (kept.length >= 20) samples.splice(0, samples.length, ...kept);
  }

  const k = Math.min(6, samples.length);
  const rand = mulberry32(42);
  // k-means++ initialisation
  const centers: Lab[] = [samples[Math.floor(rand() * samples.length)].lab];
  while (centers.length < k) {
    const dists = samples.map((s) => Math.min(...centers.map((c) => sqDist(s.lab, c))));
    const sum = dists.reduce((a, b) => a + b, 0);
    let r = rand() * sum;
    let idx = 0;
    for (; idx < dists.length - 1; idx++) {
      r -= dists[idx];
      if (r <= 0) break;
    }
    centers.push(samples[idx].lab);
  }
  const assign = new Array<number>(samples.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < samples.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = sqDist(samples[i].lab, centers[j]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    samples.forEach((s, i) => {
      const t = sums[assign[i]];
      t[0] += s.lab[0];
      t[1] += s.lab[1];
      t[2] += s.lab[2];
      t[3]++;
    });
    sums.forEach((t, j) => {
      if (t[3] > 0) centers[j] = [t[0] / t[3], t[1] / t[3], t[2] / t[3]];
    });
    if (!moved && iter > 0) break;
  }

  // Folds and uneven light split one fabric color into a lit and a shaded cluster (red + bordeaux,
  // gray + anthracite). Merge clusters that differ mainly in lightness before naming them.
  const counts = centers.map((_, j) => assign.filter((a) => a === j).length);
  const groups: { lab: Lab; n: number }[] = [];
  const groupOf = new Array<number>(centers.length).fill(-1);
  for (const j of centers.map((_, j) => j).sort((a, b) => counts[b] - counts[a])) {
    if (!counts[j]) continue;
    const gi = groups.findIndex((g) => deltaE2000(g.lab, centers[j], 2.8) < 7);
    if (gi < 0) {
      groupOf[j] = groups.length;
      groups.push({ lab: [...centers[j]] as Lab, n: counts[j] });
      continue;
    }
    const g = groups[gi];
    const t = counts[j] / (g.n + counts[j]);
    g.lab = [g.lab[0] + (centers[j][0] - g.lab[0]) * t, g.lab[1] + (centers[j][1] - g.lab[1]) * t, g.lab[2] + (centers[j][2] - g.lab[2]) * t];
    g.n += counts[j];
    groupOf[j] = gi;
  }
  // Shadows only ever darken fabric, so the lit half of each group is the better estimate of its color.
  const members = groups.map(() => [] as { rgb: RGB; L: number }[]);
  samples.forEach((s, i) => members[groupOf[assign[i]]].push({ rgb: s.rgb, L: s.lab[0] }));
  // Group by named family.
  const byFamily = new Map<ColorFamilyId, { r: number; g: number; b: number; n: number }>();
  members.forEach((m) => {
    if (!m.length) return;
    const sortedL = m.map((x) => x.L).sort((a, b) => a - b);
    const med = sortedL[Math.floor(sortedL.length / 2)];
    const lit = m.filter((x) => x.L >= med);
    const rgb: RGB = [0, 1, 2].map((c) => lit.reduce((s, x) => s + x.rgb[c], 0) / lit.length) as RGB;
    const fam = nearestFamily(rgb);
    const acc = byFamily.get(fam) ?? { r: 0, g: 0, b: 0, n: 0 };
    acc.r += rgb[0] * m.length;
    acc.g += rgb[1] * m.length;
    acc.b += rgb[2] * m.length;
    acc.n += m.length;
    byFamily.set(fam, acc);
  });
  return [...byFamily.entries()]
    .map(([family, a]) => ({
      family,
      hex: rgbToHex([a.r / a.n, a.g / a.n, a.b / a.n]),
      ratio: a.n / samples.length,
    }))
    .filter((c) => c.ratio >= 0.06)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, maxColors)
    .map((c) => ({ ...c, ratio: Math.round(c.ratio * 100) / 100 }));
}

function sqDist(a: Lab, b: Lab) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

// ---------------------------------------------------------------------------
// Harmony
// ---------------------------------------------------------------------------

export type HarmonyKind = "neutral" | "ton_in_ton" | "analog" | "komplementaer" | "akzent" | "triade" | "bunt";

export interface HarmonyInput {
  hex: string;
  family: string;
  /** Visual weight of this color in the outfit (area × slot importance). */
  weight: number;
}

export interface HarmonyResult {
  score: number;
  kind: HarmonyKind;
  accents: string[];
  neutrals: string[];
  /** Lightness contrast between the strongest light and dark colors (0..100). */
  contrast: number;
}

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Score how well a set of outfit colors works together (0..1).
 * `boldness` (0..1) loosens the penalty for many accent colors.
 */
export function analyzeHarmony(colors: HarmonyInput[], boldness = 0.4): HarmonyResult {
  const entries = colors
    .filter((c) => c.weight > 0)
    .map((c) => {
      const lab = hexToLab(c.hex);
      const [L, C, h] = labToLch(lab);
      const fam = getFamily(c.family);
      const isNeutral = (fam?.neutral ?? false) || C < 14;
      return { ...c, L, C, h, isNeutral };
    });
  const neutrals = unique(entries.filter((e) => e.isNeutral).map((e) => e.family));
  const accentEntries = entries.filter((e) => !e.isNeutral);
  // Merge accents that are perceptually the same hue.
  const accentGroups: { h: number; C: number; weight: number; family: string }[] = [];
  for (const e of accentEntries.sort((a, b) => b.weight - a.weight)) {
    const g = accentGroups.find((x) => hueDiff(x.h, e.h) < 18);
    if (g) g.weight += e.weight;
    else accentGroups.push({ h: e.h, C: e.C, weight: e.weight, family: e.family });
  }
  const Ls = entries.map((e) => e.L);
  const contrast = Ls.length ? Math.max(...Ls) - Math.min(...Ls) : 0;
  const accents = unique(accentGroups.map((g) => g.family));

  let score: number;
  let kind: HarmonyKind;
  if (accentGroups.length === 0) {
    kind = "neutral";
    // All-neutral looks are safe; some light/dark contrast keeps them from looking flat.
    score = 0.86 + Math.min(0.1, contrast / 400);
    const warmCool = new Set(entries.map((e) => getFamily(e.family)?.temperature).filter((t) => t && t !== "neutral"));
    if (warmCool.size > 1) score -= 0.04;
    if (neutrals.includes("schwarz") && neutrals.includes("navy")) score -= 0.04;
  } else if (accentGroups.length === 1) {
    const g = accentGroups[0];
    const total = entries.reduce((a, e) => a + e.weight, 0) || 1;
    const share = g.weight / total;
    const allTonal = entries.every((e) => e.isNeutral || hueDiff(e.h, g.h) < 25);
    if (neutrals.length === 0 && allTonal) {
      kind = "ton_in_ton";
      score = 0.92 + Math.min(0.06, contrast / 500);
    } else {
      kind = "akzent";
      // One accent on a neutral base is the classic formula; a dominant loud accent is bolder.
      score = share <= 0.45 ? 0.95 : 0.88 + 0.06 * boldness;
    }
  } else {
    const [a, b] = accentGroups;
    const d = hueDiff(a.h, b.h);
    const both = accentGroups.length;
    if (both === 2) {
      if (d < 40) {
        kind = "analog";
        score = 0.9;
      } else if (d >= 150) {
        kind = "komplementaer";
        score = 0.78 + 0.14 * boldness;
      } else if (d >= 100) {
        kind = "triade";
        score = 0.7 + 0.12 * boldness;
      } else {
        kind = "bunt";
        // Hue gap of 40–100° between two saturated colors tends to clash.
        const sat = Math.min(a.C, b.C);
        score = sat < 30 ? 0.68 : 0.5 + 0.15 * boldness;
      }
    } else {
      kind = "bunt";
      score = 0.42 + 0.3 * boldness - 0.05 * (both - 3);
    }
  }
  return { score: clamp01(score), kind, accents, neutrals, contrast };
}

export function familiesHarmony(a: string, b: string): HarmonyResult {
  const fa = getFamily(a);
  const fb = getFamily(b);
  return analyzeHarmony(
    [
      { hex: fa?.hex ?? "#888888", family: a, weight: 1 },
      { hex: fb?.hex ?? "#888888", family: b, weight: 1 },
    ],
    0.4,
  );
}

const unique = <T,>(arr: T[]) => [...new Set(arr)];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
