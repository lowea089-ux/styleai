// Browser edition: the server code on sql.js with the IndexedDB contract (memory store), the node:crypto
// stand-in and the ZIP backup. Image encoding uses sharp here; OffscreenCanvas only exists in browsers.
import * as nodeCrypto from "node:crypto";
import { unzipSync } from "fflate";
import sharp from "sharp";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { tx } from "../server/migrations";
import type { Category, ClothingItem, GeneratedOutfit } from "../shared/types";
import { BackupError, createBackup, restoreBackup } from "../web/backup";
import { createRuntime, handle, LOCAL_EMAIL, type Runtime } from "../web/runtime";
import * as shim from "../web/shims/crypto";
import { SqlJsDatabase } from "../web/sqljs-db";
import { memoryStore, type LocalStore } from "../web/store";

vi.mock("../server/tryon", () => import("../web/server/tryon"));

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

async function call<T = any>(rt: Runtime, method: string, url: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await handle(rt, new Request(`http://localhost${url}`, init));
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, body: (ct.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer())) as T };
}

const png = (color: string) => sharp({ create: { width: 200, height: 240, channels: 4, background: color } }).png().toBuffer();

async function addItem(rt: Runtime, key: string, color: string, family: string) {
  const cats = await call<{ categories: Category[] }>(rt, "GET", "/api/categories");
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(await png(color))], { type: "image/png" }), "item.png");
  fd.append("data", JSON.stringify({ categoryId: cats.body.categories.find((c) => c.key === key)!.id, name: `${key} ${family}`, colors: [{ family, hex: color, ratio: 0.9 }] }));
  const r = await call<{ item: ClothingItem }>(rt, "POST", "/api/items", fd);
  expect(r.status).toBe(201);
  return r.body.item;
}

describe("sql.js facade", () => {
  it("behaves like node:sqlite for get/all/run, parameters and transactions", () => {
    const db = new SqlJsDatabase(new SQL.Database());
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, flag INTEGER, note TEXT)");
    const ins = db.prepare("INSERT INTO t (name, flag, note) VALUES (?, ?, ?)");
    expect(ins.run("a", true, undefined).changes).toBe(1);
    ins.run("b", false, "x");
    expect(db.prepare("SELECT * FROM t WHERE name = ?").get("a")).toEqual({ id: 1, name: "a", flag: 1, note: null });
    expect(db.prepare("SELECT * FROM t WHERE name = ?").get("zzz")).toBeUndefined();
    expect(db.prepare("SELECT name FROM t ORDER BY id").all()).toEqual([{ name: "a" }, { name: "b" }]);
    expect(db.prepare("UPDATE t SET note = 'y'").run().changes).toBe(2);
    expect(db.prepare("DELETE FROM t WHERE id = 99").run().changes).toBe(0);

    expect(() =>
      tx(db, () => {
        ins.run("c", 0, null);
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(db.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });

    // Statements survive export (sql.js frees them) and foreign keys stay on.
    const count = db.prepare("SELECT count(*) AS n FROM t");
    expect(db.dirty).toBe(true);
    const bytes = db.export();
    expect(db.dirty).toBe(false);
    expect(count.get()).toEqual({ n: 2 });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(new SqlJsDatabase(new SQL.Database(bytes)).prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
  });
});

describe("node:crypto stand-in", () => {
  it("matches Node for SHA-256, AES-256-GCM and scrypt", async () => {
    expect(shim.createHash("sha256").update("StyleAI").digest("hex")).toBe(nodeCrypto.createHash("sha256").update("StyleAI").digest("hex"));
    const key = nodeCrypto.randomBytes(32);
    const iv = nodeCrypto.randomBytes(12);

    const c = shim.createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([c.update("geheimer-schlüssel", "utf8"), c.final()]);
    const d = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(c.getAuthTag());
    expect(Buffer.concat([d.update(data), d.final()]).toString("utf8")).toBe("geheimer-schlüssel");

    const nc = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
    const nd = Buffer.concat([nc.update("zurück", "utf8"), nc.final()]);
    const sd = shim.createDecipheriv("aes-256-gcm", key, iv);
    sd.setAuthTag(nc.getAuthTag());
    expect(Buffer.concat([sd.update(nd), sd.final()]).toString("utf8")).toBe("zurück");
    const bad = shim.createDecipheriv("aes-256-gcm", key, iv);
    bad.setAuthTag(Buffer.alloc(16));
    bad.update(nd);
    expect(() => bad.final()).toThrow();

    const salt = nodeCrypto.randomBytes(16);
    const opts = { N: 1024, r: 8, p: 1 };
    const fromShim = await new Promise<Buffer>((res, rej) => shim.scrypt("pw", salt, 32, opts, (e, k) => (e ? rej(e) : res(k))));
    expect(fromShim.equals(nodeCrypto.scryptSync("pw", salt, 32, opts))).toBe(true);
    expect(shim.timingSafeEqual(Buffer.from("ab"), Buffer.from("ab"))).toBe(true);
    expect(shim.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("browser edition runtime", () => {
  let store: LocalStore;
  let rt: Runtime;

  beforeAll(async () => {
    store = memoryStore();
    rt = await createRuntime(SQL, store);
  });

  it("serves one local person without sign-in", async () => {
    const me = await call(rt, "GET", "/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(LOCAL_EMAIL);
    expect((await call(rt, "GET", "/api/capabilities")).body.local).toBe(true);
    expect((await call(rt, "GET", "/api/auth/me")).body.user.id).toBe(me.body.user.id);
    // There is no password, so signing in is impossible.
    expect((await call(rt, "POST", "/api/auth/login", { email: LOCAL_EMAIL, password: "local" })).status).toBe(401);
  });

  it("stores items and photos, generates outfits and keeps everything after a restart", async () => {
    const tee = await addItem(rt, "tshirt", "#f7f7f4", "weiss");
    await addItem(rt, "jeans", "#4b6584", "jeansblau");
    await addItem(rt, "sneakers", "#f7f7f4", "weiss");
    expect(await store.images.keys()).toHaveLength(6);

    const img = await call<Uint8Array>(rt, "GET", new URL(tee.imageUrl, "http://localhost").pathname);
    expect(img.status).toBe(200);
    expect((await sharp(Buffer.from(img.body)).metadata()).format).toBe("webp");

    const gen = await call<{ outfits: GeneratedOutfit[] }>(rt, "POST", "/api/outfits/generate", { count: 2, weather: { tempC: 18, source: "manuell" } });
    expect(gen.status).toBe(200);
    expect(gen.body.outfits.length).toBeGreaterThan(0);
    expect((await call(rt, "PATCH", "/api/preferences", { onboardingCompleted: true })).status).toBe(200);

    // Every change is written to the store; a new service worker instance sees the same data.
    const again = await createRuntime(SQL, store);
    expect((await call(again, "GET", "/api/items")).body.items).toHaveLength(3);
    expect((await call(again, "GET", "/api/preferences")).body.preferences.onboardingCompleted).toBe(true);
    again.close();
  });

  it("backs up without API keys and restores into a fresh browser", async () => {
    const saved = await call(rt, "PUT", "/api/tryon/settings", { apiKey: "dk_test_1234567890", maxSessionSeconds: 60, consent: true });
    expect(saved.body.keyHint).toBe("dk_…7890");
    const { zip, items } = await createBackup(rt);
    expect(items).toBe(3);
    const files = unzipSync(zip);
    expect(Object.keys(files).filter((f) => f.startsWith("images/"))).toHaveLength(6);
    expect(JSON.parse(new TextDecoder().decode(files["styleai-backup.json"])).apiKeysIncluded).toBe(false);
    const raw = new SQL.Database(files["styleai.db"]);
    expect(raw.exec("SELECT api_key_enc FROM user_tryon_settings")[0].values).toEqual([[null]]);
    raw.close();

    const fresh = await createRuntime(SQL, memoryStore());
    await expect(restoreBackup(fresh, new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(BackupError);
    const result = await restoreBackup(fresh, zip);
    expect(result).toEqual({ items: 3, images: 6 });
    fresh.close();
    const restored = await createRuntime(SQL, fresh.store);
    const list = await call<{ items: ClothingItem[] }>(restored, "GET", "/api/items");
    expect(list.body.items).toHaveLength(3);
    expect((await call(restored, "GET", new URL(list.body.items[0].thumbUrl, "http://localhost").pathname)).status).toBe(200);
    const status = await call(restored, "GET", "/api/tryon/status");
    expect(status.body.available).toBe(false);
    expect((await call(restored, "GET", "/api/auth/me")).body.user.email).toBe(LOCAL_EMAIL);
    restored.close();
  });

  it("deletes all data without a password and starts over", async () => {
    const before = (await call(rt, "GET", "/api/auth/me")).body.user.id;
    expect((await call(rt, "DELETE", "/api/account")).status).toBe(200);
    expect(await store.images.keys()).toHaveLength(0);
    const after = await call(rt, "GET", "/api/auth/me");
    expect(after.body.user.id).not.toBe(before);
    expect((await call(rt, "GET", "/api/items")).body.items).toHaveLength(0);
    expect((await call(rt, "GET", "/api/preferences")).body.preferences.onboardingCompleted).toBe(false);
  });
});
