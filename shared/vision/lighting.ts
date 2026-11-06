// Automatic exposure and white-balance correction for garment photos taken in poor light.
//
// Dim indoor light makes photos dark, noisy and tinted (warm bulbs → yellow/orange, LEDs → green or blue).
// The cast is estimated from the image itself (shades-of-gray + bright pixels) and only corrected along
// plausible illuminant directions and with capped strength, so a red blanket or a large colored garment is
// not "corrected" into gray. Well-lit photos stay untouched.
import { createRaster, downsample, lightnessFromY, linearToSrgb8, SRGB_TO_LINEAR, yFromLightness, type Raster } from "./raster";

export interface LightingAnalysis {
  /** Linear-light gain for all channels (1 = unchanged). */
  exposureGain: number;
  /** Extra shadow lift as a gamma on linear light (1 = none, < 1 brightens shadows). */
  shadowGamma: number;
  /** Per-channel white-balance gains in linear light (luminance-preserving). */
  wbGains: [number, number, number];
  /** Estimated color cast of the light source in Lab a/b units (before correction). */
  cast: { a: number; b: number };
  /** Lightness of the median and of the bright end (97th percentile) before correction. */
  medianL: number;
  brightL: number;
  lowLight: boolean;
  colorCast: boolean;
  needsCorrection: boolean;
}

const LUM = [0.2126, 0.7152, 0.0722] as const;

/** Linear sRGB → Lab (D65). */
function linToLab(r: number, g: number, b: number): [number, number, number] {
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab (D65) → linear sRGB (unclamped). */
function labToLin(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t > 6 / 29 ? t * t * t : (116 * t - 16) / (24389 / 27));
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  return [
    x * 3.2404542 + y * -1.5371385 + z * -0.4985314,
    x * -0.969266 + y * 1.8760108 + z * 0.041556,
    x * 0.0556434 + y * -0.2040259 + z * 1.0572252,
  ];
}

const NO_CHANGE: Omit<LightingAnalysis, "medianL" | "brightL"> = {
  exposureGain: 1,
  shadowGamma: 1,
  wbGains: [1, 1, 1],
  cast: { a: 0, b: 0 },
  lowLight: false,
  colorCast: false,
  needsCorrection: false,
};

export function analyzeLighting(src: Raster): LightingAnalysis {
  const r = downsample(src, 256);
  const n = r.width * r.height;
  const hist = new Uint32Array(101);
  const lin = new Float32Array(n * 3);
  const Ls = new Float32Array(n);
  const ok = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (r.data[o + 3] < 200) continue;
    const R = SRGB_TO_LINEAR[r.data[o]];
    const G = SRGB_TO_LINEAR[r.data[o + 1]];
    const B = SRGB_TO_LINEAR[r.data[o + 2]];
    lin[i * 3] = R;
    lin[i * 3 + 1] = G;
    lin[i * 3 + 2] = B;
    const L = lightnessFromY(LUM[0] * R + LUM[1] * G + LUM[2] * B);
    Ls[i] = L;
    hist[Math.max(0, Math.min(100, Math.round(L)))]++;
    ok[i] = 1;
    count++;
  }
  if (count < 64) return { ...NO_CHANGE, medianL: 50, brightL: 90 };
  const pct = (p: number) => {
    const target = p * count;
    let acc = 0;
    for (let l = 0; l <= 100; l++) {
      acc += hist[l];
      if (acc >= target) return l;
    }
    return 100;
  };
  const medianL = pct(0.5);
  const brightL = pct(0.97);
  const lowL = pct(0.05);
  const highL = pct(0.9);

  // --- Exposure: lift only when even the bright end of the photo is dim. ---
  let exposureGain = 1;
  if (brightL < 72) {
    // Moderately dim photos get at most 2.4×; when even the brightest parts are very dark the photo is
    // clearly underexposed and may be lifted up to 4×.
    const cap = 2.4 + 1.6 * Math.max(0, Math.min(1, (60 - brightL) / 15));
    exposureGain = Math.min(cap, yFromLightness(82) / Math.max(1e-4, yFromLightness(brightL)));
    if (exposureGain < 1.12) exposureGain = 1;
  }
  const medianAfter = lightnessFromY(Math.min(1, yFromLightness(medianL) * exposureGain));
  const shadowGamma = exposureGain > 1 && medianAfter < 30 ? 0.85 : 1;
  const lowLight = exposureGain > 1;

  // --- White balance: shades of gray (p = 6) + mean of the bright pixels + gray world. ---
  const p = 6;
  const sog = [0, 0, 0];
  const bright = [0, 0, 0];
  const mean = [0, 0, 0];
  let nSog = 0;
  let nBright = 0;
  let chromatic = 0;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const o = i * 4;
    // Clipped pixels carry no color information; the darkest ones are mostly noise.
    if (r.data[o] >= 250 || r.data[o + 1] >= 250 || r.data[o + 2] >= 250) continue;
    const L = Ls[i];
    if (L < lowL || L < 3) continue;
    const R = lin[i * 3];
    const G = lin[i * 3 + 1];
    const B = lin[i * 3 + 2];
    sog[0] += R ** p;
    sog[1] += G ** p;
    sog[2] += B ** p;
    mean[0] += R;
    mean[1] += G;
    mean[2] += B;
    nSog++;
    if (L >= highL) {
      bright[0] += R;
      bright[1] += G;
      bright[2] += B;
      nBright++;
    }
    const [, a, b] = linToLab(R, G, B);
    if (Math.hypot(a, b) > 22) chromatic++;
  }
  if (nSog < 32) return { ...NO_CHANGE, exposureGain, shadowGamma, lowLight, needsCorrection: exposureGain > 1, medianL, brightL };
  const norm = (v: number[]) => {
    const s = v[0] + v[1] + v[2] || 1;
    return v.map((x) => x / s);
  };
  const eSog = norm(sog.map((v) => Math.pow(v / nSog, 1 / p)));
  const eBright = nBright ? norm(bright) : eSog;
  const eMean = norm(mean);
  const est = [0, 1, 2].map((c) => 0.4 * eSog[c] + 0.4 * eBright[c] + 0.2 * eMean[c]);
  // Express the estimated light color as a cast in Lab at mid lightness.
  const estY = LUM[0] * est[0] + LUM[1] * est[1] + LUM[2] * est[2] || 1;
  const [, castA, castB] = linToLab((est[0] / estY) * 0.18, (est[1] / estY) * 0.18, (est[2] / estY) * 0.18);

  // A frame dominated by one strong color (big red sweater, colored blanket) biases the estimate.
  const strength = chromatic / nSog > 0.55 ? 0.35 : 0.85;
  // Typical light sources vary mainly along blue↔yellow (b*); green↔magenta (a*) casts are smaller.
  const corrB = Math.max(-28, Math.min(32, castB)) * strength;
  const corrA = Math.max(-8, Math.min(8, castA * 0.6)) * strength;
  let wbGains: [number, number, number] = [1, 1, 1];
  if (Math.hypot(corrA, corrB) >= 3) {
    const ill = labToLin(50, corrA, corrB).map((v) => Math.max(1e-4, v));
    const illY = LUM[0] * ill[0] + LUM[1] * ill[1] + LUM[2] * ill[2];
    wbGains = ill.map((v) => Math.max(0.55, Math.min(1.8, illY / v))) as [number, number, number];
  }
  const wbApplied = wbGains.some((g) => Math.abs(g - 1) > 0.02);
  return {
    exposureGain,
    shadowGamma,
    wbGains,
    cast: { a: Math.round(castA * 10) / 10, b: Math.round(castB * 10) / 10 },
    medianL,
    brightL,
    lowLight,
    colorCast: wbApplied && Math.hypot(castA, castB) >= 6,
    needsCorrection: exposureGain > 1 || wbApplied,
  };
}

/** Apply the correction. Per-channel lookup tables keep this fast even for 1600 px photos. */
export function applyLighting(src: Raster, a: LightingAnalysis): Raster {
  const luts = [0, 1, 2].map((c) => {
    const t = new Uint8ClampedArray(256);
    const k = a.exposureGain * a.wbGains[c];
    for (let i = 0; i < 256; i++) {
      let v = SRGB_TO_LINEAR[i] * k;
      if (a.shadowGamma !== 1) v = Math.pow(Math.max(0, v), a.shadowGamma);
      // Soft shoulder instead of hard clipping: bright fabric keeps its texture after the lift.
      if (v > 0.8) v = 0.8 + 0.2 * Math.tanh((v - 0.8) / 0.2);
      t[i] = linearToSrgb8(v);
    }
    return t;
  });
  const out = createRaster(src.width, src.height);
  const s = src.data;
  const d = out.data;
  for (let o = 0; o < s.length; o += 4) {
    d[o] = luts[0][s[o]];
    d[o + 1] = luts[1][s[o + 1]];
    d[o + 2] = luts[2][s[o + 2]];
    d[o + 3] = s[o + 3];
  }
  return out;
}
