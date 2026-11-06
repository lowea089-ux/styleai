import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDeps, createApp } from "../server/app";
import { loadConfig, type AppConfig } from "../server/config";

type App = ReturnType<typeof createApp>;
const ORIGIN = "http://localhost";

interface DecartCall {
  url: string;
  apiKey: string | null;
  body: { expiresIn: number; allowedModels: string[]; constraints: { realtime: { maxSessionDuration: number } } };
}

/** Fake Decart token endpoint: accepts keys starting with "dk_ok", records every call. */
function fakeDecart(calls: DecartCall[], status = 200) {
  return (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call = { url: String(url), apiKey: headers.get("x-api-key"), body: JSON.parse(String(init?.body)) };
    calls.push(call);
    if (status !== 200) return new Response(JSON.stringify({ detail: "nope" }), { status });
    if (!call.apiKey?.startsWith("dk_ok")) return new Response(JSON.stringify({ detail: "Invalid API key" }), { status: 401 });
    return Response.json({ apiKey: `ek_client_${calls.length}`, token: "jwt", expiresAt: "2026-11-05T12:02:00Z" });
  }) as typeof fetch;
}

function setup(fetchImpl: typeof fetch, cfg: Partial<AppConfig> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "styleai-tryon-"));
  const deps = buildDeps(loadConfig({ dataDir: dir, serverAi: null, decartApiKey: null, ...cfg }), { aiProvider: null, fetchImpl });
  return { app: createApp(deps), deps };
}

class Client {
  cookie = "";
  constructor(private app: App) {}
  async json<T = any>(method: string, url: string, body?: unknown) {
    const h: Record<string, string> = { origin: ORIGIN };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await this.app.request(ORIGIN + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const m = res.headers.get("set-cookie")?.match(/styleai_session=([^;]*)/);
    if (m) this.cookie = m[1] ? `styleai_session=${m[1]}` : "";
    return { status: res.status, body: (await res.json()) as T };
  }
}

async function register(app: App, email: string) {
  const c = new Client(app);
  const r = await c.json("POST", "/api/auth/register", { email, password: "sicheres-passwort-123", displayName: "Test" });
  expect(r.status).toBe(201);
  return c;
}

describe("realistic live try-on (Decart)", () => {
  it("is unavailable without a key and requires consent", async () => {
    const calls: DecartCall[] = [];
    const { app } = setup(fakeDecart(calls));
    const c = await register(app, "a@example.test");
    const s = await c.json("GET", "/api/tryon/status");
    expect(s.body).toMatchObject({ available: false, source: null, consent: false, maxSessionSeconds: 60 });
    expect((await c.json("POST", "/api/tryon/token")).status).toBe(403);
    expect((await c.json("PUT", "/api/tryon/settings", { apiKey: "dk_ok_secret_1234" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("checks and stores an own key encrypted, never returns it, and mints capped client tokens", async () => {
    const calls: DecartCall[] = [];
    const { app, deps } = setup(fakeDecart(calls));
    const c = await register(app, "b@example.test");

    const bad = await c.json("PUT", "/api/tryon/settings", { apiKey: "dk_wrong_9999", consent: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("DECART_KEY_INVALID");

    const saved = await c.json("PUT", "/api/tryon/settings", { apiKey: "dk_ok_secret_1234", maxSessionSeconds: 90, consent: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ available: true, source: "user", keyHint: "dk_…1234", consent: true, maxSessionSeconds: 90, remainingToday: null });
    expect(JSON.stringify(saved.body)).not.toContain("secret");
    const row = deps.db.prepare("SELECT api_key_enc FROM user_tryon_settings").get() as { api_key_enc: string };
    expect(row.api_key_enc).not.toContain("secret");

    const t = await c.json("POST", "/api/tryon/token");
    expect(t.status).toBe(200);
    expect(t.body.apiKey).toMatch(/^ek_client_/);
    expect(t.body.maxSessionSeconds).toBe(90);
    const last = calls.at(-1)!;
    expect(last.url).toBe("https://api.decart.ai/v1/client/tokens");
    expect(last.apiKey).toBe("dk_ok_secret_1234");
    expect(last.body.expiresIn).toBeLessThanOrEqual(120);
    expect(last.body.allowedModels).toContain("lucy-vton-latest");
    // Decart itself ends the session after the chosen length.
    expect(last.body.constraints.realtime.maxSessionDuration).toBe(90);

    // Changing only the session length keeps the stored key.
    const shorter = await c.json("PUT", "/api/tryon/settings", { maxSessionSeconds: 30, consent: true });
    expect(shorter.body).toMatchObject({ source: "user", maxSessionSeconds: 30 });

    // Removing withdraws key and consent.
    const removed = await c.json("DELETE", "/api/tryon/settings");
    expect(removed.body).toMatchObject({ available: false, consent: false });
    expect((await c.json("POST", "/api/tryon/token")).status).toBe(403);
  });

  it("keeps keys per user", async () => {
    const calls: DecartCall[] = [];
    const { app } = setup(fakeDecart(calls));
    const a = await register(app, "c1@example.test");
    const b = await register(app, "c2@example.test");
    await a.json("PUT", "/api/tryon/settings", { apiKey: "dk_ok_user_a_1111", consent: true });
    await b.json("PUT", "/api/tryon/settings", { consent: true });
    expect((await b.json("GET", "/api/tryon/status")).body.available).toBe(false);
    expect((await b.json("POST", "/api/tryon/token")).status).toBe(503);
  });

  it("limits sessions per day on the operator key", async () => {
    const calls: DecartCall[] = [];
    const { app } = setup(fakeDecart(calls), { decartApiKey: "dk_ok_operator_0000", tryonDailySessions: 2 });
    const c = await register(app, "d@example.test");
    await c.json("PUT", "/api/tryon/settings", { consent: true });
    expect((await c.json("GET", "/api/tryon/status")).body).toMatchObject({ available: true, source: "server", keyHint: null, remainingToday: 2 });
    expect((await c.json("POST", "/api/tryon/token")).status).toBe(200);
    expect((await c.json("POST", "/api/tryon/token")).status).toBe(200);
    const third = await c.json("POST", "/api/tryon/token");
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("TRYON_LIMIT_REACHED");
    expect(calls.every((x) => x.apiKey === "dk_ok_operator_0000")).toBe(true);
  });

  it("explains Decart errors instead of failing silently", async () => {
    const credits = setup(fakeDecart([], 402), { decartApiKey: "dk_ok_operator_0000" });
    const c = await register(credits.app, "e@example.test");
    await c.json("PUT", "/api/tryon/settings", { consent: true });
    const r = await c.json("POST", "/api/tryon/token");
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("DECART_NO_CREDITS");

    const offline = setup((async () => Promise.reject(new Error("offline"))) as typeof fetch, { decartApiKey: "dk_ok_operator_0000" });
    const d = await register(offline.app, "f@example.test");
    await d.json("PUT", "/api/tryon/settings", { consent: true });
    const o = await d.json("POST", "/api/tryon/token");
    expect(o.status).toBe(502);
    expect(o.body.error.code).toBe("DECART_UNREACHABLE");
  });

  it("allows the Decart endpoints in the production CSP", async () => {
    const { app } = setup(fakeDecart([]), { production: true });
    const res = await app.request(ORIGIN + "/api/health");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("wss://*.decart.ai");
    expect(csp).toContain("'wasm-unsafe-eval'");
  });
});
