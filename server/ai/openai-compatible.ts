// OpenAI-compatible Chat Completions provider (Groq and any other compatible endpoint).
// Groq docs: https://console.groq.com/docs/structured-outputs · https://console.groq.com/docs/vision
import { BaseProvider, withRetries, type Completion, type CompletionRequest } from "./base";
import { AiError, type ProviderId } from "./provider";

class HttpStatusError extends Error {
  constructor(
    public status: number,
    public body: string,
    public retryAfter: number | null,
  ) {
    super(`HTTP ${status}`);
  }
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatibleProvider extends BaseProvider {
  /** Falls back to `json_object` once a server rejects `json_schema` (older or local models). */
  private schemaMode: "json_schema" | "json_object" = "json_schema";

  constructor(
    readonly id: ProviderId,
    readonly name: string,
    private apiKey: string,
    private baseUrl: string,
    visionModel: string,
    textModel: string,
    private timeoutMs: number,
    private fetchImpl: typeof fetch = fetch,
  ) {
    super(visionModel, textModel);
  }

  protected async complete(req: CompletionRequest): Promise<Completion> {
    try {
      return await this.send(req, this.schemaMode);
    } catch (e) {
      // A 400 in strict mode usually means the model has no structured-output support: retry in JSON mode.
      if (e instanceof HttpStatusError && e.status === 400 && this.schemaMode === "json_schema") {
        this.schemaMode = "json_object";
        try {
          return await this.send(req, "json_object");
        } catch (e2) {
          throw this.mapError(e2);
        }
      }
      throw this.mapError(e);
    }
  }

  private async send(req: CompletionRequest, mode: "json_schema" | "json_object"): Promise<Completion> {
    const userContent: unknown[] = req.texts.map((text) => ({ type: "text", text }));
    if (req.image) userContent.unshift({ type: "image_url", image_url: { url: `data:${req.image.mediaType};base64,${req.image.data.toString("base64")}` } });
    const system =
      mode === "json_object"
        ? `${req.system}\n\nAntworte ausschließlich mit einem JSON-Objekt, das genau diesem JSON-Schema entspricht:\n${JSON.stringify(req.jsonSchema)}`
        : req.system;
    const body = {
      model: req.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      response_format: mode === "json_schema" ? { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } } : { type: "json_object" },
    };

    const data = await withRetries(
      async () => {
        const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          const ra = Number(res.headers.get("retry-after"));
          throw new HttpStatusError(res.status, (await res.text().catch(() => "")).slice(0, 500), Number.isFinite(ra) && ra > 0 ? ra : null);
        }
        return (await res.json()) as ChatResponse;
      },
      (e) => {
        if (e instanceof HttpStatusError) {
          if (e.status === 429) return Math.min(5000, (e.retryAfter ?? 1) * 1000);
          return e.status >= 500 ? 800 : null;
        }
        return e instanceof Error && e.name === "TimeoutError" ? null : 800;
      },
    );

    const choice = data.choices?.[0];
    const finish = choice?.finish_reason ?? "stop";
    return {
      text: choice?.message?.content ?? "",
      usage: { model: data.model ?? req.model, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      stop: choice?.message?.refusal || finish === "content_filter" ? "refusal" : finish === "length" ? "max_tokens" : "end",
    };
  }

  private mapError(e: unknown): AiError {
    if (e instanceof AiError) return e;
    if (e instanceof HttpStatusError) {
      if (e.status === 401 || e.status === 403) return new AiError("AI_UNAVAILABLE", `${this.name}: API-Schlüssel ungültig oder ohne Berechtigung.`);
      if (e.status === 404) return new AiError("AI_UNAVAILABLE", `${this.name}: Das gewählte Modell oder die URL existiert nicht.`);
      if (e.status === 429) return new AiError("AI_RATE_LIMIT", `${this.name} ist gerade ausgelastet oder das Kontingent ist erschöpft.`, true);
      if (e.status === 400 || e.status === 422) return new AiError("AI_ERROR", `${this.name} hat die Anfrage abgelehnt (${e.status}). Unterstützt das Modell Bilder bzw. JSON-Ausgaben?`);
      return new AiError("AI_ERROR", `${this.name} meldet einen Fehler (${e.status}).`, true);
    }
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return new AiError("AI_TIMEOUT", `${this.name} hat nicht rechtzeitig geantwortet.`, true);
    return new AiError("AI_UNAVAILABLE", `${this.name} ist nicht erreichbar.`, true);
  }
}
