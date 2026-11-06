import { Hono } from "hono";
import { z } from "zod";
import {
  calendarInputSchema,
  calendarPatchSchema,
  feedbackSchema,
  generateRequestSchema,
  outfitInputSchema,
  outfitPatchSchema,
  scoreRequestSchema,
  stylistMessageSchema,
  swapRequestSchema,
  weatherSchema,
} from "../../shared/schemas";
import { HttpError, readJson, type AppEnv, type Deps } from "../http";
import * as repo from "../repo";
import { computeStats } from "../stats";
import { WeatherError } from "../weather";

export function outfitRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.post("/generate", async (c) => {
    const req = await readJson(c, generateRequestSchema);
    return c.json(await deps.outfits.generate(c.get("user"), req));
  });

  app.post("/swap", async (c) => {
    const body = await readJson(c, swapRequestSchema);
    return c.json({ options: deps.outfits.swap(c.get("user").id, body.items, body.replaceItemId, body.request) });
  });

  app.post("/score", async (c) => {
    const body = await readJson(c, scoreRequestSchema);
    const outfit = deps.outfits.rescore(c.get("user").id, body.items, body.request);
    if (!outfit) throw new HttpError(404, "NOT_FOUND", "Keines der Kleidungsstücke existiert.");
    return c.json({ outfit });
  });

  app.get("/", (c) => c.json({ outfits: repo.listOutfits(deps.db, c.get("user").id, { savedOnly: c.req.query("all") !== "1" }) }));

  app.post("/", async (c) => {
    const input = await readJson(c, outfitInputSchema);
    return c.json({ outfit: repo.createOutfit(deps.db, c.get("user").id, input) }, 201);
  });

  app.get("/:id", (c) => {
    const o = repo.getOutfit(deps.db, c.get("user").id, c.req.param("id"));
    if (!o) throw new HttpError(404, "NOT_FOUND", "Outfit nicht gefunden.");
    return c.json({ outfit: o });
  });

  app.patch("/:id", async (c) => {
    const patch = await readJson(c, outfitPatchSchema);
    return c.json({ outfit: repo.updateOutfit(deps.db, c.get("user").id, c.req.param("id"), patch) });
  });

  app.delete("/:id", (c) => {
    repo.deleteOutfit(deps.db, c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}

export function feedbackRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.post("/", async (c) => {
    repo.addFeedback(deps.db, c.get("user").id, await readJson(c, feedbackSchema));
    return c.json({ ok: true }, 201);
  });
  return app;
}

export function stylistRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.post("/", async (c) => {
    const body = await readJson(c, stylistMessageSchema);
    return c.json(await deps.outfits.stylist(c.get("user"), body.message, body.weather, body.useAi));
  });
  return app;
}

export function calendarRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  app.get("/", (c) => {
    const from = date.parse(c.req.query("from"));
    const to = date.parse(c.req.query("to"));
    return c.json({ entries: repo.listCalendar(deps.db, c.get("user").id, from, to) });
  });
  app.post("/", async (c) => c.json({ entry: repo.addCalendarEntry(deps.db, c.get("user").id, await readJson(c, calendarInputSchema)) }, 201));
  app.patch("/:id", async (c) => c.json({ entry: repo.updateCalendarEntry(deps.db, c.get("user").id, c.req.param("id"), await readJson(c, calendarPatchSchema)) }));
  app.delete("/:id", (c) => {
    repo.deleteCalendarEntry(deps.db, c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });
  return app;
}

export function insightRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/stats", (c) => {
    const uid = c.get("user").id;
    return c.json({ stats: computeStats(deps.db, uid, repo.listItems(deps.db, uid), repo.listCategories(deps.db, uid)) });
  });

  app.get("/trends", (c) => c.json(deps.outfits.trends(c.get("user").id)));

  app.post("/trends/:id/outfits", async (c) => {
    const { weather } = await readJson(c, z.object({ weather: weatherSchema.nullable().default(null) }));
    const res = await deps.outfits.trendOutfits(c.get("user"), c.req.param("id"), weather);
    if (!res) throw new HttpError(404, "NOT_FOUND", "Trend nicht gefunden.");
    return c.json(res);
  });

  app.get("/weather", async (c) => {
    const q = z
      .object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180), name: z.string().max(120).optional() })
      .parse(c.req.query());
    try {
      return c.json({ weather: await deps.weather.forecast(q.lat, q.lon, q.name ?? null) });
    } catch (e) {
      if (e instanceof WeatherError) throw new HttpError(502, "WEATHER_UNAVAILABLE", e.message);
      throw e;
    }
  });

  app.get("/weather/geocode", async (c) => {
    const q = z.string().trim().min(2).max(100).parse(c.req.query("q"));
    try {
      return c.json({ results: await deps.weather.geocode(q) });
    } catch (e) {
      if (e instanceof WeatherError) throw new HttpError(502, "WEATHER_UNAVAILABLE", e.message);
      throw e;
    }
  });

  return app;
}
