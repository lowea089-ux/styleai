import type { AppConfig } from "../server/config";

/** Configuration of the browser edition: one person, own keys only, no operator services. */
export function webConfig(secretKey: Uint8Array): AppConfig {
  return {
    port: 0,
    host: undefined,
    dataDir: "local",
    clientDir: "local",
    production: true,
    desktop: false,
    secretKey: secretKey as AppConfig["secretKey"],
    appOrigin: null,
    serverAi: null,
    // Requests leave from the person's own browser, so a custom AI URL (e.g. LM Studio) cannot reach anything
    // they could not reach anyway.
    allowCustomAiBaseUrl: true,
    aiDailyImageLimit: 60,
    aiDailyTextLimit: 120,
    aiTimeoutMs: 60_000,
    bgProvider: null,
    photoroomKey: null,
    removebgKey: null,
    openMeteoKey: null,
    maxUploadBytes: 12 * 1024 * 1024,
    decartApiKey: null,
    decartBaseUrl: "https://api.decart.ai",
    tryonModel: "lucy-vton-latest",
    tryonDailySessions: 20,
    registrationCode: null,
  };
}
