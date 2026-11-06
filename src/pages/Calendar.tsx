import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { colorLabel, getFamily } from "../../shared/color";
import { labelOf } from "../../shared/taxonomy";
import type { CalendarEntry, GeneratedOutfit, Outfit } from "../../shared/types";
import { ItemImage, OutfitCollage, useItemMap } from "../components/garments";
import { Badge, Button, ButtonLink, Card, EmptyState, Notice, Segmented, Sheet, Skeleton, Spinner, useToast } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { addDays, formatDate, formatEuro, formatWeekday, isoDate, relativeDays, startOfWeek, todayIso } from "../lib/format";
import { qk, useCalendar, useOutfits, usePreferences } from "../lib/queries";
import { weatherForDay, useWeatherReport } from "../lib/weather";

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "week" | "history" | "stats") ?? "week";
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Planen & Rückblick</div>
          <h1 className="font-display text-4xl leading-none md:text-5xl">Kalender</h1>
        </div>
        <Segmented
          label="Ansicht"
          value={tab}
          onChange={(v) => setParams(v === "week" ? {} : { tab: v })}
          options={[
            { value: "week", label: "Woche" },
            { value: "history", label: "Verlauf" },
            { value: "stats", label: "Statistik" },
          ]}
        />
      </div>
      {tab === "week" && <Week />}
      {tab === "history" && <History />}
      {tab === "stats" && <Stats />}
    </div>
  );
}

function Week() {
  const [start, setStart] = useState(() => startOfWeek(new Date()));
  const from = isoDate(start);
  const to = isoDate(addDays(start, 6));
  const cal = useCalendar(from, to);
  const { map } = useItemMap();
  const prefs = usePreferences();
  const [day, setDay] = useState<string | null>(null);
  const today = todayIso();
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setStart((s) => addDays(s, -7))} icon={<ChevronLeft className="size-4" />}>
          Vorher
        </Button>
        <div className="text-center">
          <div className="text-sm font-medium">
            {formatDate(from, { day: "numeric", month: "short" })} – {formatDate(to, { day: "numeric", month: "short", year: "numeric" })}
          </div>
          {from !== isoDate(startOfWeek(new Date())) && (
            <button type="button" className="text-xs text-muted underline" onClick={() => setStart(startOfWeek(new Date()))}>
              Diese Woche
            </button>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setStart((s) => addDays(s, 7))}>
          Weiter <ChevronRight className="size-4" />
        </Button>
      </div>
      {cal.isError && <Notice tone="danger">{errorMessage(cal.error)}</Notice>}
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const entries = (cal.data ?? []).filter((e) => e.date === d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={clsx(
                "flex min-h-24 items-start gap-3 rounded-3xl border bg-surface p-3 text-left transition hover:border-ink/40 md:min-h-64 md:flex-col",
                d === today ? "border-ink" : "border-line",
              )}
              aria-label={`${formatDate(d)} – ${entries.length} Einträge`}
            >
              <div className="w-12 shrink-0 md:w-auto">
                <div className="text-xs uppercase text-muted">{formatWeekday(d)}</div>
                <div className={clsx("font-display text-2xl", d === today && "text-accent")}>{Number(d.slice(8))}</div>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-2 md:w-full md:flex-col">
                {cal.isLoading && <Skeleton className="h-16 w-16 md:h-24 md:w-full" />}
                {entries.map((e) => (
                  <div key={e.id} className="w-20 md:w-full">
                    {e.outfit && <OutfitCollage refs={e.outfit.items.filter((r) => !r.role.startsWith("acc:"))} items={map} size="sm" />}
                    <Badge tone={e.status === "worn" ? "ok" : "neutral"} className="mt-1">
                      {e.status === "worn" ? "Getragen" : "Geplant"}
                    </Badge>
                  </div>
                ))}
                {!cal.isLoading && entries.length === 0 && (
                  <span className="flex items-center gap-1 self-center text-xs text-muted md:mt-auto">
                    <Plus className="size-3.5" /> Planen
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {prefs.data && prefs.data.avoidRepeatDays > 0 && (
        <p className="mt-3 text-xs text-muted">Getragene Teile werden {prefs.data.avoidRepeatDays} Tage lang seltener vorgeschlagen (änderbar unter „Mein Stil“).</p>
      )}
      <DaySheet date={day} onClose={() => setDay(null)} entries={(cal.data ?? []).filter((e) => e.date === day)} />
    </div>
  );
}

function DaySheet({ date, onClose, entries }: { date: string | null; onClose: () => void; entries: CalendarEntry[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { map } = useItemMap();
  const saved = useOutfits();
  const report = useWeatherReport();
  const [mode, setMode] = useState<"none" | "saved" | "suggest">("none");
  const [suggestions, setSuggestions] = useState<GeneratedOutfit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const weather = date ? weatherForDay(report.data, date) : null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["calendar"] });
    qc.invalidateQueries({ queryKey: qk.items });
    qc.invalidateQueries({ queryKey: qk.stats });
  };

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  const suggest = () =>
    act("suggest", async () => {
      setMode("suggest");
      setSuggestions(null);
      const r = await api.post<{ outfits: GeneratedOutfit[]; diagnostics: string[] }>("/api/outfits/generate", { count: 3, weather, useAi: false, date, seed: Date.now() % 1e9 });
      setSuggestions(r.outfits);
      if (!r.outfits.length) toast(r.diagnostics[0] ?? "Keine Vorschläge möglich", "danger");
    });

  const planGenerated = (o: GeneratedOutfit) =>
    act(o.key, async () => {
      const { outfit } = await api.post<{ outfit: Outfit }>("/api/outfits", {
        name: o.explanation.title.slice(0, 80),
        items: o.items,
        styles: o.styles,
        occasion: o.occasion,
        weather,
        explanation: o.explanation,
        score: o.score,
        breakdown: o.breakdown,
        source: "generiert",
        saved: true,
      });
      await api.post("/api/calendar", { date, outfitId: outfit.id, status: "planned" });
      qc.invalidateQueries({ queryKey: qk.outfits });
      refresh();
      setMode("none");
      toast("Eingeplant");
    });

  const isPast = date ? date <= todayIso() : false;

  return (
    <Sheet
      open={!!date}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setMode("none");
          setSuggestions(null);
        }
      }}
      title={date ? formatDate(date, { weekday: "long", day: "numeric", month: "long" }) : ""}
      description={weather ? `${weather.description} · ${Math.round(weather.tempMinC!)}–${Math.round(weather.tempMaxC!)} °C` : undefined}
      wide
    >
      <div className="space-y-5">
        {entries.length === 0 && mode === "none" && <p className="text-sm text-muted">Für diesen Tag ist noch nichts eingetragen.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-3 rounded-2xl border border-line p-2">
            <div className="w-28 shrink-0">{e.outfit && <OutfitCollage refs={e.outfit.items} items={map} size="sm" />}</div>
            <div className="flex min-w-0 flex-1 flex-col">
              <Link to={`/outfits/${e.outfitId}`} className="truncate text-sm font-medium hover:underline">
                {e.outfit?.name ?? "Outfit"}
              </Link>
              <Badge tone={e.status === "worn" ? "ok" : "neutral"} className="mt-1 self-start">
                {e.status === "worn" ? "Getragen" : "Geplant"}
              </Badge>
              <div className="mt-auto flex flex-wrap gap-1 pt-2">
                {e.status === "planned" ? (
                  <Button size="sm" variant="outline" loading={busy === e.id} disabled={!isPast} title={isPast ? undefined : "Erst am Tag selbst möglich"} onClick={() => act(e.id, async () => (await api.patch(`/api/calendar/${e.id}`, { status: "worn" }), refresh()))} icon={<Check className="size-4" />}>
                    Getragen
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" loading={busy === e.id} onClick={() => act(e.id, async () => (await api.patch(`/api/calendar/${e.id}`, { status: "planned" }), refresh()))}>
                    Doch nicht getragen
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => act(`del-${e.id}`, async () => (await api.del(`/api/calendar/${e.id}`), refresh()))} icon={<Trash2 className="size-4" />}>
                  Entfernen
                </Button>
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button variant={mode === "saved" ? "primary" : "outline"} onClick={() => setMode(mode === "saved" ? "none" : "saved")}>
            Gespeichertes Outfit
          </Button>
          <Button variant={mode === "suggest" ? "primary" : "outline"} onClick={suggest} loading={busy === "suggest"} icon={<Sparkles className="size-4" />}>
            Vorschlag für diesen Tag
          </Button>
        </div>

        {mode === "saved" && (
          <div>
            {saved.isLoading && <Spinner />}
            {saved.data?.length === 0 && <Notice>Noch keine gespeicherten Outfits. Nutze stattdessen „Vorschlag für diesen Tag“.</Notice>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {saved.data?.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={!!busy}
                  className="rounded-2xl border border-line p-2 text-left transition hover:border-ink/40"
                  onClick={() =>
                    act(o.id, async () => {
                      await api.post("/api/calendar", { date, outfitId: o.id, status: "planned" });
                      refresh();
                      setMode("none");
                      toast("Eingeplant");
                    })
                  }
                >
                  <OutfitCollage refs={o.items} items={map} size="sm" />
                  <div className="mt-1 truncate text-xs font-medium">{o.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {mode === "suggest" && (
          <div>
            {!suggestions && <Skeleton className="h-48" />}
            <div className="grid gap-3 sm:grid-cols-3">
              {suggestions?.map((o) => (
                <div key={o.key} className="rounded-2xl border border-line p-2">
                  <OutfitCollage refs={o.items} items={map} size="sm" />
                  <div className="mt-1 text-xs font-medium">{o.explanation.title}</div>
                  <div className="text-xs text-muted">{o.score}/100</div>
                  <Button size="sm" className="mt-2 w-full" loading={busy === o.key} onClick={() => planGenerated(o)}>
                    Einplanen
                  </Button>
                </div>
              ))}
            </div>
            {!weather && <p className="mt-2 text-xs text-muted">Ohne Wetterprognose für diesen Tag (Ort festlegen für bis zu 7 Tage Vorschau).</p>}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function History() {
  const today = todayIso();
  const from = isoDate(addDays(new Date(), -120));
  const cal = useCalendar(from, today);
  const { map } = useItemMap();
  const worn = useMemo(() => (cal.data ?? []).filter((e) => e.status === "worn").sort((a, b) => b.date.localeCompare(a.date)), [cal.data]);
  if (cal.isLoading) return <Skeleton className="h-64" />;
  if (cal.isError) return <Notice tone="danger">{errorMessage(cal.error)}</Notice>;
  if (!worn.length)
    return (
      <EmptyState title="Noch kein Verlauf" action={<ButtonLink to="/outfits">Outfit finden</ButtonLink>}>
        Markiere Outfits mit „Heute getragen“ – dann siehst du hier, was du wann anhattest.
      </EmptyState>
    );
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {worn.map((e) => (
        <Link key={e.id} to={`/outfits/${e.outfitId}`} className="rounded-3xl border border-line bg-surface p-2.5 shadow-card">
          {e.outfit && <OutfitCollage refs={e.outfit.items} items={map} size="sm" />}
          <div className="mt-2 px-1 text-sm font-medium">{formatDate(e.date, { weekday: "short", day: "numeric", month: "short" })}</div>
          <div className="truncate px-1 text-xs text-muted">{e.outfit?.name}</div>
        </Link>
      ))}
    </div>
  );
}

interface Stats {
  totalItems: number;
  availableItems: number;
  unavailableItems: number;
  totalValueCents: number;
  itemsWithPrice: number;
  wornLast90Days: number;
  utilization90: number;
  wearsLast30Days: number;
  mostWorn: { itemId: string; count: number }[];
  neverWorn: string[];
  rarelyWorn: { itemId: string; count: number; lastWornOn: string | null }[];
  costPerWear: { itemId: string; priceCents: number; wears: number; costPerWearCents: number | null }[];
  byGroup: { group: string; count: number }[];
  byColor: { family: string; count: number }[];
  savedOutfits: number;
}

function Stats() {
  const q = useQuery({ queryKey: qk.stats, queryFn: async () => (await api.get<{ stats: Stats }>("/api/insights/stats")).stats });
  const { map } = useItemMap();
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const s = q.data!;
  if (!s.totalItems) return <EmptyState title="Noch keine Daten">Füge Kleidung hinzu und markiere getragene Outfits.</EmptyState>;
  const maxColor = Math.max(...s.byColor.map((c) => c.count), 1);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Teile im Schrank" value={String(s.totalItems)} sub={`${s.unavailableItems} gerade nicht verfügbar`} />
        <Kpi label="In 90 Tagen getragen" value={`${Math.round(s.utilization90 * 100)} %`} sub={`${s.wornLast90Days} von ${s.totalItems} Teilen`} />
        <Kpi label="Tage mit Outfit (30 T.)" value={String(s.wearsLast30Days)} sub={`${s.savedOutfits} gespeicherte Looks`} />
        <Kpi label="Garderobenwert" value={s.itemsWithPrice ? formatEuro(s.totalValueCents) : "–"} sub={s.itemsWithPrice ? `aus ${s.itemsWithPrice} Teilen mit Preis` : "Preise optional erfassen"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="eyebrow mb-3">Am häufigsten getragen</div>
          {s.mostWorn.length === 0 ? (
            <p className="text-sm text-muted">Noch keine getragenen Teile erfasst.</p>
          ) : (
            <ul className="space-y-2">
              {s.mostWorn.map((m) => (
                <ItemRow key={m.itemId} id={m.itemId} map={map} right={`${m.count}×`} />
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="eyebrow mb-3">Selten getragen (nicht in den letzten 90 Tagen)</div>
          {s.rarelyWorn.length === 0 ? (
            <p className="text-sm text-muted">Alles in Rotation – sehr gut.</p>
          ) : (
            <ul className="space-y-2">
              {s.rarelyWorn.map((m) => (
                <ItemRow key={m.itemId} id={m.itemId} map={map} right={relativeDays(m.lastWornOn)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {s.neverWorn.length > 0 && (
        <Card>
          <div className="eyebrow mb-3">Noch nie getragen ({s.neverWorn.length})</div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {s.neverWorn.slice(0, 24).map((id) => (
              <Link key={id} to={`/wardrobe/${id}`} title={map.get(id)?.name}>
                <ItemImage item={map.get(id)} className="aspect-square rounded-xl" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="eyebrow mb-3">Farben im Schrank (Hauptfarbe)</div>
          <ul className="space-y-1.5">
            {s.byColor.slice(0, 10).map((c) => (
              <li key={c.family} className="flex items-center gap-2 text-sm">
                <span className="size-3.5 shrink-0 rounded-full border border-black/10" style={{ background: getFamily(c.family)?.hex }} />
                <span className="w-24 shrink-0">{colorLabel(c.family)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full" style={{ width: `${(c.count / maxColor) * 100}%`, background: getFamily(c.family)?.hex }} />
                </span>
                <span className="w-6 text-right tabular-nums text-muted">{c.count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="eyebrow mb-3">Kosten pro Tragen</div>
          {s.costPerWear.length === 0 ? (
            <p className="text-sm text-muted">Trage beim Bearbeiten eines Teils den Kaufpreis ein, um die Kosten pro Tragen zu sehen.</p>
          ) : (
            <ul className="space-y-2">
              {s.costPerWear.slice(0, 8).map((c) => (
                <ItemRow key={c.itemId} id={c.itemId} map={map} right={c.costPerWearCents != null ? `${formatEuro(c.costPerWearCents)} / Tragen` : `${formatEuro(c.priceCents)} · ungetragen`} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Näherungswert: Kaufpreis geteilt durch erfasste Trage-Tage.</p>
        </Card>
      </div>
      <Card>
        <div className="eyebrow mb-3">Nach Bereich</div>
        <div className="flex flex-wrap gap-2">
          {s.byGroup.map((g) => (
            <Badge key={g.group}>
              {labelOf.group(g.group)}: {g.count}
            </Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
    </div>
  );
}

function ItemRow({ id, map, right }: { id: string; map: Map<string, import("../../shared/types").ClothingItem>; right: string }) {
  const it = map.get(id);
  return (
    <li>
      <Link to={`/wardrobe/${id}`} className="flex items-center gap-3 hover:underline">
        <ItemImage item={it} className="size-11 shrink-0 rounded-xl" />
        <span className="min-w-0 flex-1 truncate text-sm">{it?.name ?? "—"}</span>
        <span className="shrink-0 text-xs text-muted">{right}</span>
      </Link>
    </li>
  );
}
