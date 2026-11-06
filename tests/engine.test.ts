import { describe, expect, it } from "vitest";
import { buildContext } from "../shared/engine/context";
import { generateOutfits, swapAlternatives } from "../shared/engine/generate";
import { computeAffinities } from "../shared/engine/personalization";
import { scoreOutfit } from "../shared/engine/score";
import { generateRequestSchema } from "../shared/schemas";
import { getTrend } from "../shared/trends";
import { ctx, engine, item, profile, wardrobe } from "./fixtures";

const ids = (o: { items: { itemId: string }[] }) => o.items.map((i) => i.itemId);

describe("generateOutfits", () => {
  it("only uses items from the wardrobe and returns the requested count", () => {
    const items = engine(wardrobe());
    const known = new Set(items.map((i) => i.id));
    const res = generateOutfits(items, ctx({ count: 3 }));
    expect(res.outfits).toHaveLength(3);
    for (const o of res.outfits) {
      for (const id of ids(o)) expect(known.has(id)).toBe(true);
      expect(new Set(ids(o)).size).toBe(ids(o).length);
      expect(o.score).toBeGreaterThan(0);
      expect(o.score).toBeLessThanOrEqual(100);
      expect(o.explanation.summary.length).toBeGreaterThan(20);
    }
    // Diversity: outfits are not identical.
    expect(new Set(res.outfits.map((o) => o.key)).size).toBe(3);
  });

  it("builds structurally valid outfits (torso + legs + shoes)", () => {
    const res = generateOutfits(engine(wardrobe()), ctx({ count: 4 }));
    for (const o of res.outfits) {
      const roles = o.items.map((i) => i.role);
      expect(roles.some((r) => ["top", "base", "onepiece", "suit"].includes(r))).toBe(true);
      expect(roles.some((r) => ["bottom", "onepiece", "suit"].includes(r))).toBe(true);
      expect(roles.filter((r) => r === "shoes")).toHaveLength(1);
      expect(roles.filter((r) => r === "bottom").length).toBeLessThanOrEqual(1);
    }
  });

  it("works with very few items", () => {
    const items = engine([item("tshirt", "weiss", { id: "t" }), item("jeans", "jeansblau", { id: "j" }), item("sneakers", "weiss", { id: "s" })]);
    const res = generateOutfits(items, ctx({ count: 3 }));
    expect(res.outfits).toHaveLength(1);
    expect(ids(res.outfits[0]).sort()).toEqual(["j", "s", "t"]);
    expect(res.diagnostics.join(" ")).toContain("nur 1");
  });

  it("explains an empty wardrobe instead of failing", () => {
    const res = generateOutfits([], ctx());
    expect(res.outfits).toEqual([]);
    expect(res.diagnostics[0]).toMatch(/leer/);
  });

  it("still proposes outfits without shoes and says so", () => {
    const items = engine([item("tshirt", "weiss"), item("jeans", "jeansblau")]);
    const res = generateOutfits(items, ctx());
    expect(res.outfits).toHaveLength(1);
    expect(res.diagnostics.join(" ")).toMatch(/Schuhe/);
  });

  it("never uses unavailable items", () => {
    const wr = wardrobe().map((i) => (i.id === "jeans" || i.id === "sneakers" ? { ...i, status: "laundry" as const } : i));
    const res = generateOutfits(engine(wr), ctx({ count: 6 }));
    expect(res.outfits.length).toBeGreaterThan(0);
    for (const o of res.outfits) {
      expect(ids(o)).not.toContain("jeans");
      expect(ids(o)).not.toContain("sneakers");
    }
  });

  it("honours must-include and exclude", () => {
    const res = generateOutfits(engine(wardrobe()), ctx({ count: 3, mustInclude: ["cargo"], exclude: ["tee-black", "boots"] }));
    expect(res.outfits.length).toBeGreaterThan(0);
    for (const o of res.outfits) {
      expect(ids(o)).toContain("cargo");
      expect(ids(o)).not.toContain("tee-black");
      expect(ids(o)).not.toContain("boots");
    }
  });

  it("handles a forced standalone mid layer (sweater) and a forced cardigan", () => {
    const wr = [...wardrobe(), item("cardigan", "grau", { id: "cardigan" })];
    const a = generateOutfits(engine(wr), ctx({ mustInclude: ["sweater-navy"] }));
    expect(a.outfits.length).toBeGreaterThan(0);
    a.outfits.forEach((o) => expect(ids(o)).toContain("sweater-navy"));
    const b = generateOutfits(engine(wr), ctx({ mustInclude: ["cardigan"] }));
    expect(b.outfits.length).toBeGreaterThan(0);
    for (const o of b.outfits) {
      expect(o.items.find((i) => i.itemId === "cardigan")?.role).toBe("mid");
      expect(o.items.some((i) => i.role === "base")).toBe(true);
    }
  });

  it("explains why an unavailable must-include item cannot be used", () => {
    const wr = wardrobe().map((i) => (i.id === "coat" ? { ...i, status: "cleaning" as const } : i));
    const res = generateOutfits(engine(wr), ctx({ mustInclude: ["coat"] }));
    expect(res.outfits).toEqual([]);
    expect(res.diagnostics[0]).toMatch(/Reinigung/);
  });

  it("dresses warmly in the cold and lightly in the heat", () => {
    const cold = generateOutfits(engine(wardrobe()), ctx({ count: 3, weather: { tempC: 1, source: "manuell" } }));
    for (const o of cold.outfits) expect(o.items.some((i) => i.role === "outer")).toBe(true);
    expect(cold.outfits.some((o) => ids(o).includes("coat"))).toBe(true);
    for (const o of cold.outfits) expect(ids(o)).not.toContain("shorts");

    const hot = generateOutfits(engine(wardrobe()), ctx({ count: 3, weather: { tempC: 31, source: "manuell" } }));
    for (const o of hot.outfits) expect(ids(o)).not.toContain("coat");
    expect(hot.outfits[0].breakdown.weather).toBeGreaterThan(0.6);
  });

  it("warns about rain when no jacket fits", () => {
    const wr = wardrobe().filter((i) => i.id !== "jacket" && i.id !== "coat");
    const res = generateOutfits(engine(wr), ctx({ count: 1, weather: { tempC: 12, precipitationProbability: 90, source: "manuell" } }));
    expect(res.outfits[0].warnings.join(" ")).toMatch(/Regen/);
  });

  it("matches requested styles and occasion formality", () => {
    const smart = generateOutfits(engine(wardrobe()), ctx({ count: 1, styles: ["old_money"], occasion: "restaurant" }));
    const street = generateOutfits(engine(wardrobe()), ctx({ count: 1, styles: ["streetwear"], occasion: "freunde" }));
    expect(ids(smart.outfits[0])).toEqual(expect.arrayContaining(["chinos"]));
    expect(ids(street.outfits[0]).some((i) => ["cargo", "hoodie-grey", "tee-black", "jeans"].includes(i))).toBe(true);
    expect(smart.outfits[0].breakdown.style).toBeGreaterThan(0.6);
  });

  it("returns different outfits when regenerating with avoidKeys", () => {
    const first = generateOutfits(engine(wardrobe()), ctx({ count: 2 }));
    const again = generateOutfits(engine(wardrobe()), ctx({ count: 2, seed: 99, avoidKeys: first.outfits.map((o) => o.key) }));
    for (const o of again.outfits) expect(first.outfits.map((x) => x.key)).not.toContain(o.key);
  });

  it("scales to a large wardrobe", () => {
    const colors = ["schwarz", "weiss", "navy", "grau", "beige", "oliv", "bordeaux", "camel"] as const;
    const keys = ["tshirt", "shirt", "sweater", "hoodie", "jeans", "chinos", "trousers", "jacket", "coat", "sneakers", "boots", "dress_shoes", "belt", "bag", "dress", "blazer"];
    const big = Array.from({ length: 320 }, (_, i) => item(keys[i % keys.length], colors[i % colors.length]));
    const t0 = performance.now();
    const res = generateOutfits(engine(big), ctx({ count: 6, weather: { tempC: 9, source: "manuell" } }));
    expect(res.outfits).toHaveLength(6);
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it("boosts trend items when a trend is selected", () => {
    const wr = [...wardrobe(), item("sweater", "bordeaux", { id: "maroon" })];
    const res = generateOutfits(engine(wr), buildContext({ request: generateRequestSchema.parse({ seed: 3, count: 2 }), profile, trend: getTrend("moody-maroon"), today: new Date("2026-10-27T12:00:00") }));
    expect(res.outfits.some((o) => ids(o).includes("maroon"))).toBe(true);
  });
});

describe("swapAlternatives", () => {
  it("replaces one piece and keeps the rest", () => {
    const items = engine(wardrobe());
    const c = ctx({ count: 1 });
    const outfit = generateOutfits(items, c).outfits[0];
    const target = outfit.items.find((i) => i.role === "bottom")!;
    const options = swapAlternatives(items, outfit.items, target.itemId, c);
    expect(options.length).toBeGreaterThan(0);
    const bottoms = new Set(["jeans", "chinos", "cargo", "shorts"]);
    for (const opt of options) {
      expect(opt.itemId).not.toBe(target.itemId);
      expect(bottoms.has(opt.itemId!)).toBe(true);
      const rest = ids(opt.outfit).filter((x) => x !== opt.itemId).sort();
      expect(rest).toEqual(ids(outfit).filter((x) => x !== target.itemId).sort());
    }
    // sorted by score
    expect(options.map((o) => o.score)).toEqual([...options.map((o) => o.score)].sort((a, b) => b - a));
  });

  it("offers removal for optional layers only", () => {
    const items = engine(wardrobe());
    const c = ctx({ weather: { tempC: 5, source: "manuell" } });
    const outfit = generateOutfits(items, c).outfits[0];
    const outer = outfit.items.find((i) => i.role === "outer")!;
    expect(swapAlternatives(items, outfit.items, outer.itemId, c).some((o) => o.itemId === null)).toBe(true);
    const shoes = outfit.items.find((i) => i.role === "shoes")!;
    expect(swapAlternatives(items, outfit.items, shoes.itemId, c).some((o) => o.itemId === null)).toBe(false);
  });
});

describe("personalization", () => {
  it("lowers a disliked combination without excluding its items", () => {
    const items = engine(wardrobe());
    const base = ctx({ count: 1 });
    const top = generateOutfits(items, base).outfits[0];
    const parts = top.items.map((r) => ({ item: items.find((i) => i.id === r.itemId)!, role: r.role }));
    const events = [{ kind: "dislike" as const, itemIds: ids(top), fromItemId: null, toItemId: null, createdAt: new Date("2026-10-26").toISOString() }];
    const aff = computeAffinities(events, new Map(), new Date("2026-10-27"));
    const after = ctx({ count: 1 }, { affinities: aff });
    expect(scoreOutfit(parts, after).total).toBeLessThan(scoreOutfit(parts, base).total);
    for (const id of ids(top)) expect(aff.item.get(id)!).toBeGreaterThan(-0.3);

    const next = generateOutfits(items, ctx({ count: 3 }, { affinities: aff }));
    expect(next.outfits[0].key).not.toBe(top.key);
    // Items from the disliked outfit are still allowed in other combinations.
    const used = new Set(next.outfits.flatMap(ids));
    expect(ids(top).some((i) => used.has(i))).toBe(true);
  });

  it("decays old feedback", () => {
    const ev = (d: string) => [{ kind: "like" as const, itemIds: ["a", "b"], fromItemId: null, toItemId: null, createdAt: d }];
    const fresh = computeAffinities(ev("2026-10-26T00:00:00Z"), new Map(), new Date("2026-10-27"));
    const old = computeAffinities(ev("2026-01-01T00:00:00Z"), new Map(), new Date("2026-10-27"));
    expect(fresh.item.get("a")!).toBeGreaterThan(old.item.get("a")!);
  });

  it("can be switched off", () => {
    const aff = computeAffinities([{ kind: "like", itemIds: ["tee-white"], fromItemId: null, toItemId: null, createdAt: new Date().toISOString() }], new Map());
    const c = buildContext({ request: generateRequestSchema.parse({}), profile: { ...profile, personalizationEnabled: false }, affinities: aff });
    expect(c.affinities.item.size).toBe(0);
  });
});
