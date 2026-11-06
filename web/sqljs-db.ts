// node:sqlite-compatible facade over sql.js (SQLite compiled to WebAssembly), so server/repo.ts runs unchanged
// in the browser. Only the API surface the app uses: exec(), prepare().get/all/run(), close().
import type { BindParams, Database, SqlValue, Statement } from "sql.js";

type Param = SqlValue | boolean | bigint | undefined;

const norm = (v: Param): SqlValue => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? Number(v) : v);

export class SqlJsDatabase {
  /** Bumped whenever sql.js statements are freed; wrappers then re-prepare lazily. */
  generation = 0;
  /** Set by every write; the service worker persists the file to IndexedDB when it is set. */
  dirty = false;
  private live = new Set<Statement>();

  constructor(readonly raw: Database) {
    this.raw.exec("PRAGMA foreign_keys = ON;");
  }

  exec(sql: string) {
    this.raw.exec(sql);
    this.dirty = true;
  }

  prepare(sql: string) {
    return new PreparedStatement(this, sql);
  }

  /** @internal */
  compile(sql: string) {
    const st = this.raw.prepare(sql);
    this.live.add(st);
    return st;
  }

  /** Frees all compiled statements (called after each request; wrappers still in use simply re-prepare). */
  release() {
    for (const st of this.live) {
      try {
        st.free();
      } catch {
        // already freed
      }
    }
    this.live.clear();
    this.generation++;
  }

  /** Serialises the database. sql.js closes and reopens it for this, which resets pragmas. */
  export(): Uint8Array {
    this.release();
    const bytes = this.raw.export();
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.dirty = false;
    return bytes;
  }

  close() {
    this.release();
    this.raw.close();
  }
}

class PreparedStatement {
  private st: Statement | null = null;
  private gen = -1;

  constructor(
    private db: SqlJsDatabase,
    private sql: string,
  ) {}

  private bound(params: Param[]) {
    if (!this.st || this.gen !== this.db.generation) {
      this.st = this.db.compile(this.sql);
      this.gen = this.db.generation;
    }
    const st = this.st;
    st.reset();
    if (params.length) st.bind(params.map(norm) as BindParams);
    return st;
  }

  get(...params: Param[]): Record<string, SqlValue> | undefined {
    const st = this.bound(params);
    try {
      return st.step() ? st.getAsObject() : undefined;
    } finally {
      st.reset();
    }
  }

  all(...params: Param[]): Record<string, SqlValue>[] {
    const st = this.bound(params);
    const rows: Record<string, SqlValue>[] = [];
    try {
      while (st.step()) rows.push(st.getAsObject());
    } finally {
      st.reset();
    }
    return rows;
  }

  run(...params: Param[]): { changes: number; lastInsertRowid: number } {
    const st = this.bound(params);
    try {
      st.step();
    } finally {
      st.reset();
    }
    this.db.dirty = true;
    return { changes: this.db.raw.getRowsModified(), lastInsertRowid: 0 };
  }
}
