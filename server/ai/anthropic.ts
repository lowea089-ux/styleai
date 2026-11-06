// Claude provider: structured outputs (JSON schema) via the official SDK.
import Anthropic from "@anthropic-ai/sdk";
import { BaseProvider, type Completion, type CompletionRequest } from "./base";
import { AiError } from "./provider";

// Server-side refusal fallback is available on the Opus/Fable 5.x line and Sonnet 5.5, not on Haiku.
const supportsFallback = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

export class AnthropicProvider extends BaseProvider {
  readonly id = "anthropic" as const;
  readonly name = "Anthropic Claude";
  private client: Anthropic;

  constructor(apiKey: string, visionModel: string, textModel: string, timeoutMs: number, opts: { fetch?: typeof fetch; maxRetries?: number } = {}) {
    super(visionModel, textModel);
    // The SDK retries 408/409/429/5xx and connection errors with exponential backoff.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: opts.maxRetries ?? 2, fetch: opts.fetch });
  }

  protected async complete(req: CompletionRequest): Promise<Completion> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.image) content.push({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.data.toString("base64") } });
    req.texts.forEach((text, i) => content.push(i === 0 && req.cacheFirst ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text }));
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content }],
        output_config: { effort: req.effort, format: { type: "json_schema", schema: req.jsonSchema } },
        ...(supportsFallback(req.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
    } catch (e) {
      throw mapError(e);
    }
    return {
      text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
      usage: { model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      stop: res.stop_reason === "refusal" ? "refusal" : res.stop_reason === "max_tokens" ? "max_tokens" : "end",
    };
  }
}

function mapError(e: unknown): AiError {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiError("AI_TIMEOUT", "Die KI hat nicht rechtzeitig geantwortet.", true);
  if (e instanceof Anthropic.AuthenticationError) return new AiError("AI_UNAVAILABLE", "Der KI-Zugang ist falsch konfiguriert (API-Schlüssel ungültig).");
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError("AI_UNAVAILABLE", "Der KI-Zugang hat keine Berechtigung für dieses Modell.");
  if (e instanceof Anthropic.RateLimitError) return new AiError("AI_RATE_LIMIT", "Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.", true);
  if (e instanceof Anthropic.NotFoundError) return new AiError("AI_UNAVAILABLE", "Das gewählte Claude-Modell existiert nicht.");
  if (e instanceof Anthropic.BadRequestError) return new AiError("AI_ERROR", "Die Anfrage an die KI war ungültig.");
  if (e instanceof Anthropic.APIConnectionError) return new AiError("AI_UNAVAILABLE", "Der KI-Dienst ist nicht erreichbar.", true);
  if (e instanceof Anthropic.APIError) return new AiError("AI_ERROR", `Der KI-Dienst meldet einen Fehler (${e.status ?? "?"}).`, true);
  return new AiError("AI_ERROR", "Unbekannter Fehler bei der KI-Anfrage.");
}
