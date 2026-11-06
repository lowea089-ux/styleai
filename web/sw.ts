/// <reference lib="webworker" />
// Service worker of the browser edition. It is the "server": answers /api/* with the StyleAI app running on
// sql.js + IndexedDB, and keeps the app files in Cache Storage so StyleAI opens without internet.
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { BackupError, createBackup, restoreBackup } from "./backup";
import { createRuntime, handle, type Runtime } from "./runtime";
import { openIdbStore } from "./store";

declare const self: ServiceWorkerGlobalScope;
/** Injected by scripts/build-web.mjs. */
declare const __BUILD_ID__: string;
declare const __PRECACHE__: string[];
declare const __RUNTIME__: string[];

const SCOPE = new URL(self.registration.scope).pathname; // e.g. "/styleai/"
const CACHE = `styleai-app-${__BUILD_ID__}`;
const RUNTIME_CACHE = "styleai-runtime";
const SQL_WASM = `${SCOPE}sql-wasm.wasm`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const errorJson = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

// ---------------------------------------------------------------------------------------------------------
// App files (offline)

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(__PRECACHE__.map((p) => SCOPE + p));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("styleai-app-") && key !== CACHE) await caches.delete(key);
      // Large files are cached on first use; drop versions that the current build no longer references.
      const runtime = await caches.open(RUNTIME_CACHE);
      const wanted = new Set(__RUNTIME__.map((p) => new URL(SCOPE + p, self.location.origin).href));
      for (const req of await runtime.keys()) if (!wanted.has(req.url)) await runtime.delete(req);
      await self.clients.claim();
    })(),
  );
});

// A page that was opened with a hard reload is not controlled; it asks to be taken over.
self.addEventListener("message", (event) => {
  if (event.data === "claim") event.waitUntil(self.clients.claim());
});

async function fromCache(req: Request): Promise<Response> {
  // ignoreVary: module scripts carry an Origin header the cached copy was fetched without.
  const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  const path = new URL(req.url).pathname.slice(SCOPE.length);
  if (res.ok && __RUNTIME__.includes(path)) {
    const copy = res.clone();
    caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
  }
  return res;
}

async function appShell(req: Request): Promise<Response> {
  const shell = await caches.match(`${SCOPE}index.html`, { ignoreVary: true });
  if (shell) return shell;
  try {
    return await fetch(req);
  } catch {
    return new Response("<!doctype html><meta charset=utf-8><title>StyleAI</title><p>StyleAI ist offline noch nicht verfügbar. Bitte einmal mit Internet öffnen.</p>", {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// The local "server"

let sql: Promise<SqlJsStatic> | null = null;
let runtime: Promise<Runtime> | null = null;

function loadSql() {
  sql ??= (async () => {
    // The worker's own fetches bypass its fetch handler, so read the WASM from the cache first (offline).
    const res = (await caches.match(SQL_WASM, { ignoreVary: true })) ?? (await fetch(SQL_WASM));
    if (!res.ok) throw new Error("SQLite (WASM) konnte nicht geladen werden.");
    return initSqlJs({ wasmBinary: await res.arrayBuffer() });
  })().catch((e) => {
    sql = null;
    throw e;
  });
  return sql;
}

function getRuntime() {
  runtime ??= (async () => createRuntime(await loadSql(), await openIdbStore()))().catch((e) => {
    runtime = null;
    throw e;
  });
  return runtime;
}

async function api(req: Request, path: string): Promise<Response> {
  let rt: Runtime;
  try {
    rt = await getRuntime();
  } catch (e) {
    return errorJson(503, "LOCAL_DB_UNAVAILABLE", `Die Daten in diesem Browser konnten nicht geöffnet werden (${(e as Error).message}). Privates Fenster? Dort ist der Speicher gesperrt.`);
  }

  if (path === "/api/local/backup" && req.method === "GET") {
    const { zip } = await createBackup(rt);
    const name = `styleai-sicherung-${new Date().toISOString().slice(0, 10)}.zip`;
    return new Response(zip as Uint8Array<ArrayBuffer>, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  }
  if (path === "/api/local/restore" && req.method === "POST") {
    try {
      const result = await restoreBackup(rt, new Uint8Array(await req.arrayBuffer()));
      // Start over from the restored data.
      runtime = null;
      rt.close();
      return json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof BackupError) return errorJson(400, "BACKUP_INVALID", e.message);
      return errorJson(500, "BACKUP_FAILED", "Die Sicherung konnte nicht wiederhergestellt werden. Deine bisherigen Daten sind unverändert.");
    }
  }
  return handle(rt, req);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // AI providers, weather, Decart: straight to the network

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith(`${SCOPE}api/`)) {
    // Only the app's own fetches reach the local server – never a navigation (e.g. a form on a foreign page).
    if (req.mode === "navigate") {
      event.respondWith(Response.redirect(SCOPE, 303));
      return;
    }
    const path = url.pathname.startsWith("/api/") ? url.pathname : url.pathname.slice(SCOPE.length - 1);
    event.respondWith(
      (async () => {
        if (path === url.pathname) return api(req, path);
        const init: RequestInit = { method: req.method, headers: req.headers };
        if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
        return api(new Request(new URL(path + url.search, url.origin), init), path);
      })(),
    );
    return;
  }

  if (req.method !== "GET" || !url.pathname.startsWith(SCOPE)) return;
  if (req.mode === "navigate") {
    event.respondWith(appShell(req));
    return;
  }
  event.respondWith(fromCache(req));
});
