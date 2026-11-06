// Groq/OpenAI-compatible and Gemini providers against simulated HTTP (no keys, no network).
import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { retryTiming } from "../server/ai/base";
import { GeminiProvider } from "../server/ai/gemini";
import { OpenAICompatibleProvider } from "../server/ai/openai-compatible";
import { AiError } from "../server/ai/provider";
import { createProvider, PROVIDERS } from "../server/ai/registry";
import { decryptSecret, encryptSecret, keyHint } from "../server/secrets";

beforeAll(() => {
  retryTiming.scale = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const analysis = {
  items: [
    {
      categoryKey: "jeans",
      subtype: null,
      name: "Blaue Jeans",
      pattern: "uni",
      colorNames: ["jeansblau"],
      material: "Denim",
      materialConfidence: "hoch",
      fit: "normal",
      styles: ["casual"],
      seasons: [],
      occasions: ["alltag"],
      formality: 2,
      warmth: 2,
      description: "Gerade geschnittene Jeans.",
      brand: null,
      bbox: null,
      confidence: "hoch",
    },
  ],
  imageQuality: "gut",
  notes: null,
};

type Call = { url: string; init: RequestInit; body: any; headers: Headers };
function fakeFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const req = url instanceof Request ? url : null;
    const bodyText = init.body ? String(init.body) : req ? await req.clone().text() : "";
    calls.push({ url: String(req ? req.url : url), init, body: bodyText ? JSON.parse(bodyText) : null, headers: new Headers(init.headers ?? req?.headers) });
    return responses[Math.min(calls.length - 1, responses.length - 1)]();
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const chat = (content: string, finish = "stop") => ({
  model: "openai/gpt-oss-120b",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
  usage: { prompt_tokens: 900, completion_tokens: 120 },
});

describe("Groq (OpenAI-compatible)", () => {
  const groq = (f: typeof fetch) => new OpenAICompatibleProvider("groq", "Groq", "gsk_test", PROVIDERS.groq.baseUrl!, "qwen/qwen3.8-27b", "openai/gpt-oss-120b", 10_000, f);

  it("sends strict json_schema output with the image as data URL", async () => {
    const f = fakeFetch([json(chat(JSON.stringify(analysis)))]);
    const r = await groq(f.fn).analyzeGarments(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.data.items[0].name).toBe("Blaue Jeans");
    expect(r.usage).toEqual({ model: "openai/gpt-oss-120b", inputTokens: 900, outputTokens: 120 });
    const call = f.calls[0];
    expect(call.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(call.headers.get("authorization")).toBe("Bearer gsk_test");
    expect(call.body.model).toBe("qwen/qwen3.8-27b");
    expect(call.body.response_format.type).toBe("json_schema");
    expect(call.body.response_format.json_schema.strict).toBe(true);
    expect(call.body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(call.body.messages[0].role).toBe("system");
    const parts = call.body.messages[1].content;
    expect(parts[0].type).toBe("image_url");
    expect(parts[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("uses the text model for text tasks", async () => {
    const f = fakeFetch([json(chat('{"ok": true}'))]);
    await groq(f.fn).testConnection();
    expect(f.calls[0].body.model).toBe("openai/gpt-oss-120b");
  });

  it("falls back to JSON mode when strict schemas are rejected", async () => {
    const f = fakeFetch([json({ error: { message: "response_format json_schema not supported" } }, 400), json(chat(JSON.stringify(analysis)))]);
    const p = groq(f.fn);
    const r = await p.analyzeGarments(Buffer.from([1]));
    expect(r.data.items).toHaveLength(1);
    expect(f.calls[1].body.response_format).toEqual({ type: "json_object" });
    expect(f.calls[1].body.messages[0].content).toContain("JSON-Schema");
  });

  it("strips leaked reasoning and code fences", async () => {
    const f = fakeFetch([json(chat('<think>hmm</think>\n```json\n{"ok": true}\n```'))]);
    expect((await groq(f.fn).testConnection()).data.ok).toBe(true);
  });

  it("retries on 429 and 5xx, then succeeds", async () => {
    const f = fakeFetch([json({ error: {} }, 429, { "retry-after": "1" }), json({ error: {} }, 503), json(chat('{"ok": true}'))]);
    expect((await groq(f.fn).testConnection()).data.ok).toBe(true);
    expect(f.calls).toHaveLength(3);
  });

  it("maps invalid keys and unknown models to clear errors", async () => {
    const e1 = await groq(fakeFetch([json({ error: { message: "Invalid API Key" } }, 401)]).fn).testConnection().catch((e) => e);
    expect(e1).toBeInstanceOf(AiError);
    expect(e1.code).toBe("AI_UNAVAILABLE");
    expect(e1.message).toMatch(/Schlüssel/);
    const e2 = await groq(fakeFetch([json({ error: {} }, 404)]).fn).testConnection().catch((e) => e);
    expect(e2.message).toMatch(/Modell/);
  });

  it("reports truncated answers and content filters", async () => {
    const cut = await groq(fakeFetch([json(chat('{"ok":', "length"))]).fn).testConnection().catch((e) => e);
    expect(cut.code).toBe("AI_INVALID_RESPONSE");
    const filtered = await groq(fakeFetch([json(chat("", "content_filter"))]).fn).testConnection().catch((e) => e);
    expect(filtered.code).toBe("AI_REFUSED");
  });

  it("omits the authorization header for keyless local servers", async () => {
    const f = fakeFetch([json(chat('{"ok": true}'))]);
    const p = createProvider({ provider: "openai_compatible", apiKey: "", baseUrl: "http://localhost:1234/v1/", visionModel: "local-vl", textModel: null }, 10_000, { fetch: f.fn });
    await p.testConnection();
    expect(f.calls[0].url).toBe("http://localhost:1234/v1/chat/completions");
    expect(f.calls[0].headers.has("authorization")).toBe(false);
    expect(f.calls[0].body.model).toBe("local-vl");
  });
});

describe("Google Gemini", () => {
  const gemini = () => new GeminiProvider("AIza-test-key", "gemini-3.8-flash", "gemini-3.5-flash-lite", 10_000);
  const candidate = (text: string, finishReason = "STOP") => ({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason, index: 0 }],
    usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 80, thoughtsTokenCount: 20, totalTokenCount: 800 },
    modelVersion: "gemini-3.8-flash",
  });

  it("calls generateContent with JSON schema, system instruction and inline image", async () => {
    const f = fakeFetch([json(candidate(JSON.stringify(analysis)))]);
    vi.stubGlobal("fetch", f.fn);
    const r = await gemini().analyzeGarments(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.data.items[0].categoryKey).toBe("jeans");
    expect(r.usage).toEqual({ model: "gemini-3.8-flash", inputTokens: 700, outputTokens: 100 });
    const call = f.calls[0];
    expect(call.url).toContain("models/gemini-3.8-flash:generateContent");
    expect(call.headers.get("x-goog-api-key")).toBe("AIza-test-key");
    expect(call.body.generationConfig.responseMimeType).toBe("application/json");
    expect(call.body.generationConfig.responseJsonSchema.type).toBe("object");
    expect(call.body.systemInstruction).toBeDefined();
    const parts = call.body.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe("image/jpeg");
  });

  it("uses the text model for text tasks", async () => {
    const f = fakeFetch([json(candidate('{"ok": true}'))]);
    vi.stubGlobal("fetch", f.fn);
    await gemini().testConnection();
    expect(f.calls[0].url).toContain("models/gemini-3.5-flash-lite:generateContent");
  });

  it("treats safety stops as refusals", async () => {
    vi.stubGlobal("fetch", fakeFetch([json(candidate("", "SAFETY"))]).fn);
    const e = await gemini().testConnection().catch((x) => x);
    expect(e.code).toBe("AI_REFUSED");
  });

  it("maps an invalid key to a clear error", async () => {
    vi.stubGlobal("fetch", fakeFetch([json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, 400)]).fn);
    const e = await gemini().testConnection().catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe("AI_UNAVAILABLE");
  });

  it("retries on rate limits", async () => {
    const f = fakeFetch([json({ error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } }, 429), json(candidate('{"ok": true}'))]);
    vi.stubGlobal("fetch", f.fn);
    expect((await gemini().testConnection()).data.ok).toBe(true);
    expect(f.calls).toHaveLength(2);
  });
});

describe("registry", () => {
  it("uses documented default models", () => {
    const p = createProvider({ provider: "groq", apiKey: "k", baseUrl: null, visionModel: null, textModel: null }, 1000);
    expect(p.visionModel).toBe("qwen/qwen3.8-27b");
    expect(p.textModel).toBe("openai/gpt-oss-120b");
    const g = createProvider({ provider: "gemini", apiKey: "k", baseUrl: null, visionModel: "gemini-3.5-flash-lite", textModel: null }, 1000);
    expect(g.visionModel).toBe("gemini-3.5-flash-lite");
    expect(g.textModel).toBe("gemini-3.8-flash");
  });

  it("requires a base URL and models for custom endpoints", () => {
    expect(() => createProvider({ provider: "openai_compatible", apiKey: "", baseUrl: null, visionModel: "m", textModel: null }, 1000)).toThrow();
    expect(() => createProvider({ provider: "openai_compatible", apiKey: "", baseUrl: "https://x.example/v1", visionModel: null, textModel: null }, 1000)).toThrow();
  });
});

describe("secrets", () => {
  const key = randomBytes(32);

  it("round-trips and never stores the plain key", () => {
    const blob = encryptSecret("gsk_supersecret_1234", key);
    expect(blob).not.toContain("supersecret");
    expect(decryptSecret(blob, key)).toBe("gsk_supersecret_1234");
    expect(encryptSecret("gsk_supersecret_1234", key)).not.toBe(blob); // random IV
  });

  it("detects tampering and wrong keys", () => {
    const blob = encryptSecret("abc", key);
    const parts = blob.split(":");
    parts[3] = Buffer.from("xyz").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
  });

  it("shows only a short hint", () => {
    expect(keyHint("gsk_abcdefghijklmnop1234")).toBe("gsk…1234");
    expect(keyHint("short")).toBe("••••");
  });
});
