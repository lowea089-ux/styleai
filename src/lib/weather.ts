import { useQuery } from "@tanstack/react-query";
import type { WeatherContext } from "../../shared/types";
import { api } from "./api";
import { usePreferences } from "./queries";
import { createStore } from "./store";

export interface DayForecast {
  date: string;
  tempMinC: number;
  tempMaxC: number;
  precipitationProbability: number | null;
  weatherCode: number | null;
  description: string;
}
export interface WeatherReport {
  current: WeatherContext;
  days: DayForecast[];
  fetchedAt: string;
}

export type WeatherMode = "auto" | "manual" | "off";

export const weatherStore = createStore(
  {
    mode: "auto" as WeatherMode,
    manual: { tempC: 15, rain: false, wind: false },
  },
  "styleai-weather",
);

export function useWeatherReport() {
  const prefs = usePreferences();
  const p = prefs.data;
  const hasLoc = p?.locationLat != null && p?.locationLon != null;
  const q = useQuery({
    queryKey: ["weather", p?.locationLat, p?.locationLon],
    enabled: hasLoc,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async () =>
      (
        await api.get<{ weather: WeatherReport }>(
          `/api/insights/weather?lat=${p!.locationLat}&lon=${p!.locationLon}&name=${encodeURIComponent(p!.locationName ?? "")}`,
        )
      ).weather,
  });
  return { ...q, hasLocation: hasLoc, locationName: p?.locationName ?? null };
}

/** The weather context the generator should use, following the user's chosen mode. */
export function useActiveWeather(): { weather: WeatherContext | null; mode: WeatherMode; report: WeatherReport | undefined; loading: boolean; error: unknown; hasLocation: boolean } {
  const mode = weatherStore.use((s) => s.mode);
  const manual = weatherStore.use((s) => s.manual);
  const r = useWeatherReport();
  let weather: WeatherContext | null = null;
  if (mode === "manual") {
    weather = {
      tempC: manual.tempC,
      precipitationProbability: manual.rain ? 80 : 0,
      windKmh: manual.wind ? 40 : 10,
      description: manual.rain ? "Regen" : null,
      source: "manuell",
    };
  } else if (mode === "auto" && r.data) weather = r.data.current;
  return { weather, mode, report: r.data, loading: mode === "auto" && r.isLoading && r.hasLocation, error: r.error, hasLocation: r.hasLocation };
}

export function weatherForDay(report: WeatherReport | undefined, date: string): WeatherContext | null {
  const d = report?.days.find((x) => x.date === date);
  if (!d) return null;
  return {
    tempC: (d.tempMinC + d.tempMaxC) / 2,
    tempMinC: d.tempMinC,
    tempMaxC: d.tempMaxC,
    precipitationProbability: d.precipitationProbability,
    weatherCode: d.weatherCode,
    description: d.description,
    locationName: report?.current.locationName ?? null,
    source: "open-meteo",
  };
}

export function roundCoord(v: number) {
  return Math.round(v * 100) / 100;
}
