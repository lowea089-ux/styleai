import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProviderId } from "./ai/provider";
import { PROVIDER_IDS, type ProviderSettings } from "./ai/registry";

if (existsSync(".env")) process.loadEnvFile(".env");

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export interface AppConfig {
  port: number;
  host: string | undefined;
  dataDir: string;
  clientDir: string;
  production: boolean;
  /** Packaged Electron app: single local user, plain-HTTP loopback, custom AI URLs allowed. */
  desktop: boolean;
  /** 32-byte key for encrypting stored API keys. From SESSION_SECRET or generated once in DATA_DIR. */
  secretKey: Buffer;
  appOrigin: string | null;
  /** AI provider configured by the operator (used when a user has no own key). */
  serverAi: ProviderSettings | null;
  allowCustomAiBaseUrl: boolean;
  aiDailyImageLimit: number;
  aiDailyTextLimit: number;
  aiTimeoutMs: number;
  bgProvider: "photoroom" | "removebg" | null;
  photoroomKey: string | null;
  removebgKey: string | null;
  openMeteoKey: string | null;
  maxUploadBytes: number;
  /** Operator key for the realistic live try-on (Decart); users can also store their own. */
  decartApiKey: string | null;
  decartBaseUrl: string;
  tryonModel: string;
  /** Sessions per user and day on the operator key. */
  tryonDailySessions: number;
  /** When set, new accounts need this invite code (keeps strangers off a public deployment). */
  registrationCode: string | null;
}

function serverAiFromEnv(): ProviderSettings | null {
  const keys: Record<ProviderId, string | null> = {
    anthropic: str(process.env.ANTHROPIC_API_KEY),
    groq: str(process.env.GROQ_API_KEY),
    gemini: str(process.env.GEMINI_API_KEY),
    openai_compatible: str(process.env.OPENAI_COMPAT_API_KEY),
  };
  const wanted = str(process.env.AI_PROVIDER) as ProviderId | null;
  if (wanted && !PROVIDER_IDS.includes(wanted)) throw new Error(`AI_PROVIDER "${wanted}" ist unbekannt. Erlaubt: ${PROVIDER_IDS.join(", ")}`);
  // Without AI_PROVIDER the first provider with a key wins.
  const provider = wanted ?? PROVIDER_IDS.find((p) => keys[p]) ?? null;
  if (!provider || !keys[provider]) return null;
  return {
    provider,
    apiKey: keys[provider]!,
    baseUrl: provider === "openai_compatible" ? str(process.env.OPENAI_COMPAT_BASE_URL) : null,
    visionModel: str(process.env.AI_MODEL_VISION),
    textModel: str(process.env.AI_MODEL_TEXT),
  };
}

function loadSecret(dataDir: string, production: boolean): Buffer {
  const env = process.env.SESSION_SECRET ?? "";
  if (env) {
    if (env.length < 32) throw new Error("SESSION_SECRET muss mindestens 32 Zeichen lang sein.");
    return createHash("sha256").update(env).digest();
  }
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, ".secret");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    if (production) console.warn("Kein SESSION_SECRET gesetzt – ein Schlüssel wurde in DATA_DIR/.secret erzeugt. Diese Datei mit sichern!");
  }
  return createHash("sha256").update(readFileSync(file, "utf8").trim()).digest();
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const desktop = process.env.STYLEAI_DESKTOP === "1";
  const production = desktop || process.env.NODE_ENV === "production";
  const bg = str(process.env.BG_REMOVAL_PROVIDER);
  const base = {
    // In development Vite owns PORT; the API uses API_PORT. Hosting platforms set PORT for the single production server.
    port: num(process.env.API_PORT ?? (production ? process.env.PORT : undefined), 8787),
    host: str(process.env.HOST) ?? (desktop ? "127.0.0.1" : undefined),
    dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
    clientDir: path.resolve(process.env.CLIENT_DIR ?? "./dist"),
    production,
    desktop,
    appOrigin: str(process.env.APP_ORIGIN),
    serverAi: serverAiFromEnv(),
    allowCustomAiBaseUrl: desktop || process.env.ALLOW_CUSTOM_AI_BASE_URL === "1",
    aiDailyImageLimit: num(process.env.AI_DAILY_IMAGE_LIMIT, 60),
    aiDailyTextLimit: num(process.env.AI_DAILY_TEXT_LIMIT, 120),
    aiTimeoutMs: num(process.env.AI_TIMEOUT_MS, 45_000),
    bgProvider: (bg === "photoroom" || bg === "removebg" ? bg : null) as AppConfig["bgProvider"],
    photoroomKey: str(process.env.PHOTOROOM_API_KEY),
    removebgKey: str(process.env.REMOVEBG_API_KEY),
    openMeteoKey: str(process.env.OPEN_METEO_API_KEY),
    maxUploadBytes: 12 * 1024 * 1024,
    decartApiKey: str(process.env.DECART_API_KEY),
    decartBaseUrl: str(process.env.DECART_BASE_URL) ?? "https://api.decart.ai",
    tryonModel: str(process.env.DECART_TRYON_MODEL) ?? "lucy-vton-latest",
    tryonDailySessions: num(process.env.TRYON_DAILY_SESSIONS, 20),
    registrationCode: str(process.env.REGISTRATION_CODE),
    ...overrides,
  };
  return { ...base, secretKey: overrides.secretKey ?? loadSecret(base.dataDir, base.production) };
}
