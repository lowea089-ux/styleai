// The whole StyleAI server (Hono app, repo, AI, outfit engine) running inside the browser: sql.js as the
// database, IndexedDB as the disk. Used by the service worker and by the Node tests.
import type { SqlJsStatic } from "sql.js";
import { buildDeps, createApp } from "../server/app";
import type { DB } from "../server/db";
import { log } from "../server/log";
import { migrate } from "../server/migrations";
import * as repo from "../server/repo";
import { webConfig } from "./config";
import { ImageStore } from "./server/images";
import { SqlJsDatabase } from "./sqljs-db";
import type { LocalStore } from "./store";

/** The single person of this browser. Not a real address; there is no sign-in. */
export const LOCAL_EMAIL = "ich@styleai.local";

export interface Runtime {
  app: { fetch(req: Request): Response | Promise<Response> };
  db: SqlJsDatabase;
  SQL: SqlJsStatic;
  store: LocalStore;
  /** Writes the database file to IndexedDB if anything changed. */
  persist(): Promise<void>;
  close(): void;
}

export async function createRuntime(SQL: SqlJsStatic, store: LocalStore): Promise<Runtime> {
  log.setSilent(true);
  const db = new SqlJsDatabase(new SQL.Database(await store.getDb()));
  migrate(db);

  let secret = await store.getSecret();
  if (!secret || secret.length !== 32) {
    secret = crypto.getRandomValues(new Uint8Array(32));
    await store.putSecret(secret);
  }
  const deps = buildDeps(webConfig(secret), { db: db as unknown as DB, aiProvider: null });
  deps.images = new ImageStore(store.images) as unknown as typeof deps.images;
  let userId: string | null = null;
  deps.localUser = () => {
    const known = userId ? repo.getUser(deps.db, userId) : undefined;
    const first = known ?? (db.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get() as { id: string } | undefined);
    const user = known ?? (first ? repo.getUser(deps.db, first.id) : undefined) ?? repo.createUser(deps.db, LOCAL_EMAIL, "local", "");
    userId = user.id;
    return user;
  };
  const app = createApp(deps);

  let chain: Promise<void> = Promise.resolve();
  const persist = () => {
    if (!db.dirty) return chain;
    const bytes = db.export();
    chain = chain.catch(() => undefined).then(() => store.putDb(bytes));
    return chain;
  };
  await persist();

  return { app, db, SQL, store, persist, close: () => db.close() };
}

/** Runs one API request and saves the database afterwards when the request changed something. */
export async function handle(rt: Runtime, req: Request): Promise<Response> {
  let res: Response;
  try {
    res = await rt.app.fetch(req);
  } finally {
    rt.db.release();
  }
  if (rt.db.dirty) {
    try {
      await rt.persist();
    } catch {
      const message = "Der Speicher im Browser ist voll oder gesperrt – die letzte Änderung konnte nicht dauerhaft gesichert werden. Bitte Platz schaffen und eine Sicherung anlegen.";
      return new Response(JSON.stringify({ error: { code: "STORAGE_FULL", message } }), { status: 507, headers: { "content-type": "application/json; charset=utf-8" } });
    }
  }
  return res;
}
