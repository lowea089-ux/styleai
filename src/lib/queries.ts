import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearnedSummary } from "../../shared/engine/personalization";
import type { TrendDef } from "../../shared/trends";
import type { AiStatus, CalendarEntry, Capabilities, Category, ClothingItem, Me, Outfit, StylePreferences, TryonStatus } from "../../shared/types";
import { api, ApiError } from "./api";

export const qk = {
  me: ["me"] as const,
  caps: ["caps"] as const,
  prefs: ["prefs"] as const,
  categories: ["categories"] as const,
  items: ["items"] as const,
  item: (id: string) => ["item", id] as const,
  outfits: ["outfits"] as const,
  outfit: (id: string) => ["outfit", id] as const,
  calendar: (from: string, to: string) => ["calendar", from, to] as const,
  stats: ["stats"] as const,
  trends: ["trends"] as const,
  learned: ["learned"] as const,
  ai: ["ai"] as const,
  tryon: ["tryon"] as const,
};

/** Which AI provider is active for the current user (own key, server key or none). */
export const useAiStatus = () => useQuery({ queryKey: qk.ai, queryFn: () => api.get<AiStatus>("/api/ai/settings"), staleTime: 60_000 });

/** Realistic live try-on (Decart): key available, consent, session length. */
export const useTryonStatus = () => useQuery({ queryKey: qk.tryon, queryFn: () => api.get<TryonStatus>("/api/tryon/status"), staleTime: 60_000 });

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return (await api.get<{ user: Me }>("/api/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    // 401 resolves to null above; anything thrown here is a server/network problem worth retrying.
    retry: 3,
    retryDelay: (n) => Math.min(4000, 500 * 2 ** n),
  });
}

export const useCapabilities = () =>
  useQuery({ queryKey: qk.caps, queryFn: () => api.get<Capabilities>("/api/capabilities"), staleTime: 10 * 60_000 });

export const usePreferences = () =>
  useQuery({ queryKey: qk.prefs, queryFn: async () => (await api.get<{ preferences: StylePreferences }>("/api/preferences")).preferences });

export const useCategories = () =>
  useQuery({ queryKey: qk.categories, queryFn: async () => (await api.get<{ categories: Category[] }>("/api/categories")).categories });

export const useItems = () =>
  useQuery({ queryKey: qk.items, queryFn: async () => (await api.get<{ items: ClothingItem[] }>("/api/items")).items });

export const useItem = (id: string) =>
  useQuery({ queryKey: qk.item(id), queryFn: () => api.get<{ item: ClothingItem; wearHistory: string[] }>(`/api/items/${id}`) });

export const useOutfits = () =>
  useQuery({ queryKey: qk.outfits, queryFn: async () => (await api.get<{ outfits: Outfit[] }>("/api/outfits")).outfits });

export const useOutfit = (id: string) =>
  useQuery({ queryKey: qk.outfit(id), queryFn: async () => (await api.get<{ outfit: Outfit }>(`/api/outfits/${id}`)).outfit });

export const useCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: qk.calendar(from, to),
    queryFn: async () => (await api.get<{ entries: CalendarEntry[] }>(`/api/calendar?from=${from}&to=${to}`)).entries,
  });

export interface TrendsResponse {
  meta: { researchedAt: string; season: string; staleAfterDays: number; note: string; stale: boolean };
  trends: (TrendDef & { matches: { itemId: string; score: number; available: boolean }[] })[];
}
export const useTrends = () => useQuery({ queryKey: qk.trends, queryFn: () => api.get<TrendsResponse>("/api/insights/trends") });

export const useLearned = () =>
  useQuery({ queryKey: qk.learned, queryFn: async () => (await api.get<{ learned: LearnedSummary }>("/api/preferences/learned")).learned });

/** Invalidate everything derived from wardrobe contents. */
export function useInvalidateWardrobe() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.items });
    qc.invalidateQueries({ queryKey: qk.categories });
    qc.invalidateQueries({ queryKey: qk.stats });
    qc.invalidateQueries({ queryKey: qk.trends });
    qc.invalidateQueries({ queryKey: ["item"] });
  };
}
