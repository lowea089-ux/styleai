// Google Gemini provider via the official SDK (models.generateContent + responseJsonSchema).
import { ApiError, GoogleGenAI } from "@google/genai";
import { BaseProvider, withRetries, type Completion, type CompletionRequest } from "./base";
import { AiError } from "./provider";

const REFUSAL_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);

export class GeminiProvider extends BaseProvider {
  readonly id = "gemini" as const;
  readonly name = "Google Gemini";
  private client: GoogleGenAI;

  constructor(apiKey: string, visionModel: string, textModel: string, timeoutMs: number) {
    super(visionModel, textModel);
    this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  }

  protected async complete(req: CompletionRequest): Promise<Completion> {
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = req.texts.map((text) => ({ text }));
    if (req.image) parts.unshift({ inlineData: { mimeType: req.image.mediaType, data: req.image.data.toString("base64") } });
    try {
      const res = await withRetries(
        () =>
          this.client.models.generateContent({
            model: req.model,
            contents: [{ role: "user", parts }],
            config: {
              systemInstruction: req.system,
              responseMimeType: "application/json",
              responseJsonSchema: req.jsonSchema,
              maxOutputTokens: req.maxTokens,
            },
          }),
        (e) => (e instanceof ApiError && (e.status === 429 || e.status >= 500) ? (e.status === 429 ? 2000 : 800) : null),
      );
      const candidate = res.candidates?.[0];
      const finish = String(candidate?.finishReason ?? "STOP");
      const blocked = !candidate && !!res.promptFeedback?.blockReason;
      const usage = res.usageMetadata;
      return {
        text: res.text ?? "",
        usage: {
          model: res.modelVersion ?? req.model,
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        },
        stop: blocked || REFUSAL_REASONS.has(finish) ? "refusal" : finish === "MAX_TOKENS" ? "max_tokens" : "end",
      };
    } catch (e) {
      throw mapError(e);
    }
  }
}

function mapError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof ApiError) {
    // Gemini answers an invalid key with 400 "API key not valid".
    if (e.status === 401 || e.status === 403 || (e.status === 400 && /api key/i.test(e.message))) return new AiError("AI_UNAVAILABLE", "Google Gemini: API-Schlüssel ungültig oder ohne Berechtigung.");
    if (e.status === 404) return new AiError("AI_UNAVAILABLE", "Google Gemini: Das gewählte Modell existiert nicht.");
    if (e.status === 429) return new AiError("AI_RATE_LIMIT", "Google Gemini ist ausgelastet oder das Kontingent ist erschöpft.", true);
    if (e.status === 400) return new AiError("AI_ERROR", "Google Gemini hat die Anfrage abgelehnt (400).");
    return new AiError("AI_ERROR", `Google Gemini meldet einen Fehler (${e.status}).`, true);
  }
  if (e instanceof Error && /timeout|aborted/i.test(`${e.name} ${e.message}`)) return new AiError("AI_TIMEOUT", "Google Gemini hat nicht rechtzeitig geantwortet.", true);
  return new AiError("AI_UNAVAILABLE", "Google Gemini ist nicht erreichbar.", true);
}
