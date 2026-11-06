// Realistic live try-on session with Decart Lucy VTON. The SDK (with LiveKit) is imported on demand, so it is
// only downloaded when someone starts a realistic try-on. The browser never sees the API key: every connect
// and reconnect fetches a fresh short-lived client token from our server.
import type { ConnectionState, RealTimeClient, RealTimeModels } from "@decartai/sdk";
import type { ClothingItem, TryonToken } from "../../../shared/types";
import { api } from "../api";

export interface LiveHandlers {
  onRemoteStream: (stream: MediaStream) => void;
  onState: (state: ConnectionState) => void;
  /** The server ended the session on purpose (credits, limits, moderation). */
  onEnded: (message: string) => void;
  onError: (message: string) => void;
  onCapacityWait: (seconds: number) => void;
}

export interface LiveSession {
  /** Session length granted by the server (Decart enforces it too). */
  maxSessionSeconds: number;
  setGarment: (image: Blob, prompt: string) => Promise<void>;
  disconnect: () => void;
}

const END_REASONS: Record<string, string> = {
  insufficient_credits: "Das Guthaben im Decart-Konto ist aufgebraucht.",
  session_limit: "Mit diesem Schlüssel läuft bereits eine andere Sitzung. Bitte die andere Sitzung beenden.",
  moderation_violation: "Decart hat die Sitzung aus Inhaltsgründen beendet.",
  policy_violation: "Decart hat die Verbindung abgelehnt.",
};

export const endMessage = (reason: string) => END_REASONS[reason] ?? "Die Sitzung wurde von Decart beendet.";

export async function startLiveSession(
  camera: MediaStream,
  model: string,
  initial: { image: Blob; prompt: string },
  h: LiveHandlers,
): Promise<LiveSession> {
  const { createDecartClient, models } = await import("@decartai/sdk");
  let token: TryonToken | null = null;
  const client = createDecartClient({
    apiKeyProvider: async () => {
      token = await api.post<TryonToken>("/api/tryon/token");
      return token.apiKey;
    },
    // No usage telemetry to Decart beyond what the session itself needs.
    telemetry: false,
  });
  const rt: RealTimeClient = await client.realtime.connect(camera, {
    model: models.realtime(model as RealTimeModels),
    onRemoteStream: h.onRemoteStream,
    onConnectionChange: h.onState,
    onCapacityWait: (w) => h.onCapacityWait(Math.max(1, Math.round(w.retryAfterMs / 1000))),
    capacityRetryBudgetMs: 30_000,
    initialState: { prompt: { text: initial.prompt, enhance: false }, image: initial.image },
  });
  rt.on("sessionEnded", ({ reason }) => h.onEnded(endMessage(reason)));
  rt.on("error", (e) => h.onError(e.message));
  return {
    maxSessionSeconds: (token as TryonToken | null)?.maxSessionSeconds ?? 60,
    setGarment: (image, prompt) => rt.setImage(image, { prompt, enhance: false, timeout: 30_000 }),
    disconnect: () => rt.disconnect(),
  };
}

async function loadBitmap(url: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Ein Kleidungsfoto konnte nicht geladen werden.");
  return createImageBitmap(await res.blob());
}

/**
 * Reference image for Lucy VTON: one garment, or top above bottom at 512 px width (as in Decart's
 * outfit-builder example), always on white because cut-outs are transparent.
 */
export async function garmentReference(items: ClothingItem[]): Promise<Blob> {
  const bmps = await Promise.all(items.map((i) => loadBitmap(i.imageUrl)));
  const c = document.createElement("canvas");
  if (bmps.length === 1) {
    const b = bmps[0];
    const s = Math.min(1, 1024 / Math.max(b.width, b.height));
    c.width = Math.round(b.width * s);
    c.height = Math.round(b.height * s);
  } else {
    c.width = 512;
    c.height = bmps.reduce((h, b) => h + Math.round((b.height * 512) / b.width), 0);
  }
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const b of bmps) {
    const h = bmps.length === 1 ? c.height : Math.round((b.height * 512) / b.width);
    ctx.drawImage(b, 0, y, c.width, h);
    y += h;
    b.close();
  }
  return new Promise((res, rej) => c.toBlob((blob) => (blob ? res(blob) : rej(new Error("Kleidungsbild konnte nicht erstellt werden."))), "image/jpeg", 0.9));
}
