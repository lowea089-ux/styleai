// Exercises the real Claude provider code against a simulated HTTP layer (no API key, no network).
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../server/ai/anthropic";
import { AiError } from "../server/ai/provider";

const validAnalysis = {
  items: [
    {
      categoryKey: "tshirt",
      subtype: null,
      name: "Weißes T-Shirt",
      pattern: "uni",
      colorNames: ["weiss"],
      material: "Baumwolle",
      materialConfidence: "mittel",
      fit: null,
      styles: ["casual"],
      seasons: [],
      occasions: ["alltag"],
      formality: 1.5,
      warmth: 1,
      description: "Schlichtes T-Shirt.",
      brand: null,
      bbox: null,
      confidence: "hoch",
    },
  ],
  imageQuality: "gut",
  notes: null,
};

function message(text: string, stop = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}

function fakeFetch(responses: (() => Response)[]) {
  const calls: { url: string; body: any; headers: Headers }[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers as HeadersInit) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return next();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });

describe("AnthropicProvider", () => {
  it("sends a structured-output request with image, effort and refusal fallback", async () => {
    const f = fakeFetch([json(message(JSON.stringify(validAnalysis)))]);
    const p = new AnthropicProvider("test-key", "claude-opus-5-5", "claude-opus-5-5", 10_000, { fetch: f.fn, maxRetries: 0 });
    const r = await p.analyzeGarments(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(r.data.items[0].name).toBe("Weißes T-Shirt");
    expect(r.usage).toEqual({ model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 300 });

    const { body, headers, url } = f.calls[0];
    expect(url).toMatch(/\/v1\/messages/);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.output_config.effort).toBe("low");
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.messages[0].content[0].type).toBe("image");
    expect(body.messages[0].content[0].source.media_type).toBe("image/jpeg");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
  });

  it("does not request server-side fallback on Haiku", async () => {
    const f = fakeFetch([json(message(JSON.stringify(validAnalysis)))]);
    const p = new AnthropicProvider("k", "claude-haiku-5-5", "claude-haiku-5-5", 10_000, { fetch: f.fn, maxRetries: 0 });
    await p.analyzeGarments(Buffer.from([1, 2, 3]));
    expect(f.calls[0].body).not.toHaveProperty("fallbacks");
  });

  it("retries once on invalid JSON, then reports a clear error", async () => {
    const f = fakeFetch([json(message("das ist kein json")), json(message('{"items": "falsch"}'))]);
    const p = new AnthropicProvider("k", "claude-opus-5-5", "claude-opus-5-5", 10_000, { fetch: f.fn, maxRetries: 0 });
    await expect(p.analyzeGarments(Buffer.from([1]))).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(f.calls).toHaveLength(2);
  });

  it("recovers when the second attempt is valid", async () => {
    const f = fakeFetch([json(message("{kaputt")), json(message(JSON.stringify(validAnalysis)))]);
    const p = new AnthropicProvider("k", "claude-opus-5-5", "claude-opus-5-5", 10_000, { fetch: f.fn, maxRetries: 0 });
    const r = await p.analyzeGarments(Buffer.from([1]));
    expect(r.data.items).toHaveLength(1);
  });

  it("maps refusals and HTTP errors to typed AI errors", async () => {
    const refusal = fakeFetch([json({ ...message(""), stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } })]);
    await expect(new AnthropicProvider("k", "claude-opus-5-5", "claude-opus-5-5", 10_000, { fetch: refusal.fn, maxRetries: 0 }).analyzeGarments(Buffer.from([1]))).rejects.toMatchObject({
      code: "AI_REFUSED",
    });

    const unauthorized = fakeFetch([json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401)]);
    const e1 = await new AnthropicProvider("bad", "claude-opus-5-5", "claude-opus-5-5", 10_000, { fetch: unauthorized.fn, maxRetries: 0 }).analyzeGarments(Buffer.from([1])).catch((e) => e);
    expect(e1).toBeInstanceOf(AiError);
    expect(e1.code).toBe("AI_UNAVAILABLE");

    const limited = fakeFetch([json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429)]);
    const e2 = await new AnthropicProvider("k", "claude-opus-5-5", "claude-opus-5-5", 10_000, { fetch: limited.fn, maxRetries: 0 }).analyzeGarments(Buffer.from([1])).catch((e) => e);
    expect(e2.code).toBe("AI_RATE_LIMIT");
    expect(e2.retryable).toBe(true);
  });

  it("puts the wardrobe in a cacheable block for the stylist", async () => {
    const out = {
      intent: "outfit",
      reply: "ok",
      styles: [],
      customStyle: null,
      occasion: null,
      customOccasion: null,
      colors: [],
      mustIncludeItemIds: [],
      excludeItemIds: [],
      formality: null,
      boldness: null,
      experimental: null,
      temperatureC: null,
      rain: null,
      count: null,
    };
    const f = fakeFetch([json(message(JSON.stringify(out)))]);
    const p = new AnthropicProvider("k", "claude-opus-5-5", "claude-opus-5-5", 10_000, { fetch: f.fn, maxRetries: 0 });
    await p.interpretStylistMessage({ message: "Hi", wardrobe: [{ id: "a", name: "Jeans", category: "Jeans", colors: ["Blau"], status: "available" }], preferredStyles: [], weather: null, today: "2026-10-27" });
    const content = f.calls[0].body.messages[0].content;
    expect(content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(content[0].text).toContain("a | Jeans");
  });
});
