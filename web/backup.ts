// Backup of the browser edition as a ZIP file: database + photos. Saved API keys are removed on purpose –
// a backup file can end up anywhere, and keys can simply be entered again after restoring.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { MIGRATIONS, migrate } from "../server/migrations";
import type { Runtime } from "./runtime";
import { SqlJsDatabase } from "./sqljs-db";

export const BACKUP_FORMAT = "styleai-backup";
const MANIFEST = "styleai-backup.json";
const DB_FILE = "styleai.db";
const MAX_ENTRY = 200 * 1024 * 1024;

export class BackupError extends Error {}

const STRIP_SECRETS = "DELETE FROM user_ai_settings; UPDATE user_tryon_settings SET api_key_enc = NULL, key_hint = NULL; DELETE FROM sessions;";

function imagePaths(db: SqlJsDatabase): string[] {
  const rows = db.prepare("SELECT image_path, thumb_path FROM clothing_items").all() as { image_path: string; thumb_path: string | null }[];
  return [...new Set(rows.flatMap((r) => [r.image_path, r.thumb_path]).filter((p): p is string => !!p))];
}

export async function createBackup(rt: Runtime): Promise<{ zip: Uint8Array; items: number }> {
  await rt.persist();
  const tmp = new SqlJsDatabase(new rt.SQL.Database(rt.db.export()));
  try {
    tmp.exec(STRIP_SECRETS);
    const paths = imagePaths(tmp);
    const items = (tmp.prepare("SELECT count(*) AS n FROM clothing_items").get() as { n: number }).n;
    const files: Zippable = {};
    let images = 0;
    for (const p of paths) {
      const bytes = await rt.store.images.get(p);
      if (!bytes) continue;
      // Photos are WebP already: storing them uncompressed is faster and the file is not bigger.
      files[`images/${p}`] = [bytes, { level: 0 }];
      images++;
    }
    const manifest = { format: BACKUP_FORMAT, version: 1, schema: MIGRATIONS.length, createdAt: new Date().toISOString(), items, images, apiKeysIncluded: false };
    files[MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));
    files[DB_FILE] = tmp.export();
    return { zip: zipSync(files, { level: 6 }), items };
  } finally {
    tmp.close();
  }
}

export async function restoreBackup(rt: Runtime, zip: Uint8Array): Promise<{ items: number; images: number }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (f) => f.originalSize <= MAX_ENTRY && (f.name === MANIFEST || f.name === DB_FILE || f.name.startsWith("images/")),
    });
  } catch {
    throw new BackupError("Die Datei ist keine StyleAI-Sicherung (ZIP-Datei erwartet).");
  }
  let manifest: { format?: string; schema?: number };
  try {
    manifest = JSON.parse(strFromU8(files[MANIFEST] ?? new Uint8Array()));
  } catch {
    throw new BackupError("Die Datei ist keine StyleAI-Sicherung.");
  }
  if (manifest.format !== BACKUP_FORMAT || !files[DB_FILE]) throw new BackupError("Die Datei ist keine StyleAI-Sicherung.");
  if ((manifest.schema ?? 0) > MIGRATIONS.length) throw new BackupError("Die Sicherung stammt aus einer neueren App-Version. Bitte die App neu laden und erneut versuchen.");

  let tmp: SqlJsDatabase;
  try {
    tmp = new SqlJsDatabase(new rt.SQL.Database(files[DB_FILE]));
  } catch {
    throw new BackupError("Die Datenbank in der Sicherung ist beschädigt.");
  }
  try {
    const check = tmp.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    if (check?.quick_check !== "ok") throw new BackupError("Die Datenbank in der Sicherung ist beschädigt.");
    migrate(tmp);
    tmp.exec(STRIP_SECRETS);
    const users = (tmp.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
    if (users < 1) throw new BackupError("Die Sicherung enthält keine Daten.");
    const images = new Map<string, Uint8Array>();
    for (const p of imagePaths(tmp)) {
      const bytes = files[`images/${p}`];
      if (bytes) images.set(p, bytes);
    }
    const items = (tmp.prepare("SELECT count(*) AS n FROM clothing_items").get() as { n: number }).n;
    await rt.store.replaceAll(tmp.export(), images);
    return { items, images: images.size };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("Die Sicherung konnte nicht gelesen werden.");
  } finally {
    tmp.close();
  }
}
