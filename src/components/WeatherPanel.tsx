import { useQueryClient } from "@tanstack/react-query";
import { CloudRain, CloudSun, LocateFixed, MapPin, Wind } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { qk, useCapabilities } from "../lib/queries";
import { roundCoord, useActiveWeather, weatherStore } from "../lib/weather";
import { Button, Chip, Input, Notice, Segmented, Sheet, Slider, Spinner, useToast } from "./ui";

/** Weather source switcher used by Home and the generator: live (Open-Meteo), manual or off. */
export function WeatherPanel({ compact }: { compact?: boolean }) {
  const { weather, mode, loading, error, hasLocation, report } = useActiveWeather();
  const manual = weatherStore.use((s) => s.manual);
  const caps = useCapabilities();
  const [locOpen, setLocOpen] = useState(false);

  return (
    <div className="space-y-3">
      <Segmented
        label="Wetterquelle"
        value={mode}
        onChange={(m) => weatherStore.set({ mode: m })}
        options={[
          { value: "auto", label: "Live" },
          { value: "manual", label: "Manuell" },
          { value: "off", label: "Ohne" },
        ]}
      />
      {mode === "auto" && (
        <>
          {!hasLocation && (
            <Notice action={<Button size="sm" variant="outline" onClick={() => setLocOpen(true)}>Ort wählen</Button>}>Für Live-Wetter brauche ich einen Ort.</Notice>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-4" /> Wetter wird geladen…
            </div>
          )}
          {error != null && hasLocation && <Notice tone="warn">{errorMessage(error)} Du kannst das Wetter manuell angeben.</Notice>}
          {weather && (
            <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <CloudSun className="size-7 text-ink-soft" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {Math.round(weather.tempC)} °C · {weather.description}
                </div>
                <div className="truncate text-xs text-muted">
                  {weather.locationName} · {weather.tempMinC != null && `${Math.round(weather.tempMinC)}–${Math.round(weather.tempMaxC!)} °C`}
                  {weather.precipitationProbability != null && ` · Regen ${weather.precipitationProbability} %`}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setLocOpen(true)} aria-label="Ort ändern">
                <MapPin className="size-4" />
              </Button>
            </div>
          )}
          {!compact && report && (
            <a href={caps.data?.weather.attributionUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-muted hover:underline">
              {caps.data?.weather.attribution}
            </a>
          )}
        </>
      )}
      {mode === "manual" && (
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span>Temperatur</span>
            <span className="font-semibold tabular-nums">{manual.tempC} °C</span>
          </div>
          <Slider label="Temperatur" min={-15} max={38} step={1} value={manual.tempC} onChange={(v) => weatherStore.set((s) => ({ manual: { ...s.manual, tempC: v } }))} left="-15 °C" right="38 °C" />
          <div className="flex gap-2">
            <Chip active={manual.rain} onClick={() => weatherStore.set((s) => ({ manual: { ...s.manual, rain: !s.manual.rain } }))}>
              <CloudRain className="size-3.5" /> Regen
            </Chip>
            <Chip active={manual.wind} onClick={() => weatherStore.set((s) => ({ manual: { ...s.manual, wind: !s.manual.wind } }))}>
              <Wind className="size-3.5" /> Windig
            </Chip>
          </div>
        </div>
      )}
      {mode === "off" && <p className="text-xs text-muted">Outfits werden nur nach Jahreszeit zusammengestellt.</p>}
      <LocationSheet open={locOpen} onOpenChange={setLocOpen} />
    </div>
  );
}

export function LocationSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ name: string; region: string | null; country: string | null; lat: number; lon: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (name: string, lat: number, lon: number) => {
    await api.patch("/api/preferences", { locationName: name, locationLat: roundCoord(lat), locationLon: roundCoord(lon) });
    await qc.invalidateQueries({ queryKey: qk.prefs });
    weatherStore.set({ mode: "auto" });
    toast(`Ort gespeichert: ${name}`);
    onOpenChange(false);
  };

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.get<{ results: typeof results }>(`/api/insights/weather/geocode?q=${encodeURIComponent(q.trim())}`);
      setResults(r.results);
      if (!r.results.length) setErr("Kein Ort gefunden.");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const locate = () => {
    if (!("geolocation" in navigator)) return setErr("Dein Browser unterstützt keine Standortabfrage.");
    setBusy(true);
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        save("Aktueller Standort", pos.coords.latitude, pos.coords.longitude)
          .catch((e) => setErr(errorMessage(e)))
          .finally(() => setBusy(false));
      },
      () => {
        setBusy(false);
        setErr("Standortzugriff wurde nicht erlaubt. Suche stattdessen nach deiner Stadt.");
      },
      { maximumAge: 30 * 60_000, timeout: 10_000, enableHighAccuracy: false },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Ort für das Wetter" description="Gespeichert wird nur der Ortsname und auf ca. 1 km gerundete Koordinaten.">
      <div className="space-y-3">
        <Button variant="outline" className="w-full" onClick={locate} loading={busy} icon={<LocateFixed className="size-4" />}>
          Aktuellen Standort verwenden
        </Button>
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Stadt suchen, z. B. Hamburg" aria-label="Stadt suchen" />
          <Button onClick={search} disabled={busy}>
            Suchen
          </Button>
        </div>
        {err && <Notice tone="warn">{err}</Notice>}
        <ul className="divide-y divide-line">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left hover:text-accent" onClick={() => save(r.name, r.lat, r.lon).catch((e) => setErr(errorMessage(e)))}>
                <MapPin className="size-4 shrink-0 text-muted" />
                <span className="text-sm">
                  {r.name}
                  <span className="text-muted">{[r.region, r.country].filter(Boolean).length ? ` · ${[r.region, r.country].filter(Boolean).join(", ")}` : ""}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
