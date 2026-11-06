import { ExternalLink, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { GeneratedOutfit } from "../../shared/types";
import { ItemImage, useItemMap } from "../components/garments";
import { OutfitCard } from "../components/OutfitCard";
import { Badge, Button, Card, Notice, Skeleton } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { useTrends } from "../lib/queries";
import { useActiveWeather } from "../lib/weather";

interface TrendOutfits {
  outfits: GeneratedOutfit[];
  diagnostics: string[];
  note: string | null;
}

export function TrendsPage() {
  const q = useTrends();
  const { map } = useItemMap();
  const { weather } = useActiveWeather();
  const [open, setOpen] = useState<Record<string, TrendOutfits | "loading" | { error: string }>>({});

  const build = async (id: string) => {
    setOpen((o) => ({ ...o, [id]: "loading" }));
    try {
      const r = await api.post<TrendOutfits>(`/api/insights/trends/${id}/outfits`, { weather });
      setOpen((o) => ({ ...o, [id]: r }));
    } catch (e) {
      setOpen((o) => ({ ...o, [id]: { error: errorMessage(e) } }));
    }
  };

  return (
    <div>
      <div className="eyebrow mb-1">{q.data ? q.data.meta.season : "Trends"}</div>
      <h1 className="font-display text-4xl leading-none md:text-5xl">Trends, mit deinem Schrank</h1>
      {q.data && (
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Stand der Recherche: {formatDate(q.data.meta.researchedAt)}. {q.data.meta.note} Jeder Trend nennt seine Quellen. Die App versucht zuerst, ihn mit deinen vorhandenen Teilen umzusetzen.
        </p>
      )}
      {q.data?.meta.stale && (
        <div className="mt-4">
          <Notice tone="warn">Dieser Trend-Datensatz ist älter als {q.data.meta.staleAfterDays} Tage und möglicherweise nicht mehr aktuell.</Notice>
        </div>
      )}
      {q.isError && <Notice tone="danger">{errorMessage(q.error)}</Notice>}
      {q.isLoading && <Skeleton className="mt-6 h-96" />}

      <div className="mt-6 space-y-5">
        {q.data?.trends.map((t) => {
          const state = open[t.id];
          return (
            <Card key={t.id} flush>
              <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="p-5 md:p-6">
                  <Badge>{t.season}</Badge>
                  <h2 className="mt-2 font-display text-2xl leading-tight">{t.name}</h2>
                  <p className="mt-2 text-sm text-ink-soft">{t.summary}</p>
                  <div className="mt-4">
                    <div className="eyebrow mb-1">So setzt du ihn um</div>
                    <p className="text-sm text-ink-soft">{t.howTo}</p>
                  </div>
                  <div className="mt-4">
                    <div className="eyebrow mb-1">Quellen</div>
                    <ul className="space-y-1 text-xs">
                      {t.sources.map((s) => (
                        <li key={s.url}>
                          <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-muted hover:text-ink hover:underline">
                            {s.publisher}: {s.title}
                            {s.published && ` (${formatDate(s.published, { day: "numeric", month: "short", year: "numeric" })})`}
                            <ExternalLink className="size-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="border-t border-line bg-surface-2/50 p-5 md:border-l md:border-t-0 md:p-6">
                  <div className="eyebrow mb-2">Passt aus deinem Schrank</div>
                  {t.matches.length === 0 ? (
                    <p className="text-sm text-muted">Kein Teil verkörpert diesen Trend direkt. Ein Outfit kann ihn trotzdem über Farben und Stil aufgreifen.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {t.matches.slice(0, 8).map((m) => (
                        <Link key={m.itemId} to={`/wardrobe/${m.itemId}`} title={map.get(m.itemId)?.name} className="relative">
                          <ItemImage item={map.get(m.itemId)} className={`size-16 rounded-xl ${m.available ? "" : "opacity-50"}`} />
                        </Link>
                      ))}
                    </div>
                  )}
                  <Button className="mt-4" variant="outline" onClick={() => build(t.id)} loading={state === "loading"} icon={<Sparkles className="size-4" />}>
                    Outfit im Trend erstellen
                  </Button>
                </div>
              </div>
              {state && state !== "loading" && (
                <div className="space-y-3 border-t border-line p-4">
                  {"error" in state ? (
                    <Notice tone="danger">{state.error}</Notice>
                  ) : (
                    <>
                      {state.note && <Notice>{state.note}</Notice>}
                      {state.diagnostics.map((d) => (
                        <Notice key={d} tone="warn">
                          {d}
                        </Notice>
                      ))}
                      {state.outfits.map((o) => (
                        <OutfitCard key={o.key} outfit={o} request={{ weather, trendId: t.id }} />
                      ))}
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
