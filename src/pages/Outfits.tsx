import clsx from "clsx";
import { ChevronDown, Heart, Layers, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { COLOR_FAMILIES } from "../../shared/color";
import type { GenerateRequestInput } from "../../shared/schemas";
import { OCCASIONS, STYLES, type OccasionId, type StyleId } from "../../shared/taxonomy";
import type { GeneratedOutfit } from "../../shared/types";
import { ItemImage, OutfitCollage, useItemMap } from "../components/garments";
import { ItemPicker } from "../components/ItemPicker";
import { OutfitCard } from "../components/OutfitCard";
import { WeatherPanel } from "../components/WeatherPanel";
import { Badge, Button, ButtonLink, Chip, EmptyState, Input, Notice, Segmented, Skeleton, Slider, Toggle } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAiStatus, useMe, useOutfits, usePreferences } from "../lib/queries";
import { createStore } from "../lib/store";
import { useActiveWeather } from "../lib/weather";

export interface GenerateResponse {
  outfits: GeneratedOutfit[];
  diagnostics: string[];
  aiUsed: boolean;
  aiNotice: string | null;
}

const defaultForm = {
  styles: [] as StyleId[],
  customStyle: "",
  occasion: null as OccasionId | null,
  customOccasion: "",
  colors: [] as string[],
  mustInclude: [] as string[],
  exclude: [] as string[],
  preferFavorites: false,
  formalityAuto: true,
  formality: 3,
  boldness: null as number | null,
  experimental: null as number | null,
  count: 3,
  useAi: true,
};
export type GeneratorForm = typeof defaultForm;

export const generatorStore = createStore(
  {
    form: defaultForm,
    results: null as GenerateResponse | null,
    request: null as GenerateRequestInput | null,
    shownKeys: [] as string[],
    autoRun: false,
  },
  "styleai-generator",
);

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function useGenerate() {
  const { weather } = useActiveWeather();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (opts: { similarTo?: string[]; avoidKeys?: string[] } = {}) => {
    const f = generatorStore.get().form;
    const req: GenerateRequestInput = {
      styles: f.styles,
      customStyle: f.customStyle.trim() || null,
      occasion: f.occasion,
      customOccasion: f.customOccasion.trim() || null,
      colors: f.colors as GenerateRequestInput["colors"],
      mustInclude: f.mustInclude,
      exclude: f.exclude,
      preferFavorites: f.preferFavorites,
      weather,
      formality: f.formalityAuto ? null : f.formality,
      boldness: f.boldness,
      experimental: f.experimental,
      count: f.count,
      useAi: f.useAi,
      seed: Math.floor(Math.random() * 1e9),
      avoidKeys: opts.avoidKeys ?? [],
      similarTo: opts.similarTo ?? null,
    };
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<GenerateResponse>("/api/outfits/generate", req);
      generatorStore.set((s) => ({ results: r, request: req, shownKeys: [...s.shownKeys, ...r.outfits.map((o) => o.key)].slice(-120) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  return { run, loading, error };
}

export function OutfitsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "saved" ? "saved" : "generator";
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Aus deinem Kleiderschrank</div>
          <h1 className="font-display text-4xl leading-none md:text-5xl">Outfits</h1>
        </div>
        <Segmented
          label="Bereich"
          value={tab}
          onChange={(v) => setParams(v === "saved" ? { tab: "saved" } : {})}
          options={[
            { value: "generator", label: "Generator" },
            { value: "saved", label: "Gespeichert" },
          ]}
        />
      </div>
      {tab === "generator" ? <Generator /> : <SavedOutfits />}
    </div>
  );
}

function Generator() {
  const form = generatorStore.use((s) => s.form);
  const results = generatorStore.use((s) => s.results);
  const request = generatorStore.use((s) => s.request);
  const autoRun = generatorStore.use((s) => s.autoRun);
  const prefs = usePreferences();
  const aiStatus = useAiStatus();
  const me = useMe();
  const { map: items, data: allItems } = useItemMap();
  const { run, loading, error } = useGenerate();
  const [settingsOpen, setSettingsOpen] = useState(!results);
  const [picker, setPicker] = useState<"must" | "exclude" | null>(null);
  const set = (p: Partial<GeneratorForm>) => generatorStore.set((s) => ({ form: { ...s.form, ...p } }));

  useEffect(() => {
    if (autoRun) {
      generatorStore.set({ autoRun: false });
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  const boldness = form.boldness ?? prefs.data?.boldness ?? 0.4;
  const experimental = form.experimental ?? prefs.data?.experimental ?? 0.3;
  const generate = () => {
    run();
    if (window.matchMedia("(max-width: 767px)").matches) setSettingsOpen(false);
  };

  const replaceOutfit = (idx: number, o: GeneratedOutfit) =>
    generatorStore.set((s) => (s.results ? { results: { ...s.results, outfits: s.results.outfits.map((x, i) => (i === idx ? o : x)) } } : {}));

  if (allItems && allItems.length === 0)
    return (
      <EmptyState icon={<Layers className="size-6" />} title="Noch keine Kleidung" action={<ButtonLink to="/wardrobe/add">Kleidung hinzufügen</ButtonLink>}>
        Outfits entstehen ausschließlich aus deinen eigenen Teilen. Füge zuerst ein paar Oberteile, Hosen und Schuhe hinzu.
      </EmptyState>
    );

  const settings = (
    <div className="space-y-6">
      <section>
        <div className="eyebrow mb-2">Modestil · mehrere möglich</div>
        <div className="flex flex-wrap gap-1.5">
          {STYLES.map((s) => (
            <Chip key={s.id} active={form.styles.includes(s.id)} onClick={() => set({ styles: toggle(form.styles, s.id).slice(-5) })}>
              {s.label}
            </Chip>
          ))}
        </div>
        <Input className="mt-2" value={form.customStyle} maxLength={200} onChange={(e) => set({ customStyle: e.target.value })} placeholder="Eigener Stil, z. B. „Coastal Grandpa“" aria-label="Eigener Stil" />
        {!form.styles.length && prefs.data?.preferredStyles.length ? <p className="mt-1.5 text-xs text-muted">Ohne Auswahl werden deine Profil-Stile verwendet.</p> : null}
      </section>
      <section>
        <div className="eyebrow mb-2">Anlass</div>
        <div className="flex flex-wrap gap-1.5">
          {OCCASIONS.map((o) => (
            <Chip key={o.id} active={form.occasion === o.id} onClick={() => set({ occasion: form.occasion === o.id ? null : o.id })}>
              {o.label}
            </Chip>
          ))}
        </div>
        <Input className="mt-2" value={form.customOccasion} maxLength={200} onChange={(e) => set({ customOccasion: e.target.value })} placeholder="Eigener Anlass, z. B. Vernissage" aria-label="Eigener Anlass" />
      </section>
      <section>
        <div className="eyebrow mb-2">Wetter</div>
        <WeatherPanel compact />
      </section>
      <section>
        <div className="eyebrow mb-2">Wunschfarben</div>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_FAMILIES.filter((c) => c.id !== "gold" && c.id !== "silber").map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={form.colors.includes(c.id)}
              onClick={() => set({ colors: toggle(form.colors, c.id) })}
              className={clsx("size-8 rounded-full border-2 transition", form.colors.includes(c.id) ? "scale-110 border-ink" : "border-transparent ring-1 ring-black/10")}
              style={{ background: c.hex }}
            />
          ))}
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <PickerField label="Muss enthalten sein" ids={form.mustInclude} items={items} onOpen={() => setPicker("must")} onClear={() => set({ mustInclude: [] })} />
        <PickerField label="Nicht verwenden" ids={form.exclude} items={items} onOpen={() => setPicker("exclude")} onClear={() => set({ exclude: [] })} />
      </section>
      <section className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="eyebrow">Formalität</span>
            <Toggle checked={form.formalityAuto} onChange={(v) => set({ formalityAuto: v })} label="Automatisch" />
          </div>
          {!form.formalityAuto && <Slider label="Formalität" min={1} max={5} step={0.5} value={form.formality} onChange={(v) => set({ formality: v })} left="leger" right="formell" />}
        </div>
        <div>
          <span className="eyebrow">Wirkung</span>
          <Slider label="Schlicht oder auffällig" min={0} max={1} step={0.05} value={boldness} onChange={(v) => set({ boldness: v })} left="schlicht" right="auffällig" />
        </div>
        <div>
          <span className="eyebrow">Experimentierfreude</span>
          <Slider label="Klassisch oder experimentell" min={0} max={1} step={0.05} value={experimental} onChange={(v) => set({ experimental: v })} left="klassisch" right="experimentell" />
        </div>
        <Toggle checked={form.preferFavorites} onChange={(v) => set({ preferFavorites: v })} label="Lieblingsteile bevorzugen" />
        {aiStatus.data?.active && (
          <Toggle
            checked={form.useAi && !!me.data?.aiImageConsent}
            onChange={(v) => set({ useAi: v })}
            label="KI-Begründungen"
            description={me.data?.aiImageConsent ? "Die KI wählt aus den regelbasiert gebildeten Kandidaten und begründet." : "Erst unter „Mein Stil“ aktivieren."}
          />
        )}
        <div className="flex items-center justify-between">
          <span className="eyebrow">Anzahl Vorschläge</span>
          <Segmented label="Anzahl" value={form.count} onChange={(v) => set({ count: v })} options={[1, 2, 3, 4, 6].map((n) => ({ value: n, label: String(n) }))} />
        </div>
      </section>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:pr-2">
        <div className="rounded-[28px] border border-line bg-surface p-5 shadow-card">
          <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} className="flex w-full items-center justify-between lg:pointer-events-none">
            <span className="font-display text-xl">Wünsche</span>
            <ChevronDown className={clsx("size-5 transition-transform lg:hidden", settingsOpen && "rotate-180")} />
          </button>
          <div className={clsx("mt-4", !settingsOpen && "hidden lg:block")}>{settings}</div>
          <Button size="lg" className="mt-5 w-full" onClick={generate} loading={loading} icon={<Sparkles className="size-4" />}>
            Outfits generieren
          </Button>
        </div>
      </aside>
      <section aria-live="polite" aria-busy={loading} className="min-w-0">
        {error && <Notice tone="danger">{error}</Notice>}
        {loading && !results && (
          <div className="space-y-4">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        )}
        {!results && !loading && !error && (
          <EmptyState icon={<Sparkles className="size-6" />} title="Bereit für neue Looks">
            Wähle Stil, Anlass und Wetter – oder generiere einfach direkt. Jeder Vorschlag besteht nur aus Teilen, die du wirklich besitzt.
          </EmptyState>
        )}
        {results && (
          <div className={clsx("space-y-5 transition-opacity", loading && "opacity-60")}>
            {results.diagnostics.map((d) => (
              <Notice key={d} tone="warn">
                {d}
              </Notice>
            ))}
            {results.aiNotice && <Notice>{results.aiNotice}</Notice>}
            {results.outfits.map((o, i) => (
              <OutfitCard key={o.key} outfit={o} request={request ?? {}} onChange={(n) => replaceOutfit(i, n)} onSimilar={(x) => run({ similarTo: x.items.map((r) => r.itemId), avoidKeys: [x.key] })} />
            ))}
            {results.outfits.length > 0 && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" onClick={() => run({ avoidKeys: generatorStore.get().shownKeys })} loading={loading} icon={<RefreshCw className="size-4" />}>
                  Neu generieren
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
      <ItemPicker
        open={picker === "must"}
        onOpenChange={(o) => !o && setPicker(null)}
        title="Diese Teile müssen rein"
        description="Nur verfügbare Teile. Höchstens drei."
        selected={form.mustInclude}
        max={3}
        filter={(i) => i.status === "available"}
        onChange={(ids) => set({ mustInclude: ids, exclude: form.exclude.filter((x) => !ids.includes(x)) })}
      />
      <ItemPicker
        open={picker === "exclude"}
        onOpenChange={(o) => !o && setPicker(null)}
        title="Diese Teile nicht verwenden"
        selected={form.exclude}
        onChange={(ids) => set({ exclude: ids, mustInclude: form.mustInclude.filter((x) => !ids.includes(x)) })}
      />
    </div>
  );
}

function PickerField({ label, ids, items, onOpen, onClear }: { label: string; ids: string[]; items: Map<string, import("../../shared/types").ClothingItem>; onOpen: () => void; onClear: () => void }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onOpen} className="flex min-h-12 flex-1 items-center gap-1.5 rounded-2xl border border-line px-2 py-1.5 text-left text-sm text-muted hover:border-ink/40">
          {ids.length === 0 ? (
            <span className="px-1">Auswählen…</span>
          ) : (
            ids.slice(0, 4).map((id) => <ItemImage key={id} item={items.get(id)} className="size-9 rounded-lg" />)
          )}
          {ids.length > 4 && <span className="text-xs">+{ids.length - 4}</span>}
        </button>
        {ids.length > 0 && (
          <button type="button" onClick={onClear} aria-label={`${label} leeren`} className="rounded-full p-2 text-muted hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function SavedOutfits() {
  const q = useOutfits();
  const { map: items } = useItemMap();
  const [onlyFav, setOnlyFav] = useState(false);
  const list = (q.data ?? []).filter((o) => !onlyFav || o.favorite);
  if (q.isLoading)
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-square" />
        ))}
      </div>
    );
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Chip active={!onlyFav} onClick={() => setOnlyFav(false)}>
          Alle ({q.data?.length ?? 0})
        </Chip>
        <Chip active={onlyFav} onClick={() => setOnlyFav(true)}>
          <Heart className="size-3.5" /> Favoriten
        </Chip>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<Heart className="size-6" />} title={onlyFav ? "Noch keine Favoriten" : "Noch keine gespeicherten Looks"} action={<ButtonLink to="/outfits">Zum Generator</ButtonLink>}>
          Speichere Vorschläge mit dem Lesezeichen-Symbol, um sie hier wiederzufinden.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {list.map((o) => (
            <Link key={o.id} to={`/outfits/${o.id}`} className="group animate-fade-up rounded-3xl border border-line bg-surface p-2.5 shadow-card transition hover:-translate-y-0.5">
              <OutfitCollage refs={o.items} items={items} size="sm" />
              <div className="mt-2 flex items-start justify-between gap-2 px-1">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{o.name}</div>
                  <div className="text-xs text-muted">{o.score != null ? `${Math.round(o.score)}/100` : "manuell"}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {o.favorite && <Heart className="size-4 fill-accent text-accent" aria-label="Favorit" />}
                  {o.missingItems > 0 && <Badge tone="warn">−{o.missingItems}</Badge>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
