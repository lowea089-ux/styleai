// Candidate generation over the user's real wardrobe. Only items passed in can ever appear in a result.
import type { AccessoryKind, StyleId } from "../taxonomy";
import { labelOf } from "../taxonomy";
import { trendItemScore } from "../trends";
import type { GeneratedOutfit, OutfitItemRef, OutfitRole } from "../types";
import { clamp01, outfitKey, type EngineContext, type EngineItem, type Part } from "./context";
import { explainOutfit } from "./explain";
import { itemStyleMatch, scoreOutfit, type ScoreResult } from "./score";

export interface GenerateResult {
  outfits: GeneratedOutfit[];
  /** Human-readable reasons when fewer outfits than requested could be built. */
  diagnostics: string[];
  candidateCount: number;
}

interface Pools {
  topsAlone: EngineItem[];
  bases: EngineItem[];
  mids: EngineItem[];
  bottoms: EngineItem[];
  onepieces: EngineItem[];
  suits: EngineItem[];
  outers: EngineItem[];
  shoes: EngineItem[];
  acc: Map<AccessoryKind, EngineItem[]>;
}

const isTopAlone = (i: EngineItem) => i.slot === "top" && (i.layer === "base" || (i.layer === "mid" && i.standalone));

function buildPools(items: EngineItem[]): Pools {
  const acc = new Map<AccessoryKind, EngineItem[]>();
  for (const i of items.filter((x) => x.slot === "accessory")) {
    const k = i.accessoryKind ?? "other";
    acc.set(k, [...(acc.get(k) ?? []), i]);
  }
  return {
    topsAlone: items.filter(isTopAlone),
    bases: items.filter((i) => i.slot === "top" && i.layer === "base"),
    mids: items.filter((i) => i.slot === "top" && i.layer === "mid"),
    bottoms: items.filter((i) => i.slot === "bottom"),
    onepieces: items.filter((i) => i.slot === "onepiece"),
    suits: items.filter((i) => i.slot === "suit"),
    outers: items.filter((i) => i.slot === "outer"),
    shoes: items.filter((i) => i.slot === "shoes"),
    acc,
  };
}

/** Quick single-item relevance used to prune large wardrobes before combining. */
function unary(item: EngineItem, ctx: EngineContext): number {
  let s = 0.35 * itemStyleMatch(item, ctx.styles);
  s += 0.25 * clamp01(1 - Math.abs(item.formality - ctx.targetFormality) / 2.5);
  s += 0.1 * (item.seasons.length === 0 ? 0.7 : item.seasons.includes(ctx.season) ? 1 : 0.3);
  if (ctx.climate) {
    const t = ctx.climate.temp;
    if (item.slot === "outer") s += 0.15 * clamp01(item.warmth / Math.max(0.5, (22 - t) / 4));
    else if (item.legCoverage === "short") s += t >= 18 ? 0.12 : -0.1;
    else s += 0.08;
  } else s += 0.08;
  if (ctx.personalization) s += 0.1 * (ctx.affinities.item.get(item.id) ?? 0);
  if (item.favorite) s += ctx.request.preferFavorites ? 0.15 : 0.03;
  if (ctx.request.colors.some((c) => item.colors.some((x) => x.family === c))) s += 0.1;
  if (item.colors.some((c) => ctx.avoidedColors.has(c.family))) s -= 0.1;
  if (item.lastWornDaysAgo !== null && item.lastWornDaysAgo < ctx.avoidRepeatDays) s -= 0.08;
  if (ctx.trend) s += 0.15 * trendItemScore(ctx.trend, item);
  // Jitter keeps "neu generieren" from returning the same set; experimental users get more of it.
  s += ctx.rng() * (0.06 + 0.08 * ctx.experimental);
  return s;
}

function topN(items: EngineItem[], n: number, ctx: EngineContext, forced: EngineItem[] = []): EngineItem[] {
  if (forced.length) return forced;
  return items
    .map((i) => ({ i, s: unary(i, ctx) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.i);
}

function mainKey(parts: Part[]) {
  return outfitKey(parts.filter((p) => !p.role.startsWith("acc:")).map((p) => p.item.id));
}

function evaluate(parts: Part[], ctx: EngineContext, similarTo: Set<string> | null) {
  const r = scoreOutfit(parts, ctx);
  let total = r.total;
  if (similarTo) {
    const ids = parts.map((p) => p.item.id);
    const shared = ids.filter((i) => similarTo.has(i)).length;
    const overlap = shared / Math.max(ids.length, similarTo.size);
    total += shared === 0 ? -0.3 : 0.1 * (1 - Math.abs(overlap - 0.5) * 2);
    if (overlap === 1) total -= 0.5;
  }
  return { r, total };
}

const ACCESSORY_ORDER: AccessoryKind[] = ["belt", "bag", "head", "scarf", "watch", "jewelry", "other"];

function addAccessories(parts: Part[], pools: Pools, ctx: EngineContext, forced: Map<AccessoryKind, EngineItem>, similar: Set<string> | null): Part[] {
  const maxAcc = 1 + Math.round(ctx.boldness * 2);
  let current = [...parts];
  for (const [kind, item] of forced) current.push({ item, role: `acc:${kind}` });
  let best = evaluate(current, ctx, similar).total;
  for (const kind of ACCESSORY_ORDER) {
    if (forced.has(kind)) continue;
    if (current.filter((p) => p.role.startsWith("acc:")).length >= maxAcc) break;
    const options = pools.acc.get(kind);
    if (!options?.length) continue;
    if (kind === "belt" && !current.some((p) => p.item.beltLoops)) continue;
    let chosen: Part[] | null = null;
    for (const item of options.slice(0, 6)) {
      const trial = [...current, { item, role: `acc:${kind}` as OutfitRole }];
      const t = evaluate(trial, ctx, similar).total;
      if (t > best + 0.002) {
        best = t;
        chosen = trial;
      }
    }
    if (chosen) current = chosen;
  }
  return current;
}

export function diagnose(all: EngineItem[], available: EngineItem[]): string[] {
  const msgs: string[] = [];
  const pools = buildPools(available);
  const allPools = buildPools(all);
  const hasTorso = pools.topsAlone.length > 0 || pools.onepieces.length > 0 || (pools.suits.length > 0 && pools.bases.length > 0);
  if (!all.length) return ["Dein Kleiderschrank ist noch leer. Füge zuerst ein paar Kleidungsstücke hinzu."];
  if (!hasTorso) {
    msgs.push(
      allPools.topsAlone.length + allPools.onepieces.length > 0
        ? "Alle Oberteile und Kleider sind gerade nicht verfügbar (Wäsche/Reinigung oder ausgeschlossen)."
        : "Es fehlen Oberteile oder Kleider im Kleiderschrank.",
    );
  }
  if (pools.topsAlone.length && !pools.bottoms.length && !pools.onepieces.length && !pools.suits.length) {
    msgs.push(
      allPools.bottoms.length
        ? "Alle Hosen und Röcke sind gerade nicht verfügbar."
        : "Es fehlen Hosen oder Röcke im Kleiderschrank.",
    );
  }
  if (!pools.shoes.length) msgs.push(allPools.shoes.length ? "Alle Schuhe sind gerade nicht verfügbar." : "Noch keine Schuhe im Kleiderschrank – Outfits werden ohne Schuhe vorgeschlagen.");
  return msgs;
}

export function generateOutfits(all: EngineItem[], ctx: EngineContext): GenerateResult {
  const req = ctx.request;
  const byId = new Map(all.map((i) => [i.id, i]));
  const diagnostics: string[] = [];

  // --- must-include handling -----------------------------------------------------------------
  const forced: EngineItem[] = [];
  for (const id of req.mustInclude) {
    const it = byId.get(id);
    if (!it) {
      diagnostics.push("Ein gewünschtes Kleidungsstück existiert nicht (mehr) in deinem Kleiderschrank.");
      return { outfits: [], diagnostics, candidateCount: 0 };
    }
    if (it.status !== "available") {
      diagnostics.push(`${"„" + it.name + "“"} ist gerade als „${labelOf.status(it.status)}“ markiert und kann nicht verwendet werden.`);
      return { outfits: [], diagnostics, candidateCount: 0 };
    }
    forced.push(it);
  }
  const excluded = new Set(req.exclude.filter((id) => !req.mustInclude.includes(id)));
  const available = all.filter((i) => i.status === "available" && !excluded.has(i.id));
  const pools = buildPools(available);
  const similar = req.similarTo?.length ? new Set(req.similarTo) : null;

  const forcedBy = (pred: (i: EngineItem) => boolean) => forced.filter(pred);
  const fTopAlone = forcedBy(isTopAlone);
  const fBase = forcedBy((i) => i.slot === "top" && i.layer === "base");
  const fMid = forcedBy((i) => i.slot === "top" && i.layer === "mid");
  const fBottom = forcedBy((i) => i.slot === "bottom");
  const fOne = forcedBy((i) => i.slot === "onepiece");
  const fSuit = forcedBy((i) => i.slot === "suit");
  const fOuter = forcedBy((i) => i.slot === "outer");
  const fShoes = forcedBy((i) => i.slot === "shoes");
  const fAcc = new Map<AccessoryKind, EngineItem>();
  for (const i of forced.filter((x) => x.slot === "accessory")) fAcc.set(i.accessoryKind ?? "other", i);
  for (const group of [fBottom, fOne, fSuit, fOuter, fShoes]) {
    if (group.length > 1) {
      diagnostics.push("Es können nicht mehrere Teile derselben Art gleichzeitig getragen werden (z. B. zwei Hosen).");
      return { outfits: [], diagnostics, candidateCount: 0 };
    }
  }

  const shoes = pools.shoes.length ? topN(pools.shoes, 9, ctx, fShoes) : [null];
  const cores: Part[][] = [];

  // Template A: top + bottom (+ shoes). A forced mid (e.g. cardigan) means its base is chosen freely.
  const allowA = !fOne.length && !fSuit.length;
  if (allowA) {
    let tops = topN(pools.topsAlone, 14, ctx, fTopAlone.length === 1 ? fTopAlone : fBase.length === 1 ? fBase : []);
    if (fMid.length && !fMid[0].standalone) tops = topN(pools.bases, 10, ctx, fBase);
    const bottoms = topN(pools.bottoms, 12, ctx, fBottom);
    for (const t of tops)
      for (const b of bottoms)
        for (const s of shoes) {
          const role: OutfitRole = t.layer === "mid" ? "top" : fMid.length && !fMid[0].standalone ? "base" : "top";
          const parts: Part[] = [{ item: t, role }, { item: b, role: "bottom" }];
          if (s) parts.push({ item: s, role: "shoes" });
          cores.push(parts);
        }
  }
  // Template B: dress (+ shoes)
  if (!fBottom.length && !fSuit.length && !fTopAlone.some((t) => t.layer === "base")) {
    for (const d of topN(pools.onepieces, 10, ctx, fOne))
      for (const s of shoes) cores.push(s ? [{ item: d, role: "onepiece" }, { item: s, role: "shoes" }] : [{ item: d, role: "onepiece" }]);
  }
  // Template C: suit + base top (+ shoes)
  if (!fBottom.length && !fOne.length && !fMid.length) {
    const suitBases = pools.bases.filter((b) => ["shirt", "blouse", "polo", "tshirt", "longsleeve"].includes(b.categoryKey ?? "") || b.formality >= 2);
    for (const su of topN(pools.suits, 5, ctx, fSuit))
      for (const b of topN(suitBases, 6, ctx, fBase))
        for (const s of shoes) {
          const parts: Part[] = [{ item: b, role: "base" }, { item: su, role: "suit" }];
          if (s) parts.push({ item: s, role: "shoes" });
          cores.push(parts);
        }
  }

  // Score cores and keep the most promising.
  const scoredCores = cores
    .map((parts) => ({ parts, total: evaluate(parts, ctx, null).total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 110);

  const midOptions = topN(pools.mids, 7, ctx, fMid);
  const outerOptions = topN(pools.outers, 7, ctx, fOuter);
  const expanded: { parts: Part[]; total: number }[] = [];
  for (const { parts } of scoredCores) {
    const hasBase = parts.some((p) => p.role === "base" || (p.role === "top" && p.item.layer === "base"));
    const hasSuit = parts.some((p) => p.role === "suit");
    const onepiece = parts.some((p) => p.role === "onepiece");
    // A forced standalone mid (e.g. a sweater) may already be the core top.
    const midInCore = fMid.length > 0 && parts.some((p) => p.item.id === fMid[0].id);
    const midChoices: (EngineItem | null)[] = [];
    if (!midInCore && !hasSuit && (hasBase || onepiece))
      midChoices.push(...midOptions.filter((m) => !onepiece || !m.standalone || m.categoryKey === "cardigan"));
    if (!fMid.length || midInCore) midChoices.push(null);
    const outerChoices: (EngineItem | null)[] = [...outerOptions];
    if (!fOuter.length) outerChoices.push(null);

    const local: { parts: Part[]; total: number }[] = [];
    for (const m of midChoices) {
      if (fMid.length && !midInCore && m?.id !== fMid[0].id) continue;
      for (const o of outerChoices) {
        const trial = parts.map((p) => (m && p.role === "top" && p.item.layer === "base" ? { ...p, role: "base" as OutfitRole } : p));
        if (m) trial.push({ item: m, role: "mid" });
        if (o) trial.push({ item: o, role: "outer" });
        local.push({ parts: trial, total: evaluate(trial, ctx, similar).total });
      }
    }
    local.sort((a, b) => b.total - a.total);
    expanded.push(...local.slice(0, 3));
  }

  const avoid = new Set(req.avoidKeys);
  const ranked = expanded
    .filter((c) => !avoid.has(mainKey(c.parts)))
    .sort((a, b) => b.total - a.total)
    .slice(0, 70)
    .map((c) => {
      const parts = addAccessories(c.parts, pools, ctx, fAcc, similar);
      return { parts, total: evaluate(parts, ctx, similar).total };
    })
    .filter((c) => forced.every((f) => c.parts.some((p) => p.item.id === f.id)))
    .sort((a, b) => b.total - a.total);

  // Diversity: maximal marginal relevance over shared main items.
  const selected: { parts: Part[]; total: number }[] = [];
  const seen = new Set<string>();
  while (selected.length < req.count && ranked.length) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < ranked.length; i++) {
      const k = mainKey(ranked[i].parts);
      if (seen.has(k)) continue;
      const ids = new Set(ranked[i].parts.filter((p) => !p.role.startsWith("acc:")).map((p) => p.item.id));
      let maxOverlap = 0;
      for (const s of selected) {
        const sIds = s.parts.filter((p) => !p.role.startsWith("acc:")).map((p) => p.item.id);
        const shared = sIds.filter((x) => ids.has(x)).length;
        maxOverlap = Math.max(maxOverlap, shared / Math.max(ids.size, sIds.length));
      }
      const val = ranked[i].total - 0.22 * maxOverlap;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const pick = ranked.splice(bestIdx, 1)[0];
    seen.add(mainKey(pick.parts));
    selected.push(pick);
  }

  if (!selected.length) diagnostics.push(...diagnose(all, available));
  else if (selected.length < req.count) diagnostics.push(`Mit den verfügbaren Teilen ließen sich nur ${selected.length} unterschiedliche Outfits bilden.`);
  if (!pools.shoes.length && selected.length) diagnostics.push(...diagnose(all, available).filter((d) => d.includes("Schuhe")));

  return {
    outfits: selected.map((s) => toGenerated(s.parts, ctx)),
    diagnostics: [...new Set(diagnostics)],
    candidateCount: expanded.length,
  };
}

export function toGenerated(parts: Part[], ctx: EngineContext, r?: ScoreResult): GeneratedOutfit {
  const result = r ?? scoreOutfit(parts, ctx);
  const ordered = orderParts(parts);
  return {
    key: mainKey(parts),
    items: ordered.map((p) => ({ itemId: p.item.id, role: p.role })),
    score: Math.round(result.total * 100),
    breakdown: Object.fromEntries(Object.entries(result.breakdown).map(([k, v]) => [k, Math.round(v * 100) / 100])) as GeneratedOutfit["breakdown"],
    colorKind: result.harmony.kind,
    explanation: explainOutfit(parts, result, ctx),
    warnings: result.warnings,
    styles: ctx.styles as StyleId[],
    occasion: ctx.occasion,
  };
}

const ROLE_ORDER: string[] = ["outer", "suit", "mid", "top", "base", "onepiece", "bottom", "shoes"];
function orderParts(parts: Part[]): Part[] {
  const rank = (r: string) => (r.startsWith("acc:") ? 100 : ROLE_ORDER.indexOf(r));
  return [...parts].sort((a, b) => rank(a.role) - rank(b.role));
}

/** Resolve stored references to parts; unknown or deleted items are dropped. */
export function partsFromRefs(refs: OutfitItemRef[], all: EngineItem[]): Part[] {
  const byId = new Map(all.map((i) => [i.id, i]));
  const out: Part[] = [];
  for (const r of refs) {
    const item = byId.get(r.itemId);
    if (item && !out.some((p) => p.item.id === item.id)) out.push({ item, role: r.role });
  }
  return out;
}

function candidatesForRole(role: OutfitRole, pool: EngineItem[], parts: Part[]): EngineItem[] {
  const hasMidOver = parts.some((p) => p.role === "mid");
  switch (role) {
    case "top":
      return pool.filter(isTopAlone);
    case "base":
      return pool.filter((i) => i.slot === "top" && i.layer === "base");
    case "mid":
      return pool.filter((i) => i.slot === "top" && i.layer === "mid" && (i.standalone || parts.some((p) => p.role === "base") || !hasMidOver));
    case "bottom":
      return pool.filter((i) => i.slot === "bottom");
    case "onepiece":
      return pool.filter((i) => i.slot === "onepiece");
    case "suit":
      return pool.filter((i) => i.slot === "suit");
    case "outer":
      return pool.filter((i) => i.slot === "outer");
    case "shoes":
      return pool.filter((i) => i.slot === "shoes");
    default: {
      const kind = role.slice(4) as AccessoryKind;
      return pool.filter((i) => i.slot === "accessory" && (i.accessoryKind ?? "other") === kind);
    }
  }
}

export interface SwapOption {
  itemId: string | null;
  score: number;
  delta: number;
  outfit: GeneratedOutfit;
}

/**
 * Alternatives for one piece while every other piece stays fixed.
 * `itemId: null` means "remove this piece" (only offered for optional layers and accessories).
 */
export function swapAlternatives(all: EngineItem[], refs: OutfitItemRef[], replaceItemId: string, ctx: EngineContext, limit = 6): SwapOption[] {
  const parts = partsFromRefs(refs, all);
  const target = parts.find((p) => p.item.id === replaceItemId);
  if (!target) return [];
  const base = scoreOutfit(parts, ctx).total;
  const rest = parts.filter((p) => p !== target);
  const inOutfit = new Set(parts.map((p) => p.item.id));
  const excluded = new Set(ctx.request.exclude);
  const pool = all.filter((i) => i.status === "available" && !inOutfit.has(i.id) && !excluded.has(i.id));
  const options: SwapOption[] = [];
  for (const item of candidatesForRole(target.role, pool, rest)) {
    const trial = [...rest, { item, role: target.role }];
    const r = scoreOutfit(trial, ctx);
    options.push({ itemId: item.id, score: Math.round(r.total * 100), delta: Math.round((r.total - base) * 100), outfit: toGenerated(trial, ctx, r) });
  }
  options.sort((a, b) => b.score - a.score);
  const optional = target.role === "mid" || target.role === "outer" || target.role.startsWith("acc:");
  const result = options.slice(0, limit);
  if (optional) {
    const r = scoreOutfit(rest, ctx);
    result.push({ itemId: null, score: Math.round(r.total * 100), delta: Math.round((r.total - base) * 100), outfit: toGenerated(rest, ctx, r) });
  }
  return result;
}

/** Re-score a user-edited outfit. */
export function rescore(all: EngineItem[], refs: OutfitItemRef[], ctx: EngineContext): GeneratedOutfit | null {
  const parts = partsFromRefs(refs, all);
  return parts.length ? toGenerated(parts, ctx) : null;
}
