// Catalog of supported providers and a factory. Default models were checked against the provider docs on 2026-10-28.
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { AiProvider, ProviderId } from "./provider";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultVisionModel: string | null;
  defaultTextModel: string | null;
  baseUrl: string | null;
  keyUrl: string | null;
  note: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    defaultVisionModel: "claude-opus-5-5",
    defaultTextModel: "claude-opus-5-5",
    baseUrl: null,
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "Beste Qualität. Günstiger: claude-sonnet-5-5 oder claude-haiku-5-5.",
  },
  groq: {
    id: "groq",
    label: "Groq",
    defaultVisionModel: "qwen/qwen3.8-27b",
    defaultTextModel: "openai/gpt-oss-120b",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    note: "Sehr schnell und günstig. Bildanalyse nur mit Vision-Modellen (z. B. qwen/qwen3.8-27b, Vorschau-Modell).",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    defaultVisionModel: "gemini-3.8-flash",
    defaultTextModel: "gemini-3.8-flash",
    baseUrl: null,
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Gutes Preis-Leistungs-Verhältnis. Günstiger: gemini-3.5-flash-lite.",
  },
  openai_compatible: {
    id: "openai_compatible",
    label: "OpenAI-kompatibel (eigene URL)",
    defaultVisionModel: null,
    defaultTextModel: null,
    baseUrl: null,
    keyUrl: null,
    note: "Für jede API mit /chat/completions, z. B. OpenAI, OpenRouter oder ein lokales Modell (LM Studio, Ollama).",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export interface ProviderSettings {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string | null;
  visionModel: string | null;
  textModel: string | null;
}

export function createProvider(s: ProviderSettings, timeoutMs: number, opts: { fetch?: typeof fetch } = {}): AiProvider {
  const info = PROVIDERS[s.provider];
  const vision = s.visionModel || info.defaultVisionModel;
  const text = s.textModel || info.defaultTextModel || vision;
  if (!vision || !text) throw new Error("Für diesen Anbieter müssen Modelle angegeben werden.");
  switch (s.provider) {
    case "anthropic":
      return new AnthropicProvider(s.apiKey, vision, text, timeoutMs, { fetch: opts.fetch });
    case "gemini":
      return new GeminiProvider(s.apiKey, vision, text, timeoutMs);
    case "groq":
      return new OpenAICompatibleProvider("groq", info.label, s.apiKey, info.baseUrl!, vision, text, timeoutMs, opts.fetch);
    case "openai_compatible": {
      if (!s.baseUrl) throw new Error("Für einen OpenAI-kompatiblen Anbieter wird eine URL benötigt.");
      let host = s.baseUrl;
      try {
        host = new URL(s.baseUrl).host;
      } catch {
        /* validated before saving */
      }
      return new OpenAICompatibleProvider("openai_compatible", `OpenAI-kompatibel (${host})`, s.apiKey, s.baseUrl, vision, text, timeoutMs, opts.fetch);
    }
  }
}
