// Realistic live try-on via Decart (Lucy VTON). The API key never leaves the server: the browser gets a
// client token that expires quickly, only works for the try-on models and caps the session length on
// Decart's side (cost control even if the browser misbehaves).
import { z } from "zod";
import type { AppConfig } from "./config";
import { HttpError } from "./http";

const tokenResponse = z.object({ apiKey: z.string().min(8), expiresAt: z.string() });

/** Alias plus the canonical versions it may resolve to, so a pinned or "latest" model both pass. */
export const tryonModels = (cfg: AppConfig) => [...new Set([cfg.tryonModel, "lucy-vton-latest", "lucy-vton-3.6", "lucy-vton-3.5"])];

export async function mintTryonToken(
  cfg: AppConfig,
  apiKey: string,
  opts: { expiresIn: number; maxSessionSeconds: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ apiKey: string; expiresAt: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.decartBaseUrl}/v1/client/tokens`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        expiresIn: opts.expiresIn,
        allowedModels: tryonModels(cfg),
        constraints: { realtime: { maxSessionDuration: opts.maxSessionSeconds } },
        metadata: { app: "styleai" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "DECART_UNREACHABLE", "Decart ist gerade nicht erreichbar. Bitte prüfe die Internetverbindung und versuche es erneut.");
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(400, "DECART_KEY_INVALID", "Decart hat den API-Schlüssel abgelehnt. Bitte den Schlüssel prüfen.");
  if (res.status === 402) throw new HttpError(422, "DECART_NO_CREDITS", "Das Guthaben im Decart-Konto ist aufgebraucht.");
  if (res.status === 429) throw new HttpError(429, "DECART_RATE_LIMIT", "Decart begrenzt gerade die Anfragen. Bitte kurz warten.");
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { detail?: unknown }) => (typeof b.detail === "string" ? b.detail.slice(0, 160) : ""))
      .catch(() => "");
    throw new HttpError(502, "DECART_ERROR", `Decart hat die Anfrage abgelehnt (${res.status})${detail ? `: ${detail}` : ""}.`);
  }
  const parsed = tokenResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new HttpError(502, "DECART_ERROR", "Decart hat eine unerwartete Antwort geschickt.");
  return parsed.data;
}
