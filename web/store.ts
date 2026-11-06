// Persistent storage of the browser edition: the SQLite file, the encryption key and the garment photos live
// in IndexedDB of this browser. Nothing is sent anywhere.

export interface ImageBackend {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(keys: string[]): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface LocalStore {
  getDb(): Promise<Uint8Array | undefined>;
  putDb(bytes: Uint8Array): Promise<void>;
  getSecret(): Promise<Uint8Array | undefined>;
  putSecret(bytes: Uint8Array): Promise<void>;
  images: ImageBackend;
  /** Restore: replaces database and all photos in one transaction (all or nothing). */
  replaceAll(db: Uint8Array, images: Map<string, Uint8Array>): Promise<void>;
}

const DB_NAME = "styleai";
const KV = "kv";
const IMAGES = "images";

const done = (t: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("IndexedDB-Fehler"));
    t.onabort = () => reject(t.error ?? new Error("IndexedDB-Transaktion abgebrochen"));
  });

const result = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB-Fehler"));
  });

/** Copies into a plain, tightly sized Uint8Array (structured clone keeps the whole underlying buffer otherwise). */
const plain = (b: Uint8Array) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength && b.constructor === Uint8Array ? b : new Uint8Array(b));

export function openIdbStore(name = DB_NAME): Promise<LocalStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB ist nicht verfügbar"));
    req.onsuccess = () => resolve(idbStore(req.result));
  });
}

function idbStore(db: IDBDatabase): LocalStore {
  const kvGet = async (key: string) => (await result(db.transaction(KV).objectStore(KV).get(key))) as Uint8Array | undefined;
  const kvPut = async (key: string, value: Uint8Array) => {
    const t = db.transaction(KV, "readwrite");
    t.objectStore(KV).put(plain(value), key);
    await done(t);
  };
  const images: ImageBackend = {
    async put(key, bytes) {
      const t = db.transaction(IMAGES, "readwrite");
      t.objectStore(IMAGES).put(plain(bytes), key);
      await done(t);
    },
    async get(key) {
      return (await result(db.transaction(IMAGES).objectStore(IMAGES).get(key))) as Uint8Array | undefined;
    },
    async delete(keys) {
      if (!keys.length) return;
      const t = db.transaction(IMAGES, "readwrite");
      for (const k of keys) t.objectStore(IMAGES).delete(k);
      await done(t);
    },
    async deletePrefix(prefix) {
      const t = db.transaction(IMAGES, "readwrite");
      t.objectStore(IMAGES).delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
      await done(t);
    },
    async keys() {
      return (await result(db.transaction(IMAGES).objectStore(IMAGES).getAllKeys())) as string[];
    },
  };
  return {
    getDb: () => kvGet("db"),
    putDb: (b) => kvPut("db", b),
    getSecret: () => kvGet("secret"),
    putSecret: (b) => kvPut("secret", b),
    images,
    async replaceAll(bytes, map) {
      const t = db.transaction([KV, IMAGES], "readwrite");
      const img = t.objectStore(IMAGES);
      img.clear();
      for (const [k, v] of map) img.put(plain(v), k);
      t.objectStore(KV).put(plain(bytes), "db");
      await done(t);
    },
  };
}

/** Same contract in memory – used by the tests. */
export function memoryStore(): LocalStore {
  const kv = new Map<string, Uint8Array>();
  let img = new Map<string, Uint8Array>();
  return {
    getDb: async () => kv.get("db"),
    putDb: async (b) => void kv.set("db", new Uint8Array(b)),
    getSecret: async () => kv.get("secret"),
    putSecret: async (b) => void kv.set("secret", new Uint8Array(b)),
    images: {
      put: async (k, b) => void img.set(k, new Uint8Array(b)),
      get: async (k) => img.get(k),
      delete: async (keys) => keys.forEach((k) => img.delete(k)),
      deletePrefix: async (p) => [...img.keys()].filter((k) => k.startsWith(p)).forEach((k) => img.delete(k)),
      keys: async () => [...img.keys()],
    },
    async replaceAll(bytes, map) {
      img = new Map([...map].map(([k, v]) => [k, new Uint8Array(v)]));
      kv.set("db", new Uint8Array(bytes));
    },
  };
}
