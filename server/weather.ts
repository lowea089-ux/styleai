// Open-Meteo proxy with a small in-memory cache. Free tier is for non-commercial use only;
// with OPEN_METEO_API_KEY set, requests go to the customer endpoint (https://open-meteo.com/en/pricing).
import type { WeatherContext } from "../shared/types";
import type { AppConfig } from "./config";

export interface GeoResult {
  name: string;
  region: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

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

export class WeatherError extends Error {}

const WMO: [number[], string][] = [
  [[0], "Klar"],
  [[1], "Überwiegend klar"],
  [[2], "Teilweise bewölkt"],
  [[3], "Bedeckt"],
  [[45, 48], "Nebel"],
  [[51, 53, 55, 56, 57], "Nieselregen"],
  [[61, 63, 65, 66, 67], "Regen"],
  [[71, 73, 75, 77], "Schnee"],
  [[80, 81, 82], "Regenschauer"],
  [[85, 86], "Schneeschauer"],
  [[95, 96, 99], "Gewitter"],
];
export const describeWeatherCode = (code: number | null | undefined) =>
  code == null ? "Unbekannt" : (WMO.find(([codes]) => codes.includes(code))?.[1] ?? "Unbekannt");

const TTL_MS = 10 * 60 * 1000;

export class WeatherService {
  private cache = new Map<string, { exp: number; data: unknown }>();

  constructor(
    private cfg: AppConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private host(sub: "api" | "geocoding-api") {
    return this.cfg.openMeteoKey ? "https://customer-api.open-meteo.com" : `https://${sub}.open-meteo.com`;
  }

  private async getJson(url: URL): Promise<unknown> {
    if (this.cfg.openMeteoKey) url.searchParams.set("apikey", this.cfg.openMeteoKey);
    const key = url.toString();
    const hit = this.cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new WeatherError("Der Wetterdienst ist gerade nicht erreichbar.");
    }
    if (!res.ok) throw new WeatherError(`Der Wetterdienst antwortet nicht korrekt (Status ${res.status}).`);
    const data = await res.json();
    this.cache.set(key, { exp: Date.now() + TTL_MS, data });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return data;
  }

  async geocode(q: string): Promise<GeoResult[]> {
    const url = new URL(`${this.host("geocoding-api")}/v1/search`);
    url.searchParams.set("name", q);
    url.searchParams.set("count", "6");
    url.searchParams.set("language", "de");
    url.searchParams.set("format", "json");
    const data = (await this.getJson(url)) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
    return (data.results ?? []).map((r) => ({
      name: r.name,
      region: r.admin1 ?? null,
      country: r.country ?? null,
      lat: Math.round(r.latitude * 100) / 100,
      lon: Math.round(r.longitude * 100) / 100,
    }));
  }

  async forecast(lat: number, lon: number, locationName: string | null): Promise<WeatherReport> {
    const url = new URL(`${this.host("api")}/v1/forecast`);
    // Coordinates are rounded to ~1 km – enough for weather, less precise for privacy.
    url.searchParams.set("latitude", (Math.round(lat * 100) / 100).toString());
    url.searchParams.set("longitude", (Math.round(lon * 100) / 100).toString());
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "7");
    const d = (await this.getJson(url)) as {
      current?: { temperature_2m: number; apparent_temperature: number; precipitation: number; weather_code: number; wind_speed_10m: number };
      daily?: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: (number | null)[];
        weather_code: (number | null)[];
      };
    };
    if (!d.current || !d.daily) throw new WeatherError("Unerwartete Antwort vom Wetterdienst.");
    const days: DayForecast[] = d.daily.time.map((date, i) => ({
      date,
      tempMinC: d.daily!.temperature_2m_min[i],
      tempMaxC: d.daily!.temperature_2m_max[i],
      precipitationProbability: d.daily!.precipitation_probability_max[i] ?? null,
      weatherCode: d.daily!.weather_code[i] ?? null,
      description: describeWeatherCode(d.daily!.weather_code[i]),
    }));
    const today = days[0];
    return {
      current: {
        tempC: d.current.temperature_2m,
        feelsLikeC: d.current.apparent_temperature,
        tempMinC: today?.tempMinC ?? null,
        tempMaxC: today?.tempMaxC ?? null,
        precipitationProbability: today?.precipitationProbability ?? null,
        precipitationMm: d.current.precipitation,
        windKmh: d.current.wind_speed_10m,
        weatherCode: d.current.weather_code,
        description: describeWeatherCode(d.current.weather_code),
        locationName,
        source: "open-meteo",
      },
      days,
      fetchedAt: new Date().toISOString(),
    };
  }
}
