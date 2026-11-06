import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations";

export type DB = DatabaseSync;
export { MIGRATIONS, migrate, tx } from "./migrations";

export function openDatabase(dataDir: string, file = "styleai.db"): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file === ":memory:" ? ":memory:" : path.join(dataDir, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}
