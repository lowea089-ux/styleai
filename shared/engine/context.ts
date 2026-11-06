import type { ItemColor } from "../color";
import type { GenerateRequest } from "../schemas";
import {
  OCCASIONS,
  seasonForDate,
  type AccessoryKind,
  type FitId,
  type ItemStatus,
  type Layer,
  type LegCoverage,
  type OccasionId,
  type PatternId,
  type SeasonId,
  type Slot,
  type StyleId,
} from "../taxonomy";
import type { Category, ClothingItem, OutfitRole, WeatherContext } from "../types";
import type { TrendDef } from "../trends";

/** Flattened item with its category semantics resolved – what the engine works on. */
export interface EngineItem {
  id: string;
  name: string;
  categoryKey: string | null;
  categoryName: string;
  subtype: string | null;
  slot: Slot;
  layer: Layer;
  accessoryKind: AccessoryKind | null;
  standalone: boolean;
  beltLoops: boolean;
  legCoverage: LegCoverage;
  colors: ItemColor[];
  pattern: PatternId;
  material: string | null;
  fit: FitId | null;
  styles: StyleId[];
  seasons: SeasonId[];
  occasions: OccasionId[];
  formality: number;
  warmth: number;
  favorite: boolean;
  tags: string[];
  status: ItemStatus;
  wearCount: number;
  lastWornDaysAgo: number | null;
}

export interface Part {
  item: EngineItem;
  role: OutfitRole;
}

export function daysBetween(fromIso: string, to: Date): number {
  const a = Date.parse(fromIso.length === 10 ? fromIso + "T12:00:00" : fromIso);
  return Math.max(0, Math.round((to.getTime() - a) / 86_400_000));
}

export function toEngineItems(items: ClothingItem[], categories: Category[], today = new Date()): EngineItem[] {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const out: EngineItem[] = [];
  for (const it of items) {
    const cat = cats.get(it.categoryId);
    if (!cat) continue;
    const slot = it.slotOverride ?? cat.slot;
    let layer: Layer = cat.layer;
    if (it.slotOverride && it.slotOverride !== cat.slot) {
      layer = slot === "outer" ? "outer" : slot === "top" ? "base" : "none";
    }
    out.push({
      id: it.id,
      name: it.name,
      categoryKey: cat.key,
      categoryName: cat.name,
      subtype: it.subtype,
      slot,
      layer,
      accessoryKind: slot === "accessory" ? (cat.accessoryKind ?? "other") : null,
      standalone: layer === "mid" ? cat.standalone : true,
      beltLoops: cat.beltLoops,
      legCoverage: cat.legCoverage,
      colors: it.colors,
      pattern: it.pattern,
      material: it.material,
      fit: it.fit,
      styles: it.styles,
      seasons: it.seasons,
      occasions: it.occasions,
      formality: Number.isFinite(it.formality) ? it.formality : cat.formality,
      warmth: Number.isFinite(it.warmth) ? it.warmth : cat.warmth,
      favorite: it.favorite,
      tags: it.tags,
      status: it.status,
      wearCount: it.wearCount,
      lastWornDaysAgo: it.lastWornOn ? daysBetween(it.lastWornOn, today) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weather → climate
// ---------------------------------------------------------------------------

export interface Climate {
  /** Effective temperature the outfit is built for. */
  temp: number;
  /** Desired sum of torso warmth points. */
  targetTorso: number;
  rain: boolean;
  windy: boolean;
  /** Temperature swing over the day. */
  spread: number;
}

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

export function climateFrom(w: WeatherContext | null): Climate | null {
  if (!w) return null;
  const now = w.feelsLikeC ?? w.tempC;
  const hasRange = w.tempMinC != null && w.tempMaxC != null;
  const temp = hasRange ? 0.5 * now + 0.25 * w.tempMinC! + 0.25 * w.tempMaxC! : now;
  return {
    temp,
    targetTorso: clamp((24 - temp) / 2.9, 0.8, 9),
    rain:
      (w.precipitationProbability ?? 0) >= 50 ||
      (w.precipitationMm ?? 0) >= 1 ||
      (w.weatherCode != null && RAIN_CODES.has(w.weatherCode)),
    windy: (w.windKmh ?? 0) >= 30,
    spread: hasRange ? w.tempMaxC! - w.tempMinC! : 0,
  };
}

// ---------------------------------------------------------------------------
// Personal signals
// ---------------------------------------------------------------------------

export interface Affinities {
  item: Map<string, number>;
  pair: Map<string, number>;
  color: Map<string, number>;
  style: Map<string, number>;
  outfit: Map<string, number>;
}

export const emptyAffinities = (): Affinities => ({
  item: new Map(),
  pair: new Map(),
  color: new Map(),
  style: new Map(),
  outfit: new Map(),
});

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const outfitKey = (ids: string[]) => [...ids].sort().join(",");

// ---------------------------------------------------------------------------
// Engine context
// ---------------------------------------------------------------------------

export interface ProfileInput {
  preferredStyles: StyleId[];
  favoriteColors: string[];
  avoidedColors: string[];
  experimental: number;
  boldness: number;
  personalizationEnabled: boolean;
  avoidRepeatDays: number;
}

export interface EngineContext {
  request: GenerateRequest;
  styles: StyleId[];
  occasion: OccasionId | null;
  targetFormality: number;
  boldness: number;
  experimental: number;
  weather: WeatherContext | null;
  climate: Climate | null;
  season: SeasonId;
  affinities: Affinities;
  personalization: boolean;
  favoriteColors: Set<string>;
  avoidedColors: Set<string>;
  avoidRepeatDays: number;
  /** Outfit key → days since it was last worn. */
  recentOutfits: Map<string, number>;
  trend: TrendDef | null;
  rng: () => number;
}

const STYLE_FORMALITY: Record<StyleId, number> = {
  streetwear: 1.5,
  casual: 2,
  smart_casual: 3,
  old_money: 3.5,
  minimal: 2.7,
  vintage: 2.3,
  grunge: 1.5,
  sporty: 1,
  elegant: 4.2,
  business: 4,
  skater: 1.2,
  y2k: 1.8,
  preppy: 3,
  dark_academia: 3,
};

export function buildContext(opts: {
  request: GenerateRequest;
  profile: ProfileInput;
  affinities?: Affinities;
  recentOutfits?: Map<string, number>;
  trend?: TrendDef | null;
  today?: Date;
}): EngineContext {
  const { request, profile } = opts;
  const today = opts.today ?? (request.date ? new Date(request.date + "T12:00:00") : new Date());
  const styles = request.styles.length ? request.styles : profile.preferredStyles;
  const occ = request.occasion ? OCCASIONS.find((o) => o.id === request.occasion) : undefined;
  const styleF = styles.length ? styles.reduce((a, s) => a + STYLE_FORMALITY[s], 0) / styles.length : null;
  let targetFormality = request.formality ?? (occ && styleF != null ? 0.6 * occ.formality + 0.4 * styleF : (occ?.formality ?? styleF ?? 2.3));
  targetFormality = clamp(targetFormality, 0.5, 5);
  return {
    request,
    styles,
    occasion: request.occasion,
    targetFormality,
    boldness: request.boldness ?? profile.boldness,
    experimental: request.experimental ?? profile.experimental,
    weather: request.weather,
    climate: climateFrom(request.weather),
    season: seasonForDate(today),
    affinities: profile.personalizationEnabled ? (opts.affinities ?? emptyAffinities()) : emptyAffinities(),
    personalization: profile.personalizationEnabled,
    favoriteColors: new Set(profile.favoriteColors),
    avoidedColors: new Set(profile.avoidedColors),
    avoidRepeatDays: profile.avoidRepeatDays,
    recentOutfits: opts.recentOutfits ?? new Map(),
    trend: opts.trend ?? null,
    rng: mulberry32(request.seed ?? 1),
  };
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
