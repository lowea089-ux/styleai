// Turns raw feedback events into soft preference signals.
// Signals decay over time and are squashed into [-1, 1]; a rejection never excludes an item.
import { emptyAffinities, outfitKey, pairKey, type Affinities } from "./context";

export interface FeedbackEvent {
  kind: "like" | "dislike" | "save" | "wear" | "swap" | "remove_item";
  itemIds: string[];
  fromItemId: string | null;
  toItemId: string | null;
  createdAt: string;
}

export interface ItemTraits {
  colors: { family: string }[];
  styles: string[];
}

const HALF_LIFE_DAYS = 45;

const WEIGHTS = {
  like: { item: 0.6, pair: 0.8, outfit: 1, color: 0.25, style: 0.25 },
  save: { item: 0.5, pair: 0.6, outfit: 0.6, color: 0.15, style: 0.15 },
  wear: { item: 0.35, pair: 0.5, outfit: 0.3, color: 0.1, style: 0.1 },
  dislike: { item: -0.2, pair: -0.7, outfit: -1.5, color: -0.05, style: -0.05 },
} as const;

export function computeAffinities(
  events: FeedbackEvent[],
  traits: Map<string, ItemTraits>,
  now = new Date(),
): Affinities {
  const raw = {
    item: new Map<string, number>(),
    pair: new Map<string, number>(),
    color: new Map<string, number>(),
    style: new Map<string, number>(),
    outfit: new Map<string, number>(),
  };
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const ev of events) {
    const age = Math.max(0, (now.getTime() - Date.parse(ev.createdAt)) / 86_400_000);
    const decay = Math.pow(0.5, age / HALF_LIFE_DAYS);
    const ids = [...new Set(ev.itemIds)];

    if (ev.kind === "swap" || ev.kind === "remove_item") {
      const from = ev.fromItemId;
      const to = ev.toItemId;
      const others = ids.filter((i) => i !== from && i !== to);
      if (from) {
        add(raw.item, from, (ev.kind === "swap" ? -0.3 : -0.25) * decay);
        for (const o of others) add(raw.pair, pairKey(from, o), -0.4 * decay);
      }
      if (to) {
        add(raw.item, to, 0.35 * decay);
        for (const o of others) add(raw.pair, pairKey(to, o), 0.4 * decay);
      }
      continue;
    }

    const w = WEIGHTS[ev.kind];
    add(raw.outfit, outfitKey(ids), w.outfit * decay);
    for (let i = 0; i < ids.length; i++) {
      add(raw.item, ids[i], w.item * decay);
      for (let j = i + 1; j < ids.length; j++) add(raw.pair, pairKey(ids[i], ids[j]), w.pair * decay);
      const t = traits.get(ids[i]);
      if (!t) continue;
      for (const c of t.colors.slice(0, 1)) add(raw.color, c.family, w.color * decay);
      for (const s of t.styles) add(raw.style, s, (w.style * decay) / Math.max(1, t.styles.length));
    }
  }

  const out = emptyAffinities();
  for (const key of Object.keys(raw) as (keyof Affinities)[]) {
    for (const [k, v] of raw[key]) out[key].set(k, Math.tanh(v / 1.5));
  }
  return out;
}

export interface LearnedSummary {
  eventCount: number;
  likedItems: { id: string; value: number }[];
  lessLikedItems: { id: string; value: number }[];
  colors: { family: string; value: number }[];
  styles: { style: string; value: number }[];
}

export function summarizeAffinities(a: Affinities, eventCount: number): LearnedSummary {
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]);
  const items = sorted(a.item);
  return {
    eventCount,
    likedItems: items.filter(([, v]) => v > 0.15).slice(0, 8).map(([id, value]) => ({ id, value })),
    lessLikedItems: items.filter(([, v]) => v < -0.15).slice(-6).reverse().map(([id, value]) => ({ id, value })),
    colors: sorted(a.color).filter(([, v]) => Math.abs(v) > 0.05).slice(0, 8).map(([family, value]) => ({ family, value })),
    styles: sorted(a.style).filter(([, v]) => Math.abs(v) > 0.05).slice(0, 8).map(([style, value]) => ({ style, value })),
  };
}
