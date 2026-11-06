import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Camera, Layers, Sparkles, TrendingUp } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { GeneratedOutfit } from "../../shared/types";
import { ItemImage, OutfitCollage, useItemMap } from "../components/garments";
import { OutfitCard } from "../components/OutfitCard";
import { stylistStore } from "../components/StylistSheet";
import { WeatherPanel } from "../components/WeatherPanel";
import { ButtonLink, Card, EmptyState, Notice, SectionTitle, Skeleton } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate, greeting, relativeDays, todayIso } from "../lib/format";
import { useCalendar, useMe, usePreferences } from "../lib/queries";
import { useActiveWeather } from "../lib/weather";
import { generatorStore } from "./Outfits";

interface GenerateResponse {
  outfits: GeneratedOutfit[];
  diagnostics: string[];
  aiUsed: boolean;
  aiNotice: string | null;
}

export function HomePage() {
  const me = useMe();
  const prefs = usePreferences();
  const { data: items, map } = useItemMap();
  const today = todayIso();
  const cal = useCalendar(today, today);
  const { weather, loading: weatherLoading, mode } = useActiveWeather();
  const nav = useNavigate();
  const enough = (items?.length ?? 0) >= 3;

  // "Mein Outfit für heute": regenerated when the weather input changes.
  const daily = useQuery({
    queryKey: ["daily", today, weather?.tempC, weather?.precipitationProbability, mode, items?.length],
    enabled: enough && !weatherLoading,
    staleTime: 15 * 60_000,
    queryFn: () =>
      api.post<GenerateResponse>("/api/outfits/generate", {
        count: 3,
        weather,
        occasion: prefs.data?.typicalOccasions[0] ?? null,
        useAi: false,
        seed: Number(today.replaceAll("-", "")),
      }),
  });

  const rarely = (items ?? [])
    .filter((i) => i.status === "available" && (i.lastWornOn == null || Date.now() - new Date(i.lastWornOn).getTime() > 45 * 86_400_000))
    .filter((i) => Date.now() - new Date(i.createdAt).getTime() > 14 * 86_400_000)
    .slice(0, 8);

  const planned = cal.data ?? [];
  const name = me.data?.displayName?.split(" ")[0] ?? "";

  return (
    <div className="space-y-10">
      <header>
        <div className="eyebrow">{formatDate(today, { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1 className="mt-1 font-display text-4xl leading-tight md:text-6xl">
          {greeting()}
          {name && `, ${name}`}.
        </h1>
      </header>

      {items && items.length === 0 && (
        <Card flush>
          <div className="grid md:grid-cols-[1.2fr_1fr]">
            <div className="p-6 md:p-8">
              <div className="eyebrow mb-2">Los geht's</div>
              <h2 className="font-display text-3xl leading-tight">Digitalisiere deinen Kleiderschrank</h2>
              <ol className="mt-4 space-y-2 text-sm text-ink-soft">
                <li>1. Fotografiere deine Kleidung – auch mehrere Fotos auf einmal.</li>
                <li>2. Die App stellt frei und erkennt Farben, du prüfst die Details.</li>
                <li>3. Ab drei Teilen bekommst du Outfit-Vorschläge – nur aus deinem Schrank.</li>
              </ol>
              <ButtonLink to="/wardrobe/add" size="lg" className="mt-6" icon={<Camera className="size-5" />}>
                Erste Teile fotografieren
              </ButtonLink>
            </div>
            <div className="garment-bg hidden items-center justify-center md:flex">
              <Layers className="size-24 text-muted/30" />
            </div>
          </div>
        </Card>
      )}

      {items && items.length > 0 && (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <SectionTitle
              eyebrow="Tagesempfehlung"
              title="Mein Outfit für heute"
              action={
                <Link to="/outfits" className="hidden items-center gap-1 text-sm font-medium hover:underline sm:inline-flex">
                  Generator <ArrowRight className="size-4" />
                </Link>
              }
            />
            {!enough && (
              <Notice action={<ButtonLink to="/wardrobe/add" size="sm" variant="outline">Hinzufügen</ButtonLink>}>
                Füge noch {3 - items.length} Teil{3 - items.length > 1 ? "e" : ""} hinzu – dann kann ich Outfits zusammenstellen.
              </Notice>
            )}
            {enough && (daily.isLoading || weatherLoading) && (
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-96" />
                <Skeleton className="hidden h-96 md:block" />
              </div>
            )}
            {daily.isError && <Notice tone="danger">{errorMessage(daily.error)}</Notice>}
            {daily.data && (
              <div className="space-y-3">
                {daily.data.diagnostics.map((d) => (
                  <Notice key={d} tone="warn">
                    {d}
                  </Notice>
                ))}
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0 lg:grid lg:grid-cols-2 lg:overflow-visible 2xl:grid-cols-3">
                  {daily.data.outfits.map((o) => (
                    <div key={o.key} className="w-[85%] max-w-sm shrink-0 snap-center md:w-[46%] lg:w-auto lg:max-w-none">
                      <OutfitCard outfit={o} request={{ weather }} compact />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <aside className="min-w-0 space-y-4">
            <Card>
              <div className="eyebrow mb-3">Wetter heute</div>
              <WeatherPanel />
            </Card>
            {planned.length > 0 && (
              <Card>
                <div className="eyebrow mb-3">Für heute geplant</div>
                {planned.map((e) =>
                  e.outfit ? (
                    <Link key={e.id} to={`/outfits/${e.outfitId}`} className="block">
                      <OutfitCollage refs={e.outfit.items} items={map} size="sm" />
                      <div className="mt-2 text-sm font-medium">{e.outfit.name}</div>
                      <div className="text-xs text-muted">{e.status === "worn" ? "Getragen" : "Geplant"}</div>
                    </Link>
                  ) : null,
                )}
              </Card>
            )}
          </aside>
        </section>
      )}

      {items && items.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickTile icon={<Camera className="size-5" />} title="Kleidung hinzufügen" text="Fotos aufnehmen oder hochladen" onClick={() => nav("/wardrobe/add")} />
          <QuickTile icon={<Layers className="size-5" />} title="Outfit generieren" text="Nach Stil, Anlass & Wetter" onClick={() => nav("/outfits")} />
          <QuickTile icon={<CalendarDays className="size-5" />} title="Woche planen" text="Outfits in den Kalender legen" onClick={() => nav("/calendar")} />
          <QuickTile icon={<TrendingUp className="size-5" />} title="Trends" text="Mit deinen Teilen umsetzen" onClick={() => nav("/trends")} />
        </section>
      )}

      {rarely.length > 0 && (
        <section>
          <SectionTitle eyebrow="Wiederentdecken" title="Lange nicht getragen" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
            {rarely.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => {
                  generatorStore.set((s) => ({ form: { ...s.form, mustInclude: [i.id] }, results: null, autoRun: true }));
                  nav("/outfits");
                }}
                className="w-36 shrink-0 text-left"
              >
                <ItemImage item={i} className="aspect-[4/5] rounded-2xl" />
                <div className="mt-1.5 truncate text-sm">{i.name}</div>
                <div className="text-xs text-muted">Getragen: {relativeDays(i.lastWornOn)}</div>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Tippe auf ein Teil, um ein Outfit damit zu erstellen.</p>
        </section>
      )}

      {items && items.length > 0 && (
        <button
          type="button"
          onClick={() => stylistStore.set({ open: true })}
          className="flex w-full items-center gap-4 rounded-[28px] bg-ink p-6 text-left text-paper transition hover:bg-ink-soft"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Sparkles className="size-5" />
          </span>
          <span>
            <span className="block font-display text-xl">Frag deinen Stylisten</span>
            <span className="text-sm text-paper/70">„Was ziehe ich zum Abendessen mit meiner weißen Jeans an?“</span>
          </span>
        </button>
      )}
      {items === undefined && <EmptyState title="Lädt…" />}
    </div>
  );
}

function QuickTile({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-3xl border border-line bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-xs text-muted">{text}</span>
      </span>
    </button>
  );
}
