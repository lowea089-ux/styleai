import { describe, expect, it } from "vitest";
import { parseStylistMessage } from "../shared/nlp";
import { TRENDS, trendItemScore } from "../shared/trends";
import { explainSchema, garmentAnalysisSchema, stylistSchema, toStructuredSchema } from "../server/ai/schemas";

const items = [
  { id: "j1", name: "Weiße Jeans", categoryName: "Jeans", colors: [{ family: "weiss" }] },
  { id: "j2", name: "Blaue Slim-Jeans", categoryName: "Jeans", colors: [{ family: "jeansblau" }] },
  { id: "h1", name: "Grauer Hoodie", categoryName: "Hoodies", colors: [{ family: "grau" }] },
];

describe("local stylist parser", () => {
  it("understands occasion, style, weather and item mentions", () => {
    const r = parseStylistMessage("Elegantes Outfit fürs Restaurant mit meiner weißen Jeans, es ist kalt", items);
    expect(r.intent).toBe("outfit");
    expect(r.occasion).toBe("restaurant");
    expect(r.styles).toContain("elegant");
    expect(r.mustInclude).toEqual(["j1"]);
    expect(r.temperatureC).toBe(4);
  });

  it("handles exclusions, counts and degrees", () => {
    const r = parseStylistMessage("Zwei Streetwear Looks ohne den grauen Hoodie, 18 Grad und Regen", items);
    expect(r.exclude).toEqual(["h1"]);
    expect(r.count).toBe(2);
    expect(r.temperatureC).toBe(18);
    expect(r.rain).toBe(true);
    expect(r.styles).toContain("streetwear");
  });

  it("answers color questions without generating", () => {
    const r = parseStylistMessage("Passt Braun zu Schwarz?", items);
    expect(r.intent).toBe("frage");
    expect(r.reply).toMatch(/Braun und Schwarz/);
  });

  it("matches a single distinctive item word and stops at punctuation", () => {
    const wardrobe = [...items, { id: "c1", name: "Oliv Cargo-Hose", categoryName: "Cargo-Hosen", colors: [{ family: "oliv" }] }];
    const r = parseStylistMessage("Streetwear Look mit der Cargo-Hose, es ist kalt", wardrobe);
    expect(r.mustInclude).toEqual(["c1"]);
    expect(r.temperatureC).toBe(4);
    expect(parseStylistMessage("Outfit mit meiner weißen Jeans", items).mustInclude).toEqual(["j1"]);
  });

  it("does not invent item references", () => {
    const r = parseStylistMessage("Outfit mit meiner roten Lederjacke", items);
    expect(r.mustInclude).toEqual([]);
  });
});

describe("structured output schemas", () => {
  const walk = (node: unknown, visit: (n: Record<string, unknown>) => void) => {
    if (Array.isArray(node)) return node.forEach((x) => walk(x, visit));
    if (node && typeof node === "object") {
      visit(node as Record<string, unknown>);
      Object.values(node).forEach((v) => walk(v, visit));
    }
  };

  for (const [name, schema] of Object.entries({ garmentAnalysisSchema, explainSchema, stylistSchema })) {
    it(`${name} only uses supported JSON-schema features`, () => {
      const json = toStructuredSchema(schema);
      walk(json, (n) => {
        for (const bad of ["minimum", "maximum", "minLength", "maxLength", "$schema", "minItems", "maxItems"]) expect(n).not.toHaveProperty(bad);
        if (n.type === "object") expect(n.additionalProperties).toBe(false);
        expect(Array.isArray(n.type)).toBe(false);
      });
    });
  }

  it("rejects AI answers with unknown categories", () => {
    const bad = garmentAnalysisSchema.safeParse({ items: [{ categoryKey: "raumanzug" }], imageQuality: "gut", notes: null });
    expect(bad.success).toBe(false);
  });
});

describe("trends", () => {
  it("every trend has dated, linked sources", () => {
    for (const t of TRENDS) {
      expect(t.sources.length).toBeGreaterThan(0);
      for (const s of t.sources) expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it("matches items by attributes", () => {
    const maroon = TRENDS.find((t) => t.id === "moody-maroon")!;
    const base = { categoryKey: "sweater", name: "Pullover", subtype: null, tags: [], pattern: "uni", material: null, styles: [] };
    expect(trendItemScore(maroon, { ...base, colors: [{ family: "bordeaux" }] })).toBeGreaterThanOrEqual(maroon.threshold);
    expect(trendItemScore(maroon, { ...base, colors: [{ family: "gelb" }] })).toBeLessThan(maroon.threshold);
  });
});
