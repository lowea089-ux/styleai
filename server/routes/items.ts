import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { itemInputSchema, itemPatchSchema } from "../../shared/schemas";
import { BgRemovalError, removeBackgroundRemote } from "../bg";
import { HttpError, readImage, readJson, type AppEnv, type Deps } from "../http";
import { processGarmentImage, validateForForwarding } from "../images";
import * as repo from "../repo";

const today = () => new Date().toISOString().slice(0, 10);

export function itemRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const uid = (c: { get: (k: "user") => repo.UserRow }) => c.get("user").id;

  app.get("/", (c) => c.json({ items: repo.listItems(deps.db, uid(c)) }));

  app.get("/:id", (c) => {
    const item = repo.getItem(deps.db, uid(c), c.req.param("id"));
    if (!item) throw new HttpError(404, "NOT_FOUND", "Kleidungsstück nicht gefunden.");
    return c.json({ item, wearHistory: repo.itemWearHistory(deps.db, uid(c), item.id) });
  });

  app.post("/", async (c) => {
    const { buf, form } = await readImage(c);
    let data: unknown;
    try {
      data = JSON.parse(String(form.data ?? "{}"));
    } catch {
      throw new HttpError(400, "BAD_JSON", "Die Angaben zum Kleidungsstück sind ungültig.");
    }
    const input = itemInputSchema.parse(data);
    const { main, thumb } = await processGarmentImage(buf, deps.cfg.maxUploadBytes);
    const id = randomUUID();
    const paths = await deps.images.save(uid(c), id, main, thumb);
    try {
      return c.json({ item: repo.createItem(deps.db, uid(c), input, paths, id) }, 201);
    } catch (e) {
      await deps.images.remove(paths.image, paths.thumb);
      throw e;
    }
  });

  app.patch("/:id", async (c) => {
    const patch = await readJson(c, itemPatchSchema);
    return c.json({ item: repo.updateItem(deps.db, uid(c), c.req.param("id"), patch) });
  });

  app.put("/:id/image", async (c) => {
    const id = c.req.param("id");
    const old = repo.getItemPaths(deps.db, uid(c), id);
    if (!old) throw new HttpError(404, "NOT_FOUND", "Kleidungsstück nicht gefunden.");
    const { buf } = await readImage(c);
    const { main, thumb } = await processGarmentImage(buf, deps.cfg.maxUploadBytes);
    const paths = await deps.images.save(uid(c), id, main, thumb);
    const item = repo.updateItem(deps.db, uid(c), id, {}, paths);
    await deps.images.remove(old.image_path, old.thumb_path);
    return c.json({ item });
  });

  app.delete("/:id", async (c) => {
    const paths = repo.deleteItem(deps.db, uid(c), c.req.param("id"));
    await deps.images.remove(paths.image_path, paths.thumb_path);
    return c.json({ ok: true });
  });

  app.post("/delete-all", async (c) => {
    await readJson(c, z.object({ confirm: z.literal(true) }));
    const all = repo.allImagePaths(deps.db, uid(c));
    for (const p of all) {
      repo.deleteItem(deps.db, uid(c), p.id);
      await deps.images.remove(p.image_path, p.thumb_path);
    }
    return c.json({ ok: true, deleted: all.length });
  });

  app.post("/:id/worn", async (c) => {
    const { date } = await readJson(c, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(today()) }));
    repo.logItemWear(deps.db, uid(c), c.req.param("id"), date);
    return c.json({ item: repo.getItem(deps.db, uid(c), c.req.param("id")) });
  });

  return app;
}

export function imageRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/:id/:variant{main|thumb}", async (c) => {
    const paths = repo.getItemPaths(deps.db, c.get("user").id, c.req.param("id"));
    if (!paths) return c.json({ error: { code: "NOT_FOUND", message: "Bild nicht gefunden." } }, 404);
    const file = await deps.images.read(c.req.param("variant") === "thumb" ? paths.thumb_path : paths.image_path).catch(() => null);
    if (!file) return c.json({ error: { code: "NOT_FOUND", message: "Bilddatei fehlt." } }, 404);
    return c.body(new Uint8Array(file), 200, {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.post("/remove-background", async (c) => {
    const { buf } = await readImage(c);
    const jpeg = await validateForForwarding(buf, deps.cfg.maxUploadBytes);
    try {
      const png = await removeBackgroundRemote(deps.cfg, jpeg, deps.fetchImpl);
      return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    } catch (e) {
      if (e instanceof BgRemovalError) {
        const status = e.code === "BG_UNAVAILABLE" ? 503 : e.code === "BG_RATE_LIMIT" ? 429 : 502;
        throw new HttpError(status, e.code, e.message);
      }
      throw e;
    }
  });

  return app;
}
