import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiError, type AiProvider } from "../server/ai/provider";
import type { ProviderFactory } from "../server/ai/service";
import type { GarmentAnalysis } from "../server/ai/schemas";
import { buildDeps, createApp } from "../server/app";
import { loadConfig, type AppConfig } from "../server/config";
import type { Category, ClothingItem, GeneratedOutfit } from "../shared/types";

type App = ReturnType<typeof createApp>;
const ORIGIN = "http://localhost";

function setup(opts: { ai?: AiProvider | null; aiFactory?: ProviderFactory; fetchImpl?: typeof fetch; cfg?: Partial<AppConfig> } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "styleai-test-"));
  const cfg = loadConfig({ dataDir: dir, serverAi: null, ...opts.cfg });
  const deps = buildDeps(cfg, { aiProvider: opts.ai ?? null, aiFactory: opts.aiFactory, fetchImpl: opts.fetchImpl });
  return { app: createApp(deps), deps, dir };
}

class Client {
  cookie = "";
  constructor(private app: App) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { origin: ORIGIN, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h["content-type"] = "application/json";
    }
    const res = await this.app.request(ORIGIN + url, { method, headers: h, body: payload });
    const set = res.headers.get("set-cookie");
    const m = set?.match(/styleai_session=([^;]*)/);
    if (m) this.cookie = m[1] ? `styleai_session=${m[1]}` : "";
    return res;
  }

  async json<T = any>(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
    const r = await this.req(method, url, body, headers);
    return { status: r.status, body: (await r.json()) as T };
  }
}

const png = (color: string, w = 220, h = 260) => sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();

function itemForm(image: Buffer, data: Record<string, unknown>, type = "image/png") {
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(image)], { type }), "item.png");
  fd.append("data", JSON.stringify(data));
  return fd;
}

async function register(app: App, email: string) {
  const c = new Client(app);
  const r = await c.json("POST", "/api/auth/register", { email, password: "sicheres-passwort-123", displayName: "Test" });
  expect(r.status).toBe(201);
  return c;
}

async function catId(c: Client, key: string) {
  const r = await c.json<{ categories: Category[] }>("GET", "/api/categories");
  return r.body.categories.find((x) => x.key === key)!.id;
}

async function addItem(c: Client, key: string, color: string, family: string, extra: Record<string, unknown> = {}) {
  const r = await c.json<{ item: ClothingItem }>(
    "POST",
    "/api/items",
    itemForm(await png(color), { categoryId: await catId(c, key), name: `${key} ${family}`, colors: [{ family, hex: color, ratio: 0.9 }], ...extra }),
  );
  expect(r.status).toBe(201);
  return r.body.item;
}

async function basicWardrobe(c: Client) {
  return {
    tee: await addItem(c, "tshirt", "#f7f7f4", "weiss"),
    jeans: await addItem(c, "jeans", "#4b6584", "jeansblau"),
    chinos: await addItem(c, "chinos", "#d6c1a1", "beige"),
    sneakers: await addItem(c, "sneakers", "#f7f7f4", "weiss"),
    jacket: await addItem(c, "jacket", "#151515", "schwarz"),
  };
}

describe("auth & sessions", () => {
  const { app } = setup();

  it("registers, reads the session and logs out", async () => {
    const c = await register(app, "anna@example.test");
    const me = await c.json("GET", "/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("anna@example.test");
    expect(me.body.user).not.toHaveProperty("password_hash");
    await c.json("POST", "/api/auth/logout");
    expect((await c.json("GET", "/api/auth/me")).status).toBe(401);
  });

  it("rejects duplicate e-mails, weak passwords and wrong credentials", async () => {
    await register(app, "ben@example.test");
    const c = new Client(app);
    expect((await c.json("POST", "/api/auth/register", { email: "BEN@example.test", password: "sicheres-passwort-123", displayName: "B" })).status).toBe(409);
    const weak = await c.json("POST", "/api/auth/register", { email: "x@example.test", password: "kurz", displayName: "X" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.message).toMatch(/10 Zeichen/);
    expect((await c.json("POST", "/api/auth/login", { email: "ben@example.test", password: "falsch-falsch" })).status).toBe(401);
    expect((await c.json("POST", "/api/auth/login", { email: "nobody@example.test", password: "falsch-falsch" })).status).toBe(401);
    expect((await c.json("POST", "/api/auth/login", { email: "ben@example.test", password: "sicheres-passwort-123" })).status).toBe(200);
  });

  it("protects all private endpoints", async () => {
    const c = new Client(app);
    for (const url of ["/api/items", "/api/outfits", "/api/preferences", "/api/categories", "/api/insights/stats", "/api/calendar?from=2026-01-01&to=2026-01-02"]) {
      expect((await c.json("GET", url)).status, url).toBe(401);
    }
  });

  it("blocks cross-origin writes", async () => {
    const c = await register(app, "csrf@example.test");
    const r = await c.json("PATCH", "/api/preferences", { boldness: 1 }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("CSRF");
  });
});

describe("wardrobe & images", () => {
  const { app, dir } = setup();
  let c: Client;
  beforeAll(async () => {
    c = await register(app, "carla@example.test");
  });

  it("uploads an item, serves the private image and strips metadata", async () => {
    const jpegWithExif = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#1d2741" } })
      .withExif({ IFD0: { Copyright: "Geheim", Artist: "Carla" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpegWithExif).metadata()).exif).toBeDefined();
    const r = await c.json<{ item: ClothingItem }>("POST", "/api/items", itemForm(jpegWithExif, { categoryId: await catId(c, "sweater"), name: "Navy Pullover" }, "image/jpeg"));
    expect(r.status).toBe(201);
    const img = await c.req("GET", r.body.item.imageUrl);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect((await c.req("GET", r.body.item.thumbUrl)).status).toBe(200);
  });

  it("validates file type, size and fields", async () => {
    const cat = await catId(c, "tshirt");
    const text = await c.json("POST", "/api/items", itemForm(Buffer.from("not an image at all, sorry"), { categoryId: cat, name: "X" }));
    expect(text.status).toBe(400);
    expect(text.body.error.code).toBe("IMAGE_INVALID");
    const big = await c.json("POST", "/api/items", itemForm(Buffer.alloc(13 * 1024 * 1024, 1), { categoryId: cat, name: "X" }));
    expect(big.status).toBe(413);
    const noName = await c.json("POST", "/api/items", itemForm(await png("#fff"), { categoryId: cat, name: "" }));
    expect(noName.status).toBe(400);
    const badCat = await c.json("POST", "/api/items", itemForm(await png("#fff"), { categoryId: "does-not-exist", name: "X" }));
    expect(badCat.status).toBe(404);
  });

  it("edits, moves to another category, changes status and deletes (incl. file)", async () => {
    const it = await addItem(c, "tshirt", "#c12c2c", "rot");
    const userId = (await c.json("GET", "/api/auth/me")).body.user.id;
    const before = readdirSync(path.join(dir, "uploads", userId)).length;
    const moved = await c.json<{ item: ClothingItem }>("PATCH", `/api/items/${it.id}`, { categoryId: await catId(c, "longsleeve"), status: "laundry", tags: ["Lieblingsteil"], brand: "Unbekannt GmbH" });
    expect(moved.status).toBe(200);
    expect(moved.body.item.status).toBe("laundry");
    expect(moved.body.item.tags).toEqual(["Lieblingsteil"]);
    expect((await c.json("DELETE", `/api/items/${it.id}`)).status).toBe(200);
    expect((await c.json("GET", `/api/items/${it.id}`)).status).toBe(404);
    expect(readdirSync(path.join(dir, "uploads", userId)).length).toBe(before - 2);
  });

  it("manages custom categories", async () => {
    const created = await c.json("POST", "/api/categories", { name: "Westen", group: "tops", slot: "top", layer: "mid", standalone: false });
    expect(created.status).toBe(201);
    expect((await c.json("POST", "/api/categories", { name: "Westen", group: "tops", slot: "top" })).status).toBe(409);
    const vest = await addItem(c, "tshirt", "#8a8a8e", "grau", { categoryId: created.body.category.id });
    expect((await c.json("DELETE", `/api/categories/${created.body.category.id}`)).status).toBe(409);
    await c.json("DELETE", `/api/items/${vest.id}`);
    expect((await c.json("DELETE", `/api/categories/${created.body.category.id}`)).status).toBe(200);
  });
});

describe("isolation between users", () => {
  const { app } = setup();
  let a: Client;
  let b: Client;
  let aItem: ClothingItem;
  let aOutfitId: string;
  beforeAll(async () => {
    a = await register(app, "a@example.test");
    b = await register(app, "b@example.test");
    const w = await basicWardrobe(a);
    aItem = w.tee;
    const o = await a.json("POST", "/api/outfits", { name: "A", items: [{ itemId: w.tee.id, role: "top" }, { itemId: w.jeans.id, role: "bottom" }] });
    aOutfitId = o.body.outfit.id;
  });

  it("hides other users' items, images and outfits", async () => {
    expect((await b.json("GET", `/api/items/${aItem.id}`)).status).toBe(404);
    expect((await b.req("GET", aItem.imageUrl)).status).toBe(404);
    expect((await b.json("PATCH", `/api/items/${aItem.id}`, { name: "hijack" })).status).toBe(404);
    expect((await b.json("DELETE", `/api/items/${aItem.id}`)).status).toBe(404);
    expect((await b.json("GET", `/api/outfits/${aOutfitId}`)).status).toBe(404);
    expect((await b.json("GET", "/api/items")).body.items).toEqual([]);
  });

  it("refuses foreign ids in outfits, feedback, calendar and generation", async () => {
    expect((await b.json("POST", "/api/outfits", { name: "x", items: [{ itemId: aItem.id, role: "top" }] })).status).toBe(404);
    expect((await b.json("POST", "/api/feedback", { kind: "like", itemIds: [aItem.id] })).status).toBe(404);
    expect((await b.json("POST", "/api/calendar", { date: "2026-10-27", outfitId: aOutfitId })).status).toBe(404);
    const gen = await b.json<{ outfits: GeneratedOutfit[]; diagnostics: string[] }>("POST", "/api/outfits/generate", { mustInclude: [aItem.id] });
    expect(gen.body.outfits).toEqual([]);
    const gen2 = await b.json<{ outfits: GeneratedOutfit[]; diagnostics: string[] }>("POST", "/api/outfits/generate", {});
    expect(gen2.body.outfits).toEqual([]);
    expect(gen2.body.diagnostics[0]).toMatch(/leer/);
  });
});

describe("outfits, feedback, calendar & stats", () => {
  const { app } = setup();
  let c: Client;
  let w: Awaited<ReturnType<typeof basicWardrobe>>;
  beforeAll(async () => {
    c = await register(app, "dora@example.test");
    w = await basicWardrobe(c);
  });

  it("generates outfits only from own, available items", async () => {
    await c.json("PATCH", `/api/items/${w.jeans.id}`, { status: "laundry" });
    const r = await c.json<{ outfits: GeneratedOutfit[]; aiUsed: boolean }>("POST", "/api/outfits/generate", { count: 3, weather: { tempC: 12, source: "manuell" } });
    expect(r.status).toBe(200);
    expect(r.body.aiUsed).toBe(false);
    expect(r.body.outfits.length).toBeGreaterThan(0);
    const own = new Set(Object.values(w).map((i) => i.id));
    for (const o of r.body.outfits) {
      for (const ref of o.items) expect(own.has(ref.itemId)).toBe(true);
      expect(o.items.map((x) => x.itemId)).not.toContain(w.jeans.id);
    }
    await c.json("PATCH", `/api/items/${w.jeans.id}`, { status: "available" });
  });

  it("swaps a single piece via the API", async () => {
    const gen = await c.json<{ outfits: GeneratedOutfit[] }>("POST", "/api/outfits/generate", { count: 1 });
    const o = gen.body.outfits[0];
    const bottom = o.items.find((i) => i.role === "bottom")!;
    const r = await c.json<{ options: { itemId: string | null; outfit: GeneratedOutfit }[] }>("POST", "/api/outfits/swap", { items: o.items, replaceItemId: bottom.itemId });
    expect(r.status).toBe(200);
    expect(r.body.options.length).toBeGreaterThan(0);
    expect(r.body.options[0].itemId).not.toBe(bottom.itemId);
  });

  it("saves, favours, plans, wears and counts", async () => {
    const save = await c.json("POST", "/api/outfits", {
      name: "Montag",
      items: [
        { itemId: w.tee.id, role: "top" },
        { itemId: w.chinos.id, role: "bottom" },
        { itemId: w.sneakers.id, role: "shoes" },
      ],
      score: 80,
      source: "generiert",
    });
    expect(save.status).toBe(201);
    const id = save.body.outfit.id;
    expect((await c.json("PATCH", `/api/outfits/${id}`, { favorite: true })).body.outfit.favorite).toBe(true);
    expect((await c.json("GET", "/api/outfits")).body.outfits.map((o: { id: string }) => o.id)).toContain(id);
    expect((await c.json("POST", "/api/feedback", { kind: "save", itemIds: [w.tee.id, w.chinos.id], outfitId: id })).status).toBe(201);

    const planned = await c.json("POST", "/api/calendar", { date: "2026-10-27", outfitId: id, status: "planned" });
    expect(planned.status).toBe(201);
    expect((await c.json("GET", `/api/items/${w.tee.id}`)).body.item.wearCount).toBe(0);
    await c.json("PATCH", `/api/calendar/${planned.body.entry.id}`, { status: "worn" });
    const tee = (await c.json("GET", `/api/items/${w.tee.id}`)).body;
    expect(tee.item.wearCount).toBe(1);
    expect(tee.wearHistory).toEqual(["2026-10-27"]);

    const cal = await c.json("GET", "/api/calendar?from=2026-10-20&to=2026-10-31");
    expect(cal.body.entries).toHaveLength(1);
    expect(cal.body.entries[0].outfit.name).toBe("Montag");

    const stats = await c.json("GET", "/api/insights/stats");
    expect(stats.body.stats.totalItems).toBe(5);
    expect(stats.body.stats.savedOutfits).toBe(1);

    const learned = await c.json("GET", "/api/preferences/learned");
    expect(learned.body.learned.eventCount).toBe(1);
    expect((await c.json("DELETE", "/api/preferences/learned")).status).toBe(200);
    expect((await c.json("GET", "/api/preferences/learned")).body.learned.eventCount).toBe(0);

    // Deleting an item marks saved outfits as incomplete.
    await c.json("DELETE", `/api/items/${w.sneakers.id}`);
    expect((await c.json("GET", `/api/outfits/${id}`)).body.outfit.missingItems).toBe(1);
  });

  it("serves trends with sources and a research date", async () => {
    const r = await c.json("GET", "/api/insights/trends");
    expect(r.body.meta.researchedAt).toBe("2026-10-27");
    expect(r.body.trends.length).toBeGreaterThan(5);
    const t = await c.json("POST", `/api/insights/trends/${r.body.trends[0].id}/outfits`, {});
    expect(t.status).toBe(200);
  });

  it("exports all user data as JSON", async () => {
    const r = await c.req("GET", "/api/account/export");
    expect(r.headers.get("content-disposition")).toMatch(/attachment/);
    const data = await r.json();
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0]).not.toHaveProperty("imageUrl");
    expect(JSON.stringify(data)).not.toContain("password");
  });
});

describe("AI integration", () => {
  const analysis: GarmentAnalysis = {
    items: [
      {
        categoryKey: "jacket",
        subtype: "Bomberjacke",
        name: "Olivgrüne Bomberjacke",
        pattern: "uni",
        colorNames: ["oliv", "oliv"],
        material: "Nylon",
        materialConfidence: "niedrig",
        fit: "normal",
        styles: ["streetwear", "casual"],
        seasons: ["herbst", "fruehling"],
        occasions: ["alltag"],
        formality: 9,
        warmth: 2.5,
        description: "Klassische Bomberjacke mit Rippbündchen.",
        brand: null,
        bbox: { x: -0.1, y: 0.1, w: 0.8, h: 0.8 },
        confidence: "hoch",
      },
    ],
    imageQuality: "gut",
    notes: null,
  };
  const usage = { model: "mock", inputTokens: 10, outputTokens: 20 };
  const mock = (over: Partial<AiProvider> = {}): AiProvider => ({
    id: "anthropic",
    name: "Mock-KI",
    testConnection: async () => ({ data: { ok: true }, usage }),
    visionModel: "mock-vision",
    textModel: "mock-text",
    analyzeGarments: async () => ({ data: analysis, usage }),
    explainOutfits: async () => ({
      data: {
        outfits: [
          { candidateId: "Z", title: "Erfunden", summary: "x", colorNotes: "", layeringNotes: "", accessoryNotes: "", weatherNotes: "", occasionNotes: "" },
          { candidateId: "B", title: "KI-Titel", summary: "KI-Begründung", colorNotes: "c", layeringNotes: "l", accessoryNotes: "a", weatherNotes: "w", occasionNotes: "o" },
        ],
      },
      usage,
    }),
    interpretStylistMessage: async () => ({
      data: {
        intent: "outfit",
        reply: "Alles klar.",
        styles: ["casual"],
        customStyle: null,
        occasion: "alltag",
        customOccasion: null,
        colors: [],
        mustIncludeItemIds: ["erfundene-id"],
        excludeItemIds: [],
        formality: 99,
        boldness: null,
        experimental: null,
        temperatureC: null,
        rain: null,
        count: 2,
      },
      usage,
    }),
    ...over,
  });

  it("reports missing configuration without failing the app", async () => {
    const { app } = setup({ ai: null });
    const c = await register(app, "noai@example.test");
    const caps = await c.json("GET", "/api/capabilities");
    expect(caps.body.ai.serverConfigured).toBe(false);
    expect((await c.json("GET", "/api/ai/settings")).body.active).toBeNull();
    const fd = new FormData();
    fd.append("image", new Blob([new Uint8Array(await png("#888"))], { type: "image/png" }), "a.png");
    const r = await c.json("POST", "/api/ai/analyze", fd);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("AI_UNAVAILABLE");
    await basicWardrobe(c);
    const gen = await c.json("POST", "/api/outfits/generate", { useAi: true });
    expect(gen.status).toBe(200);
    expect(gen.body.aiUsed).toBe(false);
    expect(gen.body.outfits[0].explanation.source).toBe("regelbasiert");
  });

  it("requires consent, then validates and normalises the analysis", async () => {
    const { app } = setup({ ai: mock() });
    const c = await register(app, "ai@example.test");
    const form = async () => {
      const fd = new FormData();
      fd.append("image", new Blob([new Uint8Array(await png("#5b5f35"))], { type: "image/png" }), "a.png");
      return fd;
    };
    expect((await c.json("POST", "/api/ai/analyze", await form())).body.error.code).toBe("AI_CONSENT_REQUIRED");
    await c.json("POST", "/api/account/ai-consent", { consent: true });
    const r = await c.json("POST", "/api/ai/analyze", await form());
    expect(r.status).toBe(200);
    const g = r.body.items[0];
    expect(g.categoryId).toBe(await catId(c, "jacket"));
    expect(g.material).toBeNull(); // low confidence is not stored
    expect(g.formality).toBe(5); // clamped
    expect(g.colorNames).toEqual(["oliv"]); // deduplicated
    expect(g.bbox.x).toBe(0);
  });

  it("uses AI explanations only for valid candidates and survives AI failures", async () => {
    const { app } = setup({ ai: mock() });
    const c = await register(app, "explain@example.test");
    await c.json("POST", "/api/account/ai-consent", { consent: true });
    await basicWardrobe(c);
    await addItem(c, "sweater", "#1d2741", "navy");
    const r = await c.json<{ outfits: GeneratedOutfit[]; aiUsed: boolean }>("POST", "/api/outfits/generate", { count: 2 });
    expect(r.body.aiUsed).toBe(true);
    expect(r.body.outfits).toHaveLength(2);
    expect(r.body.outfits[0].explanation.title).toBe("KI-Titel");
    expect(r.body.outfits[0].explanation.source).toBe("ki");
    expect(r.body.outfits[1].explanation.source).toBe("regelbasiert");
    expect(r.body.outfits.map((o) => o.explanation.title)).not.toContain("Erfunden");

    const failing = setup({ ai: mock({ explainOutfits: async () => Promise.reject(new AiError("AI_TIMEOUT", "Zeitüberschreitung", true)) }) });
    const d = await register(failing.app, "fail@example.test");
    await d.json("POST", "/api/account/ai-consent", { consent: true });
    await basicWardrobe(d);
    const f = await d.json("POST", "/api/outfits/generate", { count: 2 });
    expect(f.status).toBe(200);
    expect(f.body.outfits.length).toBeGreaterThan(0);
    expect(f.body.aiNotice).toMatch(/Zeitüberschreitung/);
  });

  it("drops invented item ids from the stylist and clamps values", async () => {
    const { app } = setup({ ai: mock() });
    const c = await register(app, "chat@example.test");
    await c.json("POST", "/api/account/ai-consent", { consent: true });
    await basicWardrobe(c);
    const r = await c.json("POST", "/api/stylist", { message: "Was ziehe ich heute an?" });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe("ki");
    expect(r.body.request.mustInclude).toEqual([]);
    expect(r.body.request.formality).toBe(5);
    expect(r.body.result.outfits.length).toBeGreaterThan(0);
  });

  it("enforces the daily image quota", async () => {
    const { app } = setup({ ai: mock(), cfg: { aiDailyImageLimit: 1 } });
    const c = await register(app, "quota@example.test");
    await c.json("POST", "/api/account/ai-consent", { consent: true });
    const form = async () => {
      const fd = new FormData();
      fd.append("image", new Blob([new Uint8Array(await png("#888"))], { type: "image/png" }), "a.png");
      return fd;
    };
    expect((await c.json("POST", "/api/ai/analyze", await form())).status).toBe(200);
    const second = await c.json("POST", "/api/ai/analyze", await form());
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("AI_LIMIT_REACHED");
  });

  it("stylist works locally without AI", async () => {
    const { app } = setup({ ai: null });
    const c = await register(app, "local@example.test");
    const w = await basicWardrobe(c);
    const r = await c.json("POST", "/api/stylist", { message: "Outfit fürs Restaurant mit der beige Chinos" });
    expect(r.body.mode).toBe("lokal");
    expect(r.body.request.occasion).toBe("restaurant");
    expect(r.body.request.mustInclude).toEqual([w.chinos.id]);
  });
});

describe("weather proxy", () => {
  const forecast = {
    current: { temperature_2m: 8.4, apparent_temperature: 5.9, precipitation: 0.2, weather_code: 61, wind_speed_10m: 22 },
    daily: {
      time: ["2026-10-27", "2026-10-28"],
      temperature_2m_max: [11, 13],
      temperature_2m_min: [4, 6],
      precipitation_probability_max: [70, 20],
      weather_code: [61, 3],
    },
  };

  it("parses Open-Meteo and rounds coordinates", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: URL | string) => {
      urls.push(String(u));
      return new Response(JSON.stringify(forecast), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const { app } = setup({ fetchImpl });
    const c = await register(app, "wetter@example.test");
    const r = await c.json("GET", "/api/insights/weather?lat=53.551086&lon=9.993682&name=Hamburg");
    expect(r.status).toBe(200);
    expect(r.body.weather.current.description).toBe("Regen");
    expect(r.body.weather.current.tempMinC).toBe(4);
    expect(r.body.weather.days).toHaveLength(2);
    expect(urls[0]).toContain("latitude=53.55");
    expect(urls[0]).not.toContain("53.551086");
  });

  it("fails gracefully when the weather service is down", async () => {
    const { app } = setup({ fetchImpl: (async () => Promise.reject(new Error("offline"))) as typeof fetch });
    const c = await register(app, "offline@example.test");
    const r = await c.json("GET", "/api/insights/weather?lat=50&lon=8");
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe("WEATHER_UNAVAILABLE");
  });
});

describe("account deletion", () => {
  it("removes the user, their data and their image folder", async () => {
    const { app, dir } = setup();
    const c = await register(app, "weg@example.test");
    const userId = (await c.json("GET", "/api/auth/me")).body.user.id;
    await addItem(c, "tshirt", "#ffffff", "weiss");
    expect(existsSync(path.join(dir, "uploads", userId))).toBe(true);
    expect((await c.json("DELETE", "/api/account", { password: "falsch" })).status).toBe(403);
    expect((await c.json("DELETE", "/api/account", { password: "sicheres-passwort-123" })).status).toBe(200);
    expect(existsSync(path.join(dir, "uploads", userId))).toBe(false);
    expect((await c.json("GET", "/api/auth/me")).status).toBe(401);
    const again = new Client(app);
    expect((await again.json("POST", "/api/auth/login", { email: "weg@example.test", password: "sicheres-passwort-123" })).status).toBe(401);
  });
});

afterAll(() => {
  /* temp dirs are left to the OS temp cleaner; they contain only synthetic test images */
});

describe("AI provider settings", () => {
  const usage = { model: "fake", inputTokens: 1, outputTokens: 1 };
  const fakeProvider = (id: AiProvider["id"], name: string, seen: { apiKey?: string }[] = [], s?: { apiKey: string }): AiProvider => {
    if (s) seen.push({ apiKey: s.apiKey });
    return {
      id,
      name,
      visionModel: `${id}-vision`,
      textModel: `${id}-text`,
      analyzeGarments: async () => Promise.reject(new Error("unused")),
      explainOutfits: async () => Promise.reject(new AiError("AI_TIMEOUT", "egal", true)),
      interpretStylistMessage: async () => Promise.reject(new Error("unused")),
      testConnection: async () => ({ data: { ok: true }, usage }),
    };
  };

  it("stores an own key encrypted, never returns it and uses it", async () => {
    const seen: { apiKey?: string }[] = [];
    const { app, deps } = setup({ aiFactory: (s) => fakeProvider(s.provider, `Fake ${s.provider}`, seen, s) });
    const c = await register(app, "byok@example.test");
    expect((await c.json("GET", "/api/ai/settings")).body.active).toBeNull();

    const noConsent = await c.json("PUT", "/api/ai/settings", { provider: "groq", apiKey: "gsk_geheim_ABCD1234" });
    expect(noConsent.status).toBe(400);

    const saved = await c.json("PUT", "/api/ai/settings", { provider: "groq", apiKey: "gsk_geheim_ABCD1234", consent: true });
    expect(saved.status).toBe(200);
    expect(saved.body.own.providerId).toBe("groq");
    expect(saved.body.own.keyHint).toBe("gsk…1234");
    expect(saved.body.active.source).toBe("user");
    expect(saved.body.consent).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain("geheim");

    const row = deps.db.prepare("SELECT api_key_enc FROM user_ai_settings").get() as { api_key_enc: string };
    expect(row.api_key_enc).not.toContain("geheim");

    const test = await c.json("POST", "/api/ai/test");
    expect(test.status).toBe(200);
    expect(test.body.provider).toBe("Fake groq");
    expect(seen.at(-1)?.apiKey).toBe("gsk_geheim_ABCD1234");

    // Switching the model keeps the stored key when no new key is sent.
    const kept = await c.json("PUT", "/api/ai/settings", { provider: "groq", apiKey: null, textModel: "openai/gpt-oss-20b", consent: true });
    expect(kept.status).toBe(200);
    expect(kept.body.own.textModel).toBe("openai/gpt-oss-20b");
    // A different provider needs its own key.
    const other = await c.json("PUT", "/api/ai/settings", { provider: "gemini", apiKey: null, consent: true });
    expect(other.status).toBe(400);
  });

  it("isolates settings per user and falls back to the server key", async () => {
    const { app } = setup({ ai: fakeProvider("anthropic", "Server-KI"), aiFactory: (s) => fakeProvider(s.provider, `Fake ${s.provider}`) });
    const a = await register(app, "a-byok@example.test");
    const b = await register(app, "b-byok@example.test");
    await a.json("PUT", "/api/ai/settings", { provider: "gemini", apiKey: "AIza_a_key_9999", consent: true });
    const bStatus = (await b.json("GET", "/api/ai/settings")).body;
    expect(bStatus.own).toBeNull();
    expect(bStatus.active.source).toBe("server");
    expect(bStatus.active.provider).toBe("Server-KI");
    const removed = await a.json("DELETE", "/api/ai/settings");
    expect(removed.body.own).toBeNull();
    expect(removed.body.active.provider).toBe("Server-KI");
  });

  it("keeps working with an own provider that fails", async () => {
    const { app } = setup({ aiFactory: (s) => fakeProvider(s.provider, "Kaputt") });
    const c = await register(app, "fails@example.test");
    await c.json("PUT", "/api/ai/settings", { provider: "groq", apiKey: "gsk_x_0000", consent: true });
    await basicWardrobe(c);
    const r = await c.json("POST", "/api/outfits/generate", { count: 2 });
    expect(r.status).toBe(200);
    expect(r.body.outfits.length).toBeGreaterThan(0);
    expect(r.body.aiNotice).toMatch(/egal/);
  });

  it("only allows custom endpoints when enabled, and only safe URLs", async () => {
    const off = setup({ aiFactory: (s) => fakeProvider(s.provider, "x") });
    const c1 = await register(off.app, "custom-off@example.test");
    expect((await c1.json("GET", "/api/ai/settings")).body.providers.map((p: { id: string }) => p.id)).not.toContain("openai_compatible");
    expect((await c1.json("PUT", "/api/ai/settings", { provider: "openai_compatible", baseUrl: "https://api.example.com/v1", visionModel: "m", consent: true })).status).toBe(403);

    const on = setup({ aiFactory: (s) => fakeProvider(s.provider, "x"), cfg: { allowCustomAiBaseUrl: true } });
    const c2 = await register(on.app, "custom-on@example.test");
    const insecure = await c2.json("PUT", "/api/ai/settings", { provider: "openai_compatible", baseUrl: "http://192.168.0.5/v1", visionModel: "m", textModel: "m", consent: true });
    expect(insecure.status).toBe(400);
    const noModel = await c2.json("PUT", "/api/ai/settings", { provider: "openai_compatible", baseUrl: "https://api.example.com/v1", consent: true });
    expect(noModel.status).toBe(400);
    const local = await c2.json("PUT", "/api/ai/settings", { provider: "openai_compatible", baseUrl: "http://localhost:1234/v1", visionModel: "qwen-vl", textModel: "qwen-vl", consent: true });
    expect(local.status).toBe(200);
    expect(local.body.own.keyHint).toBe("ohne Schlüssel");
    expect(local.body.own.baseUrl).toBe("http://localhost:1234/v1");
  });
});

describe("invite code for public deployments", () => {
  it("lets only people with the code create an account", async () => {
    const { app } = setup({ cfg: { registrationCode: "geheimer-code-42" } });
    const caps = await app.request(ORIGIN + "/api/capabilities");
    expect((await caps.json()).registration.codeRequired).toBe(true);
    const c = new Client(app);
    const body = { email: "invite@example.test", password: "sicheres-passwort-123", displayName: "Gast" };
    const missing = await c.json("POST", "/api/auth/register", body);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("INVITE_REQUIRED");
    const wrong = await c.json("POST", "/api/auth/register", { ...body, code: "falsch" });
    expect(wrong.body.error.code).toBe("INVITE_INVALID");
    const ok = await c.json("POST", "/api/auth/register", { ...body, code: "geheimer-code-42" });
    expect(ok.status).toBe(201);
    // Without a configured code registration stays open.
    const open = setup();
    expect((await (await open.app.request(ORIGIN + "/api/capabilities")).json()).registration.codeRequired).toBe(false);
    expect((await new Client(open.app).json("POST", "/api/auth/register", body)).status).toBe(201);
  });
});