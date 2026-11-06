// Replaces server/db.ts in the browser bundle: same exports, but backed by sql.js (see web/runtime.ts).
export { MIGRATIONS, migrate, tx } from "../../server/migrations";
export type { SqlJsDatabase as DB } from "../sqljs-db";

export function openDatabase(): never {
  throw new Error("In der Browser-Version wird die Datenbank von web/runtime.ts geöffnet.");
}
