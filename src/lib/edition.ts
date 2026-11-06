// Browser edition (GitHub Pages): no server. A service worker (web/sw.ts) answers /api/* with the StyleAI
// server running on data stored in this browser, and keeps the app available offline.
export const LOCAL_EDITION = import.meta.env.MODE === "web";

const BASE = import.meta.env.BASE_URL;

export class EditionError extends Error {}

/** Registers the service worker and resolves once it controls this page (its "server" is reachable). */
export async function startLocalEdition(): Promise<void> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    throw new EditionError("Dieser Browser unterstützt keine Offline-Apps (Service Worker). Bitte einen aktuellen Browser verwenden – und kein privates Fenster.");
  }
  // A new version is installed in the background; a page still running the old one reloads if a lazily loaded
  // part of the old version is gone.
  window.addEventListener("vite:preloadError", () => window.location.reload());

  try {
    await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE });
  } catch {
    throw new EditionError("Die Offline-Funktion konnte nicht gestartet werden. In privaten Fenstern ist sie gesperrt.");
  }
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new EditionError("Die App braucht zu lange zum Starten. Bitte die Seite neu laden.")), 20_000);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      // After a hard reload the worker is active but does not control the page yet: ask it to take over.
      navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage("claim"));
    });
  }
  // Ask the browser not to clear the data under storage pressure (granted silently for installed apps).
  navigator.storage?.persist?.().catch(() => undefined);
}

export async function storagePersisted(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    return null;
  }
}
