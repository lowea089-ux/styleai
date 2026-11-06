// Replaces server/tryon.ts in the browser bundle. There is no server that could keep the Decart key secret:
// the key is the person's own and already stored in their browser, so the page simply receives it.
import type { AppConfig } from "../../server/config";

export const tryonModels = (cfg: AppConfig) => [...new Set([cfg.tryonModel, "lucy-vton-latest", "lucy-vton-3.6", "lucy-vton-3.5"])];

export async function mintTryonToken(
  _cfg: AppConfig,
  apiKey: string,
  opts: { expiresIn: number; maxSessionSeconds: number },
): Promise<{ apiKey: string; expiresAt: string }> {
  return { apiKey, expiresAt: new Date(Date.now() + opts.expiresIn * 1000).toISOString() };
}
