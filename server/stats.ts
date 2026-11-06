import type { Category, ClothingItem } from "../shared/types";
import type { DB } from "./db";

export interface WardrobeStats {
  totalItems: number;
  availableItems: number;
  unavailableItems: number;
  totalValueCents: number;
  itemsWithPrice: number;
  wornLast90Days: number;
  utilization90: number;
  wearsLast30Days: number;
  mostWorn: { itemId: string; count: number }[];
  neverWorn: string[];
  rarelyWorn: { itemId: string; count: number; lastWornOn: string | null }[];
  costPerWear: { itemId: string; priceCents: number; wears: number; costPerWearCents: number | null }[];
  byGroup: { group: string; count: number }[];
  byColor: { family: string; count: number }[];
  savedOutfits: number;
}

export function computeStats(db: DB, userId: string, items: ClothingItem[], categories: Category[]): WardrobeStats {
  const today = new Date();
  const d90 = new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const d30 = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const recent = db.prepare("SELECT item_id, worn_on FROM wear_log WHERE user_id = ? AND worn_on >= ?").all(userId, d90) as { item_id: string; worn_on: string }[];
  const worn90 = new Set(recent.map((r) => r.item_id));
  const saved = db.prepare("SELECT COUNT(*) AS n FROM outfits WHERE user_id = ? AND saved = 1").get(userId) as { n: number };
  const cats = new Map(categories.map((c) => [c.id, c]));

  // Accessories are excluded from "never worn" nudges: they are often worn without being logged.
  const clothing = items.filter((i) => cats.get(i.categoryId)?.group !== "accessories");
  const oldEnough = (i: ClothingItem) => today.getTime() - Date.parse(i.createdAt) > 14 * 86_400_000;

  const groupCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();
  for (const i of items) {
    const g = cats.get(i.categoryId)?.group ?? "more";
    groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
    const c = i.colors[0]?.family;
    if (c) colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
  }

  const priced = items.filter((i) => i.priceCents != null);
  return {
    totalItems: items.length,
    availableItems: items.filter((i) => i.status === "available").length,
    unavailableItems: items.filter((i) => i.status !== "available").length,
    totalValueCents: priced.reduce((a, i) => a + (i.priceCents ?? 0), 0),
    itemsWithPrice: priced.length,
    wornLast90Days: worn90.size,
    utilization90: items.length ? worn90.size / items.length : 0,
    wearsLast30Days: new Set(recent.filter((r) => r.worn_on >= d30).map((r) => r.worn_on)).size,
    mostWorn: items
      .filter((i) => i.wearCount > 0)
      .sort((a, b) => b.wearCount - a.wearCount)
      .slice(0, 6)
      .map((i) => ({ itemId: i.id, count: i.wearCount })),
    neverWorn: clothing.filter((i) => i.wearCount === 0 && oldEnough(i)).map((i) => i.id),
    rarelyWorn: clothing
      .filter((i) => i.wearCount > 0 && !worn90.has(i.id))
      .sort((a, b) => (a.lastWornOn ?? "").localeCompare(b.lastWornOn ?? ""))
      .slice(0, 8)
      .map((i) => ({ itemId: i.id, count: i.wearCount, lastWornOn: i.lastWornOn })),
    costPerWear: priced
      .map((i) => ({
        itemId: i.id,
        priceCents: i.priceCents!,
        wears: i.wearCount,
        costPerWearCents: i.wearCount ? Math.round(i.priceCents! / i.wearCount) : null,
      }))
      .sort((a, b) => (b.costPerWearCents ?? b.priceCents) - (a.costPerWearCents ?? a.priceCents)),
    byGroup: [...groupCounts.entries()].map(([group, count]) => ({ group, count })),
    byColor: [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([family, count]) => ({ family, count })),
    savedOutfits: saved.n,
  };
}
