// Outfit scoring: every component returns 0..1 and is explainable on its own.
import { analyzeHarmony, colorLabel, type HarmonyInput, type HarmonyResult } from "../color";
import { patternBoldness, styleSimilarity, type StyleId } from "../taxonomy";
import { trendItemScore } from "../trends";
import type { OutfitRole, ScoreComponent } from "../types";
import { clamp01, outfitKey, pairKey, type EngineContext, type EngineItem, type Part } from "./context";

export const WEIGHTS: Record<ScoreComponent, number> = {
  style: 0.2,
  cohesion: 0.08,
  color: 0.18,
  pattern: 0.07,
  proportion: 0.05,
  formality: 0.13,
  weather: 0.13,
  season: 0.04,
  personal: 0.08,
  variety: 0.04,
};

const isAcc = (r: OutfitRole) => r.startsWith("acc:");

/** How much of the visible outfit a role occupies (for color weighting and style averaging). */
function visualWeight(role: OutfitRole, parts: Part[]): number {
  switch (role) {
    case "onepiece":
    case "suit":
      return 2;
    case "outer":
      return 1.2;
    case "mid":
    case "top":
    case "bottom":
      return 1;
    case "base":
      // A base layer under a mid layer is mostly covered.
      return parts.some((p) => p.role === "mid" || p.role === "suit") ? 0.45 : 1;
    case "shoes":
      return 0.35;
    default:
      return 0.15;
  }
}

const WATERPROOF = ["regen", "wasserdicht", "wasserabweisend", "trench", "nylon", "gore", "wachs", "parka", "softshell", "rain"];
const isWaterproof = (it: EngineItem) =>
  WATERPROOF.some((k) => [it.name, it.subtype ?? "", it.material ?? "", ...it.tags].join(" ").toLowerCase().includes(k));

export const TORSO_ROLES: OutfitRole[] = ["top", "base", "mid", "outer", "onepiece", "suit"];

export interface ScoreResult {
  total: number;
  breakdown: Record<ScoreComponent, number>;
  harmony: HarmonyResult;
  torsoWarmth: number;
  formalityMean: number;
  warnings: string[];
}

export function itemStyleMatch(item: EngineItem, styles: StyleId[]): number {
  if (!styles.length) return 0.65;
  if (!item.styles.length) return 0.5;
  let best = 0;
  for (const s of item.styles) for (const r of styles) best = Math.max(best, styleSimilarity(s, r));
  return best;
}

export function scoreOutfit(parts: Part[], ctx: EngineContext): ScoreResult {
  const warnings: string[] = [];
  const main = parts.filter((p) => !isAcc(p.role));
  const W = (p: Part) => visualWeight(p.role, parts);

  // --- style ---------------------------------------------------------------
  let sw = 0;
  let ss = 0;
  for (const p of parts) {
    const w = W(p);
    sw += w;
    ss += w * itemStyleMatch(p.item, ctx.styles);
  }
  const style = sw ? ss / sw : 0.6;

  // --- cohesion (do the pieces belong together?) ----------------------------
  const styled = main.filter((p) => p.item.styles.length);
  let cohesion = 0.7;
  if (styled.length >= 2) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < styled.length; i++)
      for (let j = i + 1; j < styled.length; j++) {
        let best = 0;
        for (const a of styled[i].item.styles) for (const b of styled[j].item.styles) best = Math.max(best, styleSimilarity(a, b));
        sum += best;
        n++;
      }
    cohesion = sum / n;
    // Experimental users get credit for deliberate style clashes.
    cohesion = cohesion + (1 - cohesion) * 0.45 * ctx.experimental;
  }

  // --- color -----------------------------------------------------------------
  const hInput: HarmonyInput[] = [];
  for (const p of parts)
    for (const c of p.item.colors) hInput.push({ hex: c.hex, family: c.family, weight: c.ratio * W(p) });
  const harmony = analyzeHarmony(hInput, ctx.boldness);
  let color = hInput.length ? harmony.score : 0.7;
  const fams = new Set(parts.flatMap((p) => p.item.colors.slice(0, 2).map((c) => c.family as string)));
  if (ctx.request.colors.length) {
    const hit = ctx.request.colors.filter((c) => fams.has(c)).length;
    color += hit ? 0.08 + 0.06 * Math.min(1, hit / ctx.request.colors.length) : -0.15;
  }
  let fav = 0;
  for (const f of fams) {
    if (ctx.favoriteColors.has(f)) fav += 0.04;
    if (ctx.avoidedColors.has(f)) color -= 0.12;
  }
  color = clamp01(color + Math.min(0.08, fav));

  // --- pattern mixing ------------------------------------------------------------
  const patterned = parts
    .filter((p) => p.item.pattern !== "uni")
    .map((p) => ({ type: p.item.pattern, b: patternBoldness(p.item.pattern) * (p.role.startsWith("acc:") ? 0.5 : 1) }));
  let pattern: number;
  const nP = patterned.reduce((a, p) => a + (p.b < 0.35 ? 0.5 : 1), 0);
  if (nP === 0) pattern = 0.9 + 0.08 * (1 - ctx.boldness);
  else if (nP <= 1) pattern = 0.95 + 0.05 * ctx.boldness;
  else if (nP <= 2) {
    const [a, b] = patterned;
    if (a && b && a.type === b.type && a.b >= 0.6) pattern = 0.45 + 0.2 * ctx.experimental;
    else if (patterned.some((p) => p.b <= 0.4)) pattern = 0.78 + 0.12 * ctx.experimental;
    else pattern = 0.58 + 0.25 * ctx.experimental;
  } else pattern = 0.35 + 0.3 * ctx.experimental;

  // --- proportions ----------------------------------------------------------------
  const visibleTop =
    parts.find((p) => p.role === "outer") ??
    parts.find((p) => p.role === "mid") ??
    parts.find((p) => p.role === "top" || p.role === "base" || p.role === "suit");
  const bottom = parts.find((p) => p.role === "bottom");
  let proportion = 0.78;
  if (visibleTop?.item.fit && bottom?.item.fit) {
    const t = visibleTop.item.fit;
    const b = bottom.item.fit;
    const loose = (f: string) => f === "oversized" || f === "locker";
    const relaxedStyle = ctx.styles.some((s) => ["streetwear", "skater", "grunge", "y2k", "casual"].includes(s));
    if (loose(t) && loose(b)) proportion = relaxedStyle ? 0.92 : 0.6;
    else if (loose(t) !== loose(b)) proportion = 0.92;
    else if (t === "eng" && b === "eng") proportion = ctx.styles.some((s) => ["elegant", "sporty", "business"].includes(s)) ? 0.9 : 0.78;
    else proportion = 0.86;
  } else if (parts.some((p) => p.role === "onepiece" || p.role === "suit")) proportion = 0.88;

  // --- formality ----------------------------------------------------------------------
  let fw = 0;
  let fs = 0;
  const fvals: number[] = [];
  for (const p of main) {
    const w = p.role === "shoes" ? 0.8 : p.role === "base" && W(p) < 1 ? 0.5 : 1;
    fw += w;
    fs += w * p.item.formality;
    fvals.push(p.item.formality);
  }
  const fMean = fw ? fs / fw : ctx.targetFormality;
  const fStd = Math.sqrt(fvals.reduce((a, v) => a + (v - fMean) ** 2, 0) / Math.max(1, fvals.length));
  let formality = 1 - Math.abs(fMean - ctx.targetFormality) / 2.5 - fStd * 0.16 * (1 - 0.5 * ctx.experimental);
  if (ctx.occasion === "sport") {
    const sporty = main.some((p) => p.item.categoryKey === "sportswear" || p.item.categoryKey === "sport_shoes" || p.item.categoryKey === "joggers");
    if (!sporty) formality -= 0.3;
  }
  formality = clamp01(formality);

  // --- weather ---------------------------------------------------------------------------
  const torsoWarmth = parts.filter((p) => TORSO_ROLES.includes(p.role)).reduce((a, p) => a + p.item.warmth, 0);
  let weather = 0.75;
  const cl = ctx.climate;
  if (cl) {
    const tol = 1.1 + 0.18 * cl.targetTorso;
    weather = Math.exp(-(((torsoWarmth - cl.targetTorso) / tol) ** 2));
    const legs = parts.find((p) => p.role === "bottom" || p.role === "onepiece");
    if (legs?.item.legCoverage === "short" && cl.temp < 16) weather -= (16 - cl.temp) * 0.05;
    if (legs?.item.legCoverage === "full" && cl.temp > 27 && legs.item.categoryKey !== "trousers") weather -= (cl.temp - 27) * 0.04;
    const shoes = parts.find((p) => p.role === "shoes")?.item;
    if (shoes?.categoryKey === "sandals" && cl.temp < 16) weather -= 0.3;
    if (shoes?.categoryKey === "boots" && cl.temp > 24) weather -= 0.15;
    const outer = parts.find((p) => p.role === "outer")?.item;
    if (cl.rain) {
      if (shoes?.categoryKey === "sandals") weather -= 0.2;
      if (shoes?.categoryKey === "boots") weather += 0.04;
      if (!outer && cl.temp < 24) weather -= 0.15;
      if (outer && isWaterproof(outer)) weather += 0.08;
    }
    if (cl.windy && !outer && cl.temp < 20) weather -= 0.08;
    if (cl.spread >= 8 && (outer || parts.some((p) => p.role === "mid"))) weather += 0.05;
    for (const p of parts) {
      if (p.role === "acc:scarf" || (p.role === "acc:head" && p.item.warmth >= 1)) {
        if (cl.temp > 17) weather -= 0.15;
        else if (cl.temp < 7) weather += 0.05;
      }
    }
    weather = clamp01(weather);
    const diff = torsoWarmth - cl.targetTorso;
    if (diff < -2.5) warnings.push(`Für ${Math.round(cl.temp)} °C eher zu kühl – nimm eine zusätzliche Schicht mit.`);
    if (diff > 3.5) warnings.push(`Für ${Math.round(cl.temp)} °C eher zu warm angezogen.`);
    if (cl.rain && !outer && cl.temp < 24) warnings.push("Regen erwartet – keine Jacke im Outfit. Schirm einpacken!");
  }

  // --- season -------------------------------------------------------------------------------
  let season = 0;
  for (const p of main) season += p.item.seasons.length === 0 ? 0.7 : p.item.seasons.includes(ctx.season) ? 1 : 0.35;
  season = main.length ? season / main.length : 0.7;

  // --- personal -------------------------------------------------------------------------------
  let personal = 0.5;
  if (ctx.personalization) {
    const A = ctx.affinities;
    const ids = parts.map((p) => p.item.id);
    const itemAff = avg(ids.map((i) => A.item.get(i) ?? 0));
    const pairVals: number[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const v = A.pair.get(pairKey(ids[i], ids[j]));
        if (v !== undefined) pairVals.push(v);
      }
    const pairAff = pairVals.length ? avg(pairVals) : 0;
    const styleAff = avg(main.flatMap((p) => p.item.styles.map((s) => A.style.get(s) ?? 0)));
    const colorAff = avg(main.map((p) => (p.item.colors[0] ? (A.color.get(p.item.colors[0].family) ?? 0) : 0)));
    const outfitAff = A.outfit.get(outfitKey(main.map((p) => p.item.id))) ?? 0;
    personal = 0.5 + 0.5 * (0.4 * itemAff + 0.3 * pairAff + 0.1 * styleAff + 0.1 * colorAff + 0.1 * outfitAff);
  }
  const favShare = main.filter((p) => p.item.favorite).length / Math.max(1, main.length);
  personal = clamp01(personal + (ctx.request.preferFavorites ? 0.25 : 0.04) * favShare);

  // --- variety --------------------------------------------------------------------------------------
  let variety = 1;
  if (ctx.avoidRepeatDays > 0) {
    for (const p of main) {
      const d = p.item.lastWornDaysAgo;
      if (d !== null && d < ctx.avoidRepeatDays) variety -= 0.22 * (1 - d / ctx.avoidRepeatDays);
    }
    const key = outfitKey(main.map((p) => p.item.id));
    const worn = ctx.recentOutfits.get(key);
    if (worn !== undefined && worn < ctx.avoidRepeatDays * 2) variety -= 0.5;
  }
  variety += 0.05 * ctx.experimental * main.filter((p) => p.item.wearCount === 0).length;
  variety = clamp01(variety);

  const breakdown: Record<ScoreComponent, number> = {
    style,
    cohesion,
    color,
    pattern,
    proportion,
    formality,
    weather,
    season,
    personal,
    variety,
  };
  const weights = { ...WEIGHTS };
  if (!cl) {
    // Without weather data the season carries more of that weight.
    weights.season += 0.08;
    weights.weather -= 0.08;
  }
  let total = 0;
  for (const k of Object.keys(weights) as ScoreComponent[]) total += weights[k] * breakdown[k];

  if (ctx.trend) {
    const best = Math.max(0, ...parts.map((p) => trendItemScore(ctx.trend!, p.item)));
    total += 0.08 * best;
  }

  const shoesMissing = !parts.some((p) => p.role === "shoes");
  if (shoesMissing) warnings.push("Keine passenden Schuhe verfügbar.");

  return {
    total: clamp01(total),
    breakdown,
    harmony,
    torsoWarmth,
    formalityMean: fMean,
    warnings,
  };
}

export function colorList(families: string[]) {
  const labels = families.map(colorLabel);
  if (labels.length <= 1) return labels.join("");
  return labels.slice(0, -1).join(", ") + " und " + labels[labels.length - 1];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
