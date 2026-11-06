// Data access. Every function takes the owning userId and filters on it – nothing crosses users.
import { randomUUID } from "node:crypto";
import type { FeedbackEvent } from "../shared/engine/personalization";
import type { FeedbackInput, ItemInput, ItemPatch, OutfitInput } from "../shared/schemas";
import { DEFAULT_CATEGORIES } from "../shared/taxonomy";
import type {
  CalendarEntry,
  Category,
  ClothingItem,
  Me,
  Outfit,
  OutfitItemRef,
  StylePreferences,
} from "../shared/types";
import { tx, type DB } from "./db";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const j = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const b = (v: boolean) => (v ? 1 : 0);
const nn = <T,>(v: T | undefined | null) => (v === undefined ? null : v);

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

// ---------------------------------------------------------------------------
// Users & sessions
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  ai_image_consent_at: string | null;
  created_at: string;
}

export function toMe(u: UserRow): Me {
  return { id: u.id, email: u.email, displayName: u.display_name, aiImageConsent: !!u.ai_image_consent_at, createdAt: u.created_at };
}

export function createUser(db: DB, email: string, passwordHash: string, displayName: string): UserRow {
  const id = randomUUID();
  const created = now();
  tx(db, () => {
    db.prepare("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)").run(id, email, passwordHash, displayName, created);
    db.prepare("INSERT INTO style_preferences (user_id, updated_at) VALUES (?, ?)").run(id, created);
    const ins = db.prepare(
      `INSERT INTO categories (id, user_id, key, name, grp, slot, layer, warmth, formality, accessory_kind, standalone, belt_loops, leg_coverage, sort_order, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    DEFAULT_CATEGORIES.forEach((c, i) =>
      ins.run(randomUUID(), id, c.key, c.name, c.group, c.slot, c.layer, c.warmth, c.formality, c.accessoryKind, b(c.standalone), b(c.beltLoops), c.legCoverage, i, created),
    );
  });
  return getUser(db, id)!;
}

export const findUserByEmail = (db: DB, email: string) =>
  db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
export const getUser = (db: DB, id: string) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;

export function setAiConsent(db: DB, userId: string, consent: boolean) {
  db.prepare("UPDATE users SET ai_image_consent_at = ? WHERE id = ?").run(consent ? now() : null, userId);
}

export function deleteUser(db: DB, userId: string) {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

export function createSession(db: DB, userId: string, idHash: string, ttlDays: number) {
  const created = new Date();
  const expires = new Date(created.getTime() + ttlDays * 86_400_000);
  db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(idHash, userId, created.toISOString(), expires.toISOString());
  return expires;
}

export function getSessionUser(db: DB, idHash: string): UserRow | undefined {
  return db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?")
    .get(idHash, now()) as UserRow | undefined;
}

export const deleteSession = (db: DB, idHash: string) => db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
export const deleteUserSessions = (db: DB, userId: string) => db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
export const purgeExpiredSessions = (db: DB) => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export function getPreferences(db: DB, userId: string): StylePreferences {
  const r = db.prepare("SELECT * FROM style_preferences WHERE user_id = ?").get(userId) as Row;
  return {
    preferredStyles: j(r.preferred_styles, []),
    customStyle: (r.custom_style as string) ?? null,
    favoriteColors: j(r.favorite_colors, []),
    avoidedColors: j(r.avoided_colors, []),
    typicalOccasions: j(r.typical_occasions, []),
    experimental: r.experimental as number,
    boldness: r.boldness as number,
    personalizationEnabled: !!r.personalization_enabled,
    avoidRepeatDays: r.avoid_repeat_days as number,
    onboardingCompleted: !!r.onboarding_completed,
    locationName: (r.location_name as string) ?? null,
    locationLat: (r.location_lat as number) ?? null,
    locationLon: (r.location_lon as number) ?? null,
    theme: (r.theme as StylePreferences["theme"]) ?? "system",
  };
}

const PREF_COLUMNS: Record<keyof StylePreferences, string> = {
  preferredStyles: "preferred_styles",
  customStyle: "custom_style",
  favoriteColors: "favorite_colors",
  avoidedColors: "avoided_colors",
  typicalOccasions: "typical_occasions",
  experimental: "experimental",
  boldness: "boldness",
  personalizationEnabled: "personalization_enabled",
  avoidRepeatDays: "avoid_repeat_days",
  onboardingCompleted: "onboarding_completed",
  locationName: "location_name",
  locationLat: "location_lat",
  locationLon: "location_lon",
  theme: "theme",
};

export function updatePreferences(db: DB, userId: string, patch: Partial<StylePreferences>): StylePreferences {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch) as [keyof StylePreferences, unknown][]) {
    if (v === undefined) continue;
    sets.push(`${PREF_COLUMNS[k]} = ?`);
    if (Array.isArray(v)) vals.push(JSON.stringify(v));
    else if (typeof v === "boolean") vals.push(b(v));
    else if (k === "locationLat" || k === "locationLon") vals.push(v === null ? null : Math.round((v as number) * 100) / 100);
    else vals.push(v as string | number | null);
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    vals.push(now(), userId);
    db.prepare(`UPDATE style_preferences SET ${sets.join(", ")} WHERE user_id = ?`).run(...vals);
  }
  return getPreferences(db, userId);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function toCategory(r: Row): Category {
  return {
    id: r.id as string,
    key: (r.key as string) ?? null,
    name: r.name as string,
    group: r.grp as Category["group"],
    slot: r.slot as Category["slot"],
    layer: r.layer as Category["layer"],
    warmth: r.warmth as number,
    formality: r.formality as number,
    accessoryKind: (r.accessory_kind as Category["accessoryKind"]) ?? null,
    standalone: !!r.standalone,
    beltLoops: !!r.belt_loops,
    legCoverage: r.leg_coverage as Category["legCoverage"],
    sortOrder: r.sort_order as number,
    isDefault: !!r.is_default,
    itemCount: (r.item_count as number) ?? 0,
  };
}

export function listCategories(db: DB, userId: string): Category[] {
  return (
    db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM clothing_items i WHERE i.category_id = c.id) AS item_count
         FROM categories c WHERE c.user_id = ? ORDER BY c.sort_order, c.name`,
      )
      .all(userId) as Row[]
  ).map(toCategory);
}

export function getCategory(db: DB, userId: string, id: string): Category | undefined {
  const r = db.prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return r ? toCategory(r) : undefined;
}

export function createCategory(db: DB, userId: string, c: Omit<Category, "id" | "key" | "sortOrder" | "isDefault" | "itemCount">): Category {
  const id = randomUUID();
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE user_id = ?").get(userId) as { m: number };
  try {
    db.prepare(
      `INSERT INTO categories (id, user_id, key, name, grp, slot, layer, warmth, formality, accessory_kind, standalone, belt_loops, leg_coverage, sort_order, is_default, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(id, userId, c.name, c.group, c.slot, c.layer, c.warmth, c.formality, c.accessoryKind, b(c.standalone), b(c.beltLoops), c.legCoverage, max.m + 1, now());
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new ConflictError("Eine Kategorie mit diesem Namen existiert bereits.");
    throw e;
  }
  return getCategory(db, userId, id)!;
}

export function updateCategory(db: DB, userId: string, id: string, patch: Partial<Category>): Category {
  if (!getCategory(db, userId, id)) throw new NotFoundError("Kategorie nicht gefunden.");
  const map: Partial<Record<keyof Category, string>> = {
    name: "name",
    group: "grp",
    slot: "slot",
    layer: "layer",
    warmth: "warmth",
    formality: "formality",
    accessoryKind: "accessory_kind",
    standalone: "standalone",
    beltLoops: "belt_loops",
    legCoverage: "leg_coverage",
    sortOrder: "sort_order",
  };
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, col] of Object.entries(map) as [keyof Category, string][]) {
    const v = patch[k];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(typeof v === "boolean" ? b(v) : (v as string | number | null));
  }
  if (sets.length) {
    try {
      db.prepare(`UPDATE categories SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new ConflictError("Eine Kategorie mit diesem Namen existiert bereits.");
      throw e;
    }
  }
  return getCategory(db, userId, id)!;
}

export function deleteCategory(db: DB, userId: string, id: string) {
  const c = db.prepare("SELECT (SELECT COUNT(*) FROM clothing_items WHERE category_id = ?) AS n FROM categories WHERE id = ? AND user_id = ?").get(id, id, userId) as { n: number } | undefined;
  if (!c) throw new NotFoundError("Kategorie nicht gefunden.");
  if (c.n > 0) throw new ConflictError("Die Kategorie enthält noch Kleidungsstücke. Verschiebe sie zuerst in eine andere Kategorie.");
  db.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").run(id, userId);
}

// ---------------------------------------------------------------------------
// Clothing items
// ---------------------------------------------------------------------------

const ITEM_SELECT = `SELECT ci.*,
  (SELECT COUNT(*) FROM wear_log w WHERE w.item_id = ci.id) AS wear_count,
  (SELECT MAX(worn_on) FROM wear_log w WHERE w.item_id = ci.id) AS last_worn_on
  FROM clothing_items ci`;

function toItem(r: Row): ClothingItem {
  const v = encodeURIComponent(r.updated_at as string);
  return {
    id: r.id as string,
    categoryId: r.category_id as string,
    subtype: (r.subtype as string) ?? null,
    name: r.name as string,
    imageUrl: `/api/images/${r.id}/main?v=${v}`,
    thumbUrl: `/api/images/${r.id}/thumb?v=${v}`,
    colors: j(r.colors, []),
    pattern: r.pattern as ClothingItem["pattern"],
    material: (r.material as string) ?? null,
    fit: (r.fit as ClothingItem["fit"]) ?? null,
    styles: j(r.styles, []),
    seasons: j(r.seasons, []),
    occasions: j(r.occasions, []),
    formality: r.formality as number,
    warmth: r.warmth as number,
    slotOverride: (r.slot_override as ClothingItem["slotOverride"]) ?? null,
    description: (r.description as string) ?? "",
    brand: (r.brand as string) ?? null,
    purchaseDate: (r.purchase_date as string) ?? null,
    priceCents: (r.price_cents as number) ?? null,
    status: r.status as ClothingItem["status"],
    favorite: !!r.favorite,
    tags: j(r.tags, []),
    aiAnalyzed: !!r.ai_analyzed,
    aiConfidence: j(r.ai_confidence, null),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    wearCount: (r.wear_count as number) ?? 0,
    lastWornOn: (r.last_worn_on as string) ?? null,
  };
}

export function listItems(db: DB, userId: string): ClothingItem[] {
  return (db.prepare(`${ITEM_SELECT} WHERE ci.user_id = ? ORDER BY ci.created_at DESC`).all(userId) as Row[]).map(toItem);
}

export function getItem(db: DB, userId: string, id: string): ClothingItem | undefined {
  const r = db.prepare(`${ITEM_SELECT} WHERE ci.id = ? AND ci.user_id = ?`).get(id, userId) as Row | undefined;
  return r ? toItem(r) : undefined;
}

export function getItemPaths(db: DB, userId: string, id: string) {
  return db.prepare("SELECT image_path, thumb_path FROM clothing_items WHERE id = ? AND user_id = ?").get(id, userId) as
    | { image_path: string; thumb_path: string }
    | undefined;
}

const ITEM_COLUMNS: Record<keyof ItemInput, string> = {
  categoryId: "category_id",
  subtype: "subtype",
  name: "name",
  colors: "colors",
  pattern: "pattern",
  material: "material",
  fit: "fit",
  styles: "styles",
  seasons: "seasons",
  occasions: "occasions",
  formality: "formality",
  warmth: "warmth",
  slotOverride: "slot_override",
  description: "description",
  brand: "brand",
  purchaseDate: "purchase_date",
  priceCents: "price_cents",
  status: "status",
  favorite: "favorite",
  tags: "tags",
  aiAnalyzed: "ai_analyzed",
  aiConfidence: "ai_confidence",
};

function itemValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return b(v);
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number;
}

export function createItem(db: DB, userId: string, input: ItemInput, paths: { image: string; thumb: string }, id = randomUUID()): ClothingItem {
  if (!getCategory(db, userId, input.categoryId)) throw new NotFoundError("Kategorie nicht gefunden.");
  const cols = Object.keys(ITEM_COLUMNS) as (keyof ItemInput)[];
  const t = now();
  db.prepare(
    `INSERT INTO clothing_items (id, user_id, image_path, thumb_path, created_at, updated_at, ${cols.map((c) => ITEM_COLUMNS[c]).join(", ")})
     VALUES (?, ?, ?, ?, ?, ?, ${cols.map(() => "?").join(", ")})`,
  ).run(id, userId, paths.image, paths.thumb, t, t, ...cols.map((c) => itemValue(input[c])));
  return getItem(db, userId, id)!;
}

export function updateItem(db: DB, userId: string, id: string, patch: ItemPatch, paths?: { image: string; thumb: string }): ClothingItem {
  if (!getItem(db, userId, id)) throw new NotFoundError("Kleidungsstück nicht gefunden.");
  if (patch.categoryId && !getCategory(db, userId, patch.categoryId)) throw new NotFoundError("Kategorie nicht gefunden.");
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch) as [keyof ItemInput, unknown][]) {
    if (v === undefined) continue;
    sets.push(`${ITEM_COLUMNS[k]} = ?`);
    vals.push(itemValue(v));
  }
  if (paths) {
    sets.push("image_path = ?", "thumb_path = ?");
    vals.push(paths.image, paths.thumb);
  }
  sets.push("updated_at = ?");
  vals.push(now());
  db.prepare(`UPDATE clothing_items SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  return getItem(db, userId, id)!;
}

export function deleteItem(db: DB, userId: string, id: string) {
  const paths = getItemPaths(db, userId, id);
  if (!paths) throw new NotFoundError("Kleidungsstück nicht gefunden.");
  db.prepare("DELETE FROM clothing_items WHERE id = ? AND user_id = ?").run(id, userId);
  return paths;
}

export function allImagePaths(db: DB, userId: string) {
  return db.prepare("SELECT id, image_path, thumb_path FROM clothing_items WHERE user_id = ?").all(userId) as {
    id: string;
    image_path: string;
    thumb_path: string;
  }[];
}

export function ownedItemIds(db: DB, userId: string, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  const rows = db
    .prepare(`SELECT id FROM clothing_items WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .all(userId, ...ids) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Outfits
// ---------------------------------------------------------------------------

function toOutfit(r: Row, items: OutfitItemRef[]): Outfit {
  return {
    id: r.id as string,
    name: r.name as string,
    items,
    styles: j(r.styles, []),
    occasion: (r.occasion as Outfit["occasion"]) ?? null,
    weather: j(r.weather, null),
    explanation: j(r.explanation, null),
    score: (r.score as number) ?? null,
    breakdown: j(r.score_breakdown, null),
    source: r.source as Outfit["source"],
    saved: !!r.saved,
    favorite: !!r.favorite,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    missingItems: Math.max(0, ((r.item_count as number) ?? items.length) - items.length),
  };
}

function outfitItems(db: DB, outfitIds: string[]): Map<string, OutfitItemRef[]> {
  const m = new Map<string, OutfitItemRef[]>();
  if (!outfitIds.length) return m;
  const rows = db
    .prepare(`SELECT outfit_id, item_id, role FROM outfit_items WHERE outfit_id IN (${outfitIds.map(() => "?").join(",")}) ORDER BY position`)
    .all(...outfitIds) as { outfit_id: string; item_id: string; role: OutfitItemRef["role"] }[];
  for (const r of rows) m.set(r.outfit_id, [...(m.get(r.outfit_id) ?? []), { itemId: r.item_id, role: r.role }]);
  return m;
}

export function listOutfits(db: DB, userId: string, opts: { savedOnly?: boolean } = {}): Outfit[] {
  const rows = db
    .prepare(`SELECT * FROM outfits WHERE user_id = ? ${opts.savedOnly ? "AND saved = 1" : ""} ORDER BY created_at DESC`)
    .all(userId) as Row[];
  const items = outfitItems(db, rows.map((r) => r.id as string));
  return rows.map((r) => toOutfit(r, items.get(r.id as string) ?? []));
}

export function getOutfit(db: DB, userId: string, id: string): Outfit | undefined {
  const r = db.prepare("SELECT * FROM outfits WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) return undefined;
  return toOutfit(r, outfitItems(db, [id]).get(id) ?? []);
}

function writeOutfitItems(db: DB, userId: string, outfitId: string, refs: OutfitItemRef[]) {
  const unique = refs.filter((r, i) => refs.findIndex((x) => x.itemId === r.itemId) === i);
  const owned = ownedItemIds(db, userId, unique.map((r) => r.itemId));
  if (owned.size !== unique.length) throw new NotFoundError("Ein Kleidungsstück des Outfits existiert nicht in deinem Kleiderschrank.");
  db.prepare("DELETE FROM outfit_items WHERE outfit_id = ?").run(outfitId);
  const ins = db.prepare("INSERT INTO outfit_items (outfit_id, item_id, role, position) VALUES (?, ?, ?, ?)");
  unique.forEach((r, i) => ins.run(outfitId, r.itemId, r.role, i));
  db.prepare("UPDATE outfits SET item_count = ? WHERE id = ?").run(unique.length, outfitId);
}

export function createOutfit(db: DB, userId: string, input: OutfitInput): Outfit {
  const id = randomUUID();
  const t = now();
  tx(db, () => {
    db.prepare(
      `INSERT INTO outfits (id, user_id, name, styles, occasion, weather, explanation, score, score_breakdown, source, saved, favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      input.name,
      JSON.stringify(input.styles),
      input.occasion,
      input.weather ? JSON.stringify(input.weather) : null,
      input.explanation ? JSON.stringify(input.explanation) : null,
      input.score,
      input.breakdown ? JSON.stringify(input.breakdown) : null,
      input.source,
      b(input.saved),
      b(input.favorite),
      t,
      t,
    );
    writeOutfitItems(db, userId, id, input.items);
  });
  return getOutfit(db, userId, id)!;
}

export function updateOutfit(
  db: DB,
  userId: string,
  id: string,
  patch: { name?: string; items?: OutfitItemRef[]; favorite?: boolean; saved?: boolean; explanation?: unknown; score?: number | null; breakdown?: unknown },
): Outfit {
  if (!getOutfit(db, userId, id)) throw new NotFoundError("Outfit nicht gefunden.");
  tx(db, () => {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if (patch.name !== undefined) (sets.push("name = ?"), vals.push(patch.name));
    if (patch.favorite !== undefined) (sets.push("favorite = ?"), vals.push(b(patch.favorite)));
    if (patch.saved !== undefined) (sets.push("saved = ?"), vals.push(b(patch.saved)));
    if (patch.explanation !== undefined) (sets.push("explanation = ?"), vals.push(patch.explanation ? JSON.stringify(patch.explanation) : null));
    if (patch.score !== undefined) (sets.push("score = ?"), vals.push(nn(patch.score)));
    if (patch.breakdown !== undefined) (sets.push("score_breakdown = ?"), vals.push(patch.breakdown ? JSON.stringify(patch.breakdown) : null));
    sets.push("updated_at = ?");
    vals.push(now());
    db.prepare(`UPDATE outfits SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
    if (patch.items) writeOutfitItems(db, userId, id, patch.items);
  });
  return getOutfit(db, userId, id)!;
}

export function deleteOutfit(db: DB, userId: string, id: string) {
  const r = db.prepare("DELETE FROM outfits WHERE id = ? AND user_id = ?").run(id, userId);
  if (!r.changes) throw new NotFoundError("Outfit nicht gefunden.");
}

/** Outfit key (sorted main item ids) → days since it was last worn. */
export function recentOutfitWear(db: DB, userId: string, sinceDays: number): Map<string, number> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT c.date, oi.item_id, oi.role FROM outfit_calendar c JOIN outfit_items oi ON oi.outfit_id = c.outfit_id
       WHERE c.user_id = ? AND c.status = 'worn' AND c.date >= ?`,
    )
    .all(userId, since) as { date: string; item_id: string; role: string }[];
  const byDate = new Map<string, string[]>();
  for (const r of rows) if (!r.role.startsWith("acc:")) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.item_id]);
  const out = new Map<string, number>();
  for (const [date, ids] of byDate) {
    const key = [...ids].sort().join(",");
    const days = Math.round((Date.now() - Date.parse(date + "T12:00:00")) / 86_400_000);
    out.set(key, Math.min(out.get(key) ?? Infinity, Math.max(0, days)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function addFeedback(db: DB, userId: string, f: FeedbackInput) {
  if (f.outfitId && !getOutfit(db, userId, f.outfitId)) throw new NotFoundError("Outfit nicht gefunden.");
  const ids = [...f.itemIds, ...(f.fromItemId ? [f.fromItemId] : []), ...(f.toItemId ? [f.toItemId] : [])];
  if (ownedItemIds(db, userId, [...new Set(ids)]).size !== new Set(ids).size) throw new NotFoundError("Unbekanntes Kleidungsstück im Feedback.");
  db.prepare(
    "INSERT INTO outfit_feedback (id, user_id, outfit_id, kind, item_ids, from_item_id, to_item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), userId, f.outfitId, f.kind, JSON.stringify(f.itemIds), f.fromItemId, f.toItemId, now());
}

export function listFeedback(db: DB, userId: string, limit = 2000): FeedbackEvent[] {
  return (
    db.prepare("SELECT * FROM outfit_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as Row[]
  ).map((r) => ({
    kind: r.kind as FeedbackEvent["kind"],
    itemIds: j(r.item_ids, []),
    fromItemId: (r.from_item_id as string) ?? null,
    toItemId: (r.to_item_id as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

export const clearFeedback = (db: DB, userId: string) => db.prepare("DELETE FROM outfit_feedback WHERE user_id = ?").run(userId);

// ---------------------------------------------------------------------------
// Calendar & wear log
// ---------------------------------------------------------------------------

function toEntry(r: Row, outfit: Outfit | null): CalendarEntry {
  return { id: r.id as string, date: r.date as string, outfitId: r.outfit_id as string, status: r.status as CalendarEntry["status"], note: (r.note as string) ?? null, outfit };
}

export function listCalendar(db: DB, userId: string, from: string, to: string): CalendarEntry[] {
  const rows = db.prepare("SELECT * FROM outfit_calendar WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, created_at").all(userId, from, to) as Row[];
  return rows.map((r) => toEntry(r, getOutfit(db, userId, r.outfit_id as string) ?? null));
}

function syncWearLog(db: DB, userId: string, entryId: string) {
  const e = db.prepare("SELECT * FROM outfit_calendar WHERE id = ? AND user_id = ?").get(entryId, userId) as Row | undefined;
  db.prepare("DELETE FROM wear_log WHERE calendar_id = ?").run(entryId);
  if (!e || e.status !== "worn") return;
  const items = db.prepare("SELECT item_id FROM outfit_items WHERE outfit_id = ?").all(e.outfit_id as string) as { item_id: string }[];
  const ins = db.prepare("INSERT INTO wear_log (id, user_id, item_id, worn_on, calendar_id, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const it of items) ins.run(randomUUID(), userId, it.item_id, e.date as string, entryId, now());
}

export function addCalendarEntry(db: DB, userId: string, input: { date: string; outfitId: string; status: "planned" | "worn"; note: string | null }): CalendarEntry {
  if (!getOutfit(db, userId, input.outfitId)) throw new NotFoundError("Outfit nicht gefunden.");
  const existing = db.prepare("SELECT id FROM outfit_calendar WHERE user_id = ? AND date = ? AND outfit_id = ?").get(userId, input.date, input.outfitId) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  tx(db, () => {
    if (existing) db.prepare("UPDATE outfit_calendar SET status = ?, note = ? WHERE id = ?").run(input.status, input.note, id);
    else
      db.prepare("INSERT INTO outfit_calendar (id, user_id, date, outfit_id, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        userId,
        input.date,
        input.outfitId,
        input.status,
        input.note,
        now(),
      );
    syncWearLog(db, userId, id);
  });
  const r = db.prepare("SELECT * FROM outfit_calendar WHERE id = ?").get(id) as Row;
  return toEntry(r, getOutfit(db, userId, input.outfitId) ?? null);
}

export function updateCalendarEntry(db: DB, userId: string, id: string, patch: { status?: "planned" | "worn"; note?: string | null; date?: string }): CalendarEntry {
  const r = db.prepare("SELECT * FROM outfit_calendar WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Kalendereintrag nicht gefunden.");
  tx(db, () => {
    db.prepare("UPDATE outfit_calendar SET status = ?, note = ?, date = ? WHERE id = ? AND user_id = ?").run(
      patch.status ?? (r.status as string),
      patch.note !== undefined ? patch.note : ((r.note as string) ?? null),
      patch.date ?? (r.date as string),
      id,
      userId,
    );
    syncWearLog(db, userId, id);
  });
  const u = db.prepare("SELECT * FROM outfit_calendar WHERE id = ?").get(id) as Row;
  return toEntry(u, getOutfit(db, userId, u.outfit_id as string) ?? null);
}

export function deleteCalendarEntry(db: DB, userId: string, id: string) {
  const r = db.prepare("DELETE FROM outfit_calendar WHERE id = ? AND user_id = ?").run(id, userId);
  if (!r.changes) throw new NotFoundError("Kalendereintrag nicht gefunden.");
}

export function logItemWear(db: DB, userId: string, itemId: string, date: string) {
  if (!getItemPaths(db, userId, itemId)) throw new NotFoundError("Kleidungsstück nicht gefunden.");
  db.prepare("INSERT INTO wear_log (id, user_id, item_id, worn_on, calendar_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)").run(randomUUID(), userId, itemId, date, now());
}

export function itemWearHistory(db: DB, userId: string, itemId: string): string[] {
  return (db.prepare("SELECT worn_on FROM wear_log WHERE user_id = ? AND item_id = ? ORDER BY worn_on DESC LIMIT 100").all(userId, itemId) as { worn_on: string }[]).map((r) => r.worn_on);
}

// ---------------------------------------------------------------------------
// AI usage (cost control)
// ---------------------------------------------------------------------------

export function getAiUsage(db: DB, userId: string, day: string, kind: string): number {
  const r = db.prepare("SELECT requests FROM ai_usage WHERE user_id = ? AND day = ? AND kind = ?").get(userId, day, kind) as { requests: number } | undefined;
  return r?.requests ?? 0;
}

export function recordAiUsage(db: DB, userId: string, day: string, kind: string, inTok: number, outTok: number) {
  db.prepare(
    `INSERT INTO ai_usage (user_id, day, kind, requests, input_tokens, output_tokens) VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT (user_id, day, kind) DO UPDATE SET requests = requests + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
  ).run(userId, day, kind, inTok, outTok);
}

// ---------------------------------------------------------------------------
// Per-user AI provider settings
// ---------------------------------------------------------------------------

export interface UserAiSettingsRow {
  provider: string;
  api_key_enc: string;
  key_hint: string;
  base_url: string | null;
  vision_model: string | null;
  text_model: string | null;
  updated_at: string;
}

export const getUserAiSettings = (db: DB, userId: string) =>
  db.prepare("SELECT provider, api_key_enc, key_hint, base_url, vision_model, text_model, updated_at FROM user_ai_settings WHERE user_id = ?").get(userId) as
    | UserAiSettingsRow
    | undefined;

export function saveUserAiSettings(db: DB, userId: string, s: Omit<UserAiSettingsRow, "updated_at">) {
  db.prepare(
    `INSERT INTO user_ai_settings (user_id, provider, api_key_enc, key_hint, base_url, vision_model, text_model, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET provider = excluded.provider, api_key_enc = excluded.api_key_enc, key_hint = excluded.key_hint,
       base_url = excluded.base_url, vision_model = excluded.vision_model, text_model = excluded.text_model, updated_at = excluded.updated_at`,
  ).run(userId, s.provider, s.api_key_enc, s.key_hint, s.base_url, s.vision_model, s.text_model, now());
}

export const deleteUserAiSettings = (db: DB, userId: string) => db.prepare("DELETE FROM user_ai_settings WHERE user_id = ?").run(userId);

// ---------------------------------------------------------------------------
// Realistic live try-on (Decart)
// ---------------------------------------------------------------------------

export interface TryonSettingsRow {
  api_key_enc: string | null;
  key_hint: string | null;
  max_session_seconds: number;
  video_consent_at: string | null;
  updated_at: string;
}

export const getTryonSettings = (db: DB, userId: string) =>
  db.prepare("SELECT api_key_enc, key_hint, max_session_seconds, video_consent_at, updated_at FROM user_tryon_settings WHERE user_id = ?").get(userId) as
    | TryonSettingsRow
    | undefined;

/** Upsert; fields left undefined keep their stored value. `apiKeyEnc: null` removes the own key. */
export function saveTryonSettings(db: DB, userId: string, s: { apiKeyEnc?: string | null; keyHint?: string | null; maxSessionSeconds?: number; consent?: boolean }) {
  const cur = getTryonSettings(db, userId);
  const consentAt = s.consent === undefined ? (cur?.video_consent_at ?? null) : s.consent ? (cur?.video_consent_at ?? now()) : null;
  db.prepare(
    `INSERT INTO user_tryon_settings (user_id, api_key_enc, key_hint, max_session_seconds, video_consent_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET api_key_enc = excluded.api_key_enc, key_hint = excluded.key_hint,
       max_session_seconds = excluded.max_session_seconds, video_consent_at = excluded.video_consent_at, updated_at = excluded.updated_at`,
  ).run(
    userId,
    s.apiKeyEnc === undefined ? (cur?.api_key_enc ?? null) : s.apiKeyEnc,
    s.keyHint === undefined ? (cur?.key_hint ?? null) : s.keyHint,
    s.maxSessionSeconds ?? cur?.max_session_seconds ?? 60,
    consentAt,
    now(),
  );
}

export const deleteTryonSettings = (db: DB, userId: string) => db.prepare("DELETE FROM user_tryon_settings WHERE user_id = ?").run(userId);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function exportUserData(db: DB, userId: string) {
  const u = getUser(db, userId)!;
  const tryon = getTryonSettings(db, userId);
  return {
    exportedAt: now(),
    profile: { email: u.email, displayName: u.display_name, createdAt: u.created_at, aiImageConsentAt: u.ai_image_consent_at },
    // The key itself is never exported.
    liveTryOn: tryon ? { videoConsentAt: tryon.video_consent_at, maxSessionSeconds: tryon.max_session_seconds, ownKey: !!tryon.api_key_enc } : null,
    preferences: getPreferences(db, userId),
    categories: listCategories(db, userId),
    items: listItems(db, userId).map(({ imageUrl: _i, thumbUrl: _t, ...rest }) => rest),
    outfits: listOutfits(db, userId),
    calendar: listCalendar(db, userId, "0000-01-01", "9999-12-31").map(({ outfit: _o, ...rest }) => rest),
    feedback: listFeedback(db, userId, 100000),
  };
}
