// The parts of node:crypto the server code uses, on top of Web Crypto and the audited @noble libraries
// (synchronous AES-GCM and SHA-256 are needed because the server code calls them synchronously).
import { gcm } from "@noble/ciphers/aes";
import { scryptAsync } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha2";
import { Buffer } from "buffer";

type Data = string | Uint8Array;
const bytes = (d: Data, enc?: string) => (typeof d === "string" ? Buffer.from(d, (enc as BufferEncoding | undefined) ?? "utf8") : d);

export const randomUUID = () => crypto.randomUUID();

export function randomBytes(n: number): Buffer {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  return b;
}

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Hash ${algorithm} wird nicht unterstützt.`);
  const h = sha256.create();
  const api = {
    update(d: Data, enc?: string) {
      h.update(bytes(d, enc));
      return api;
    },
    digest(enc?: "hex" | "base64" | "base64url") {
      const out = Buffer.from(h.digest());
      return enc ? out.toString(enc) : out;
    },
  };
  return api as { update(d: Data, enc?: string): typeof api; digest(): Buffer; digest(enc: "hex" | "base64" | "base64url"): string };
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function scrypt(
  password: string,
  salt: Uint8Array,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem?: number },
  cb: (err: Error | null, key: Buffer) => void,
) {
  scryptAsync(password, salt, { N: opts.N, r: opts.r, p: opts.p, dkLen: keylen, ...(opts.maxmem ? { maxmem: opts.maxmem } : {}) }).then(
    (k) => cb(null, Buffer.from(k)),
    (e: Error) => cb(e, Buffer.alloc(0)),
  );
}

function checkGcm(algorithm: string, key: Uint8Array) {
  if (algorithm !== "aes-256-gcm" || key.length !== 32) throw new Error("Nur aes-256-gcm wird unterstützt.");
}

export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  checkGcm(algorithm, key);
  const parts: Uint8Array[] = [];
  let tag: Buffer | null = null;
  return {
    update(d: Data, enc?: string) {
      parts.push(bytes(d, enc));
      return Buffer.alloc(0);
    },
    final() {
      const sealed = gcm(key, iv).encrypt(Buffer.concat(parts));
      tag = Buffer.from(sealed.subarray(sealed.length - 16));
      return Buffer.from(sealed.subarray(0, sealed.length - 16));
    },
    getAuthTag() {
      if (!tag) throw new Error("final() zuerst aufrufen");
      return tag;
    },
  };
}

export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  checkGcm(algorithm, key);
  const parts: Uint8Array[] = [];
  let tag: Uint8Array | null = null;
  return {
    setAuthTag(t: Uint8Array) {
      tag = t;
    },
    update(d: Data, enc?: string) {
      parts.push(bytes(d, enc));
      return Buffer.alloc(0);
    },
    final() {
      if (!tag) throw new Error("Authentifizierungs-Tag fehlt");
      return Buffer.from(gcm(key, iv).decrypt(Buffer.concat([...parts, tag])));
    },
  };
}
