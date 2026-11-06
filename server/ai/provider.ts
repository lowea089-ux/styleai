// Provider-neutral AI interface. Swap the implementation without touching routes or the engine.
import type { ExplainOutput, GarmentAnalysis, StylistOutput } from "./schemas";

export type ProviderId = "anthropic" | "groq" | "gemini" | "openai_compatible";

export type AiErrorCode =
  | "AI_UNAVAILABLE"
  | "AI_CONSENT_REQUIRED"
  | "AI_LIMIT_REACHED"
  | "AI_RATE_LIMIT"
  | "AI_TIMEOUT"
  | "AI_INVALID_RESPONSE"
  | "AI_REFUSED"
  | "AI_ERROR";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiResult<T> {
  data: T;
  usage: AiUsage;
}

export interface ExplainCandidate {
  id: string;
  ruleScore: number;
  items: { role: string; name: string; category: string; colors: string[]; pattern: string; material: string | null; styles: string[]; fit: string | null }[];
}

export interface ExplainInput {
  styles: string[];
  customStyle: string | null;
  occasion: string | null;
  customOccasion: string | null;
  weather: string | null;
  boldness: number;
  experimental: number;
  count: number;
  candidates: ExplainCandidate[];
}

export interface StylistInput {
  message: string;
  wardrobe: { id: string; name: string; category: string; colors: string[]; status: string }[];
  preferredStyles: string[];
  weather: string | null;
  today: string;
}

export interface AiProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly visionModel: string;
  readonly textModel: string;
  analyzeGarments(jpeg: Buffer): Promise<AiResult<GarmentAnalysis>>;
  explainOutfits(input: ExplainInput): Promise<AiResult<ExplainOutput>>;
  interpretStylistMessage(input: StylistInput): Promise<AiResult<StylistOutput>>;
  /** Tiny structured request to verify key, model and JSON support. */
  testConnection(): Promise<AiResult<{ ok: boolean }>>;
}
