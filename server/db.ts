import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

// Postgres-compatible table design: TEXT ids (UUID), ISO timestamps, JSON stored as TEXT.
// Every user-owned table carries user_id; all queries in repo.ts filter on it (the RLS equivalent).
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'de',
    ai_image_consent_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE style_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferred_styles TEXT NOT NULL DEFAULT '[]',
    custom_style TEXT,
    favorite_colors TEXT NOT NULL DEFAULT '[]',
    avoided_colors TEXT NOT NULL DEFAULT '[]',
    typical_occasions TEXT NOT NULL DEFAULT '[]',
    experimental REAL NOT NULL DEFAULT 0.3,
    boldness REAL NOT NULL DEFAULT 0.4,
    personalization_enabled INTEGER NOT NULL DEFAULT 1,
    avoid_repeat_days INTEGER NOT NULL DEFAULT 7,
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    location_name TEXT,
    location_lat REAL,
    location_lon REAL,
    theme TEXT NOT NULL DEFAULT 'system',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT,
    name TEXT NOT NULL,
    grp TEXT NOT NULL,
    slot TEXT NOT NULL,
    layer TEXT NOT NULL,
    warmth REAL NOT NULL,
    formality REAL NOT NULL,
    accessory_kind TEXT,
    standalone INTEGER NOT NULL,
    belt_loops INTEGER NOT NULL,
    leg_coverage TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_default INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, name)
  );
  CREATE INDEX categories_user ON categories(user_id);

  CREATE TABLE clothing_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    subtype TEXT,
    name TEXT NOT NULL,
    image_path TEXT NOT NULL,
    thumb_path TEXT NOT NULL,
    colors TEXT NOT NULL DEFAULT '[]',
    pattern TEXT NOT NULL DEFAULT 'uni',
    material TEXT,
    fit TEXT,
    styles TEXT NOT NULL DEFAULT '[]',
    seasons TEXT NOT NULL DEFAULT '[]',
    occasions TEXT NOT NULL DEFAULT '[]',
    formality REAL NOT NULL,
    warmth REAL NOT NULL,
    slot_override TEXT,
    description TEXT NOT NULL DEFAULT '',
    brand TEXT,
    purchase_date TEXT,
    price_cents INTEGER,
    status TEXT NOT NULL DEFAULT 'available',
    favorite INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    ai_analyzed INTEGER NOT NULL DEFAULT 0,
    ai_confidence TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX items_user ON clothing_items(user_id, created_at);

  CREATE TABLE outfits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    styles TEXT NOT NULL DEFAULT '[]',
    occasion TEXT,
    weather TEXT,
    explanation TEXT,
    score REAL,
    score_breakdown TEXT,
    source TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    saved INTEGER NOT NULL DEFAULT 1,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX outfits_user ON outfits(user_id, created_at);

  CREATE TABLE outfit_items (
    outfit_id TEXT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES clothing_items(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (outfit_id, item_id)
  );
  CREATE INDEX outfit_items_item ON outfit_items(item_id);

  CREATE TABLE outfit_feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outfit_id TEXT REFERENCES outfits(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    item_ids TEXT NOT NULL,
    from_item_id TEXT,
    to_item_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX feedback_user ON outfit_feedback(user_id, created_at);

  CREATE TABLE outfit_calendar (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    outfit_id TEXT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('planned', 'worn')),
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, date, outfit_id)
  );
  CREATE INDEX calendar_user_date ON outfit_calendar(user_id, date);

  CREATE TABLE wear_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES clothing_items(id) ON DELETE CASCADE,
    worn_on TEXT NOT NULL,
    calendar_id TEXT REFERENCES outfit_calendar(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX wear_item ON wear_log(item_id, worn_on);
  CREATE INDEX wear_user ON wear_log(user_id, worn_on);

  CREATE TABLE ai_usage (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day, kind)
  );
  `,
  // v2: per-user AI provider ("bring your own key"); the key is stored AES-GCM encrypted.
  `
  CREATE TABLE user_ai_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    base_url TEXT,
    vision_model TEXT,
    text_model TEXT,
    updated_at TEXT NOT NULL
  );
  `,
  // v3: realistic live try-on via Decart (own key optional, encrypted) and the consent to stream the camera.
  `
  CREATE TABLE user_tryon_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    api_key_enc TEXT,
    key_hint TEXT,
    max_session_seconds INTEGER NOT NULL DEFAULT 60,
    video_consent_at TEXT,
    updated_at TEXT NOT NULL
  );
  `,
];

export function openDatabase(dataDir: string, file = "styleai.db"): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file === ":memory:" ? ":memory:" : path.join(dataDir, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
