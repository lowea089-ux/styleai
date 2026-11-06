// Tiny external store with optional sessionStorage persistence (survives navigation, not tabs).
import { useSyncExternalStore } from "react";

export function createStore<T>(initial: T, persistKey?: string) {
  let state = initial;
  if (persistKey) {
    try {
      const raw = sessionStorage.getItem(persistKey);
      if (raw) state = { ...initial, ...JSON.parse(raw) };
    } catch {
      /* storage unavailable – keep defaults */
    }
  }
  const listeners = new Set<() => void>();
  const get = () => state;
  const set = (patch: Partial<T> | ((s: T) => Partial<T>)) => {
    const p = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...p };
    if (persistKey) {
      try {
        sessionStorage.setItem(persistKey, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const use = <S,>(sel: (s: T) => S) => useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
  return { get, set, use, subscribe };
}
