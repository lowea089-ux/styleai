import { ApiError } from "./api";

/** Saves a blob as a file download. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Downloads an API response as a file. Goes through fetch instead of a plain link, so it also works in the
 * browser edition, where only the app's own requests reach the local service-worker server.
 */
export async function downloadFrom(url: string, fallbackName: string) {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK", "Keine Verbindung. Bitte erneut versuchen.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? `Fehler ${res.status}`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  saveBlob(await res.blob(), name);
}
