// Optional server-side background removal through a paid API. The client-side heuristic is the default.
import type { AppConfig } from "./config";

export class BgRemovalError extends Error {
  constructor(
    public code: "BG_UNAVAILABLE" | "BG_FAILED" | "BG_RATE_LIMIT",
    message: string,
  ) {
    super(message);
  }
}

export function bgProviderName(cfg: AppConfig): string | null {
  if (cfg.bgProvider === "photoroom" && cfg.photoroomKey) return "Photoroom";
  if (cfg.bgProvider === "removebg" && cfg.removebgKey) return "remove.bg";
  return null;
}

export async function removeBackgroundRemote(cfg: AppConfig, jpeg: Buffer, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const provider = bgProviderName(cfg);
  if (!provider) throw new BgRemovalError("BG_UNAVAILABLE", "Kein Dienst für die Profi-Freistellung konfiguriert.");
  const form = new FormData();
  form.append("image_file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "image.jpg");
  let url: string;
  const headers: Record<string, string> = {};
  if (cfg.bgProvider === "photoroom") {
    // https://docs.photoroom.com/remove-background-api-basic-plan/quickstart-guide
    url = "https://sdk.photoroom.com/v1/segment";
    headers["x-api-key"] = cfg.photoroomKey!;
  } else {
    // https://www.remove.bg/api
    url = "https://api.remove.bg/v1.0/removebg";
    headers["X-Api-Key"] = cfg.removebgKey!;
    form.append("size", "auto");
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new BgRemovalError("BG_FAILED", `${provider} ist gerade nicht erreichbar.`);
  }
  if (res.status === 429) throw new BgRemovalError("BG_RATE_LIMIT", `${provider}: Limit erreicht, bitte später erneut versuchen.`);
  if (!res.ok) throw new BgRemovalError("BG_FAILED", `${provider} konnte das Bild nicht freistellen (Status ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
