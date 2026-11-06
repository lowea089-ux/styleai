import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bookmark, CalendarPlus, ChevronDown, Heart, PersonStanding, Share2, Shirt, Sparkles, ThumbsDown, ThumbsUp, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { GenerateRequestInput } from "../../shared/schemas";
import type { GeneratedOutfit, Outfit, ScoreComponent } from "../../shared/types";
import { BRAND } from "../brand";
import { api, errorMessage } from "../lib/api";
import { todayIso } from "../lib/format";
import { qk } from "../lib/queries";
import { shareOrDownload } from "../lib/share";
import { TryOnDialog } from "./TryOnDialog";
import { ItemImage, OutfitCollage, ScoreRing, roleLabel, useItemMap } from "./garments";
import { Badge, Button, IconButton, Input, Notice, Sheet, Spinner, useToast } from "./ui";

export const COMPONENT_LABELS: Record<ScoreComponent, string> = {
  style: "Stil",
  cohesion: "Stimmigkeit",
  color: "Farben",
  pattern: "Muster",
  proportion: "Proportionen",
  formality: "Formalität",
  weather: "Wetter",
  season: "Saison",
  personal: "Persönlich",
  variety: "Abwechslung",
};

interface SwapOption {
  itemId: string | null;
  score: number;
  delta: number;
  outfit: GeneratedOutfit;
}

export function OutfitCard({
  outfit,
  request,
  savedOutfit,
  onChange,
  onSimilar,
  compact,
}: {
  outfit: GeneratedOutfit;
  request: GenerateRequestInput;
  savedOutfit?: Outfit | null;
  onChange?: (o: GeneratedOutfit) => void;
  onSimilar?: (o: GeneratedOutfit) => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { map: items } = useItemMap();
  const [savedId, setSavedId] = useState<string | null>(savedOutfit?.id ?? null);
  const [isSaved, setIsSaved] = useState(!!savedOutfit?.saved);
  const [favorite, setFavorite] = useState(!!savedOutfit?.favorite);
  const [vote, setVote] = useState<"like" | "dislike" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [tryOn, setTryOn] = useState(false);

  const ids = outfit.items.map((r) => r.itemId);
  const feedback = (kind: string, extra: Record<string, unknown> = {}) =>
    api.post("/api/feedback", { kind, itemIds: ids, outfitId: savedId, ...extra }).catch(() => undefined);

  async function ensureStored(saved: boolean, fav = favorite): Promise<string> {
    if (savedId) {
      if (saved && !isSaved) {
        await api.patch(`/api/outfits/${savedId}`, { saved: true });
        setIsSaved(true);
      }
      return savedId;
    }
    const { outfit: o } = await api.post<{ outfit: Outfit }>("/api/outfits", {
      name: outfit.explanation.title.slice(0, 80) || "Mein Outfit",
      items: outfit.items,
      styles: outfit.styles,
      occasion: outfit.occasion,
      weather: request.weather ?? null,
      explanation: outfit.explanation,
      score: outfit.score,
      breakdown: outfit.breakdown,
      source: outfit.explanation.source === "ki" ? "ki" : "generiert",
      saved,
      favorite: fav,
    });
    setSavedId(o.id);
    setIsSaved(o.saved);
    qc.invalidateQueries({ queryKey: qk.outfits });
    return o.id;
  }

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      if (isSaved && savedId) {
        await api.patch(`/api/outfits/${savedId}`, { saved: false });
        setIsSaved(false);
        qc.invalidateQueries({ queryKey: qk.outfits });
        toast("Aus gespeicherten Looks entfernt", "info");
        return;
      }
      await ensureStored(true);
      await feedback("save");
      toast("Outfit gespeichert");
    });

  const toggleFavorite = () =>
    run("fav", async () => {
      const next = !favorite;
      const id = await ensureStored(true, next);
      if (savedId) await api.patch(`/api/outfits/${id}`, { favorite: next });
      setFavorite(next);
      qc.invalidateQueries({ queryKey: qk.outfits });
      if (next) await feedback("like");
    });

  const voteFor = (v: "like" | "dislike") =>
    run(v, async () => {
      await feedback(v);
      setVote(v);
      toast(v === "like" ? "Danke! Ich merke mir, dass dir das gefällt." : "Verstanden – solche Kombinationen kommen seltener.", "info");
    });

  const markWorn = () =>
    run("worn", async () => {
      const id = await ensureStored(isSaved);
      await api.post("/api/calendar", { date: todayIso(), outfitId: id, status: "worn" });
      await feedback("wear");
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: qk.items });
      qc.invalidateQueries({ queryKey: qk.stats });
      toast("Als heute getragen markiert");
    });

  const share = () => run("share", () => shareOutfit(outfit, items));

  async function applySwap(opt: SwapOption, replaced: string) {
    const next = opt.outfit;
    if (opt.itemId) await feedback("swap", { itemIds: ids.filter((i) => i !== replaced), fromItemId: replaced, toItemId: opt.itemId });
    else await feedback("remove_item", { itemIds: ids.filter((i) => i !== replaced), fromItemId: replaced });
    if (savedId) {
      await api.patch(`/api/outfits/${savedId}`, { items: next.items, score: next.score, breakdown: next.breakdown, explanation: next.explanation });
      qc.invalidateQueries({ queryKey: qk.outfits });
      qc.invalidateQueries({ queryKey: qk.outfit(savedId) });
    }
    onChange?.(next);
    setSwapFor(null);
  }

  const e = outfit.explanation;
  return (
    <article className="@container animate-fade-up overflow-hidden rounded-[28px] border border-line bg-surface shadow-card">
      {/* Side-by-side only when the card itself is wide enough, not the window. */}
      <div className={clsx("grid gap-0", !compact && "@xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]")}>
        <div className="p-3">
          <OutfitCollage refs={outfit.items} items={items} onSwap={compact ? undefined : setSwapFor} size={compact ? "sm" : "md"} />
        </div>
        <div className="flex flex-col p-4 pt-1 @xl:pt-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={e.source === "ki" ? "accent" : "neutral"}>
                  {e.source === "ki" ? <Sparkles className="size-3" /> : <Wand2 className="size-3" />}
                  {e.source === "ki" ? "KI-Begründung" : "Regelbasiert"}
                </Badge>
                {savedOutfit?.missingItems ? <Badge tone="warn">{savedOutfit.missingItems} Teil gelöscht</Badge> : null}
              </div>
              <h3 lang="de" className={clsx("font-display leading-snug [overflow-wrap:anywhere] hyphens-auto", compact ? "text-lg" : "text-xl")}>
                {e.title}
              </h3>
            </div>
            <ScoreRing score={outfit.score} size={compact ? 44 : 52} />
          </div>
          <p className={clsx("mt-2 text-sm leading-relaxed text-ink-soft", compact && "line-clamp-3")}>{e.summary}</p>
          {outfit.warnings.length > 0 && !compact && (
            <div className="mt-3 space-y-1.5">
              {outfit.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
            </div>
          )}
          {!compact && (
            <>
              <button
                type="button"
                onClick={() => setDetails((d) => !d)}
                aria-expanded={details}
                className="mt-3 flex items-center gap-1 self-start text-[13px] font-medium text-ink-soft hover:text-ink"
              >
                Details: Farben, Layering, Wetter <ChevronDown className={clsx("size-4 transition-transform", details && "rotate-180")} />
              </button>
              {details && (
                <div className="mt-2 animate-fade-up space-y-3 text-sm">
                  <Detail label="Farben & Muster" text={e.colorNotes} />
                  <Detail label="Layering" text={e.layeringNotes} />
                  <Detail label="Accessoires" text={e.accessoryNotes} />
                  <Detail label="Wetter" text={e.weatherNotes} />
                  <Detail label="Anlass" text={e.occasionNotes} />
                  <div>
                    <div className="eyebrow mb-2">Bewertung im Detail</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {(Object.keys(COMPONENT_LABELS) as ScoreComponent[]).map((k) => (
                        <div key={k} className="flex items-center gap-2 text-xs">
                          <span className="w-24 shrink-0 text-muted">{COMPONENT_LABELS[k]}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.round((outfit.breakdown[k] ?? 0) * 100)}%` }} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-4">
            <IconButton label={isSaved ? "Gespeichert – erneut tippen zum Entfernen" : "Outfit speichern"} active={isSaved} onClick={save} disabled={!!busy}>
              {busy === "save" ? <Spinner className="size-4" /> : <Bookmark className={clsx("size-[18px]", isSaved && "fill-current")} />}
            </IconButton>
            <IconButton label={favorite ? "Favorit entfernen" : "Als Favorit markieren"} active={favorite} onClick={toggleFavorite} disabled={!!busy}>
              <Heart className={clsx("size-[18px]", favorite && "fill-current")} />
            </IconButton>
            <IconButton label="Gefällt mir" active={vote === "like"} onClick={() => voteFor("like")} disabled={!!busy}>
              <ThumbsUp className="size-[18px]" />
            </IconButton>
            <IconButton label="Gefällt mir nicht" active={vote === "dislike"} onClick={() => voteFor("dislike")} disabled={!!busy}>
              <ThumbsDown className="size-[18px]" />
            </IconButton>
            <IconButton label="Im Kalender einplanen" onClick={() => setPlanOpen(true)} disabled={!!busy}>
              <CalendarPlus className="size-[18px]" />
            </IconButton>
            <IconButton label="Teilen oder als Bild speichern" onClick={share} disabled={!!busy}>
              {busy === "share" ? <Spinner className="size-4" /> : <Share2 className="size-[18px]" />}
            </IconButton>
            {compact ? (
              <>
                <IconButton label="Live anprobieren" onClick={() => setTryOn(true)}>
                  <PersonStanding className="size-[18px]" />
                </IconButton>
                <IconButton label="Heute getragen" onClick={markWorn} disabled={!!busy}>
                  {busy === "worn" ? <Spinner className="size-4" /> : <Shirt className="size-[18px]" />}
                </IconButton>
              </>
            ) : (
              <div className="ml-auto flex flex-wrap justify-end gap-1">
                {onSimilar && (
                  <Button size="sm" variant="ghost" onClick={() => onSimilar(outfit)}>
                    Ähnliche
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setTryOn(true)} icon={<PersonStanding className="size-4" />}>
                  Anprobieren
                </Button>
                <Button size="sm" variant="outline" onClick={markWorn} loading={busy === "worn"} icon={<Shirt className="size-4" />}>
                  Heute getragen
                </Button>
              </div>
            )}
          </div>
          {savedId && isSaved && !compact && (
            <Link to={`/outfits/${savedId}`} className="mt-2 self-start text-xs text-muted underline-offset-2 hover:underline">
              Gespeichertes Outfit öffnen und bearbeiten
            </Link>
          )}
        </div>
      </div>
      <SwapSheet outfit={outfit} itemId={swapFor} request={request} onClose={() => setSwapFor(null)} onPick={applySwap} />
      <PlanSheet open={planOpen} onOpenChange={setPlanOpen} ensureStored={() => ensureStored(true)} />
      <TryOnDialog open={tryOn} onOpenChange={setTryOn} refs={outfit.items} title={e.title} />
    </article>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <div className="eyebrow mb-0.5">{label}</div>
      <p className="leading-relaxed text-ink-soft">{text}</p>
    </div>
  );
}

function SwapSheet({
  outfit,
  itemId,
  request,
  onClose,
  onPick,
}: {
  outfit: GeneratedOutfit;
  itemId: string | null;
  request: GenerateRequestInput;
  onClose: () => void;
  onPick: (o: SwapOption, replaced: string) => Promise<void>;
}) {
  const { map: items } = useItemMap();
  const [options, setOptions] = useState<SwapOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    setOptions(null);
    setError(null);
    api
      .post<{ options: SwapOption[] }>("/api/outfits/swap", { items: outfit.items, replaceItemId: itemId, request: { ...request, mustInclude: [], count: 1 } })
      .then((r) => !cancelled && setOptions(r.options))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
    // Only refetch when a different piece is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);
  const current = itemId ? items.get(itemId) : undefined;
  const role = outfit.items.find((r) => r.itemId === itemId)?.role ?? "";

  return (
    <Sheet
      open={!!itemId}
      onOpenChange={(o) => !o && onClose()}
      title={`${roleLabel(role)} austauschen`}
      description={current ? `Alle anderen Teile bleiben. Ersetzt wird: ${current.name}` : undefined}
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {!options && !error && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {options && options.length === 0 && <Notice>Für diese Position gibt es keine anderen verfügbaren Teile im Kleiderschrank.</Notice>}
      {options && options.length > 0 && (
        <ul className="space-y-2">
          {options.map((o) => {
            const it = o.itemId ? items.get(o.itemId) : undefined;
            return (
              <li key={o.itemId ?? "remove"}>
                <button
                  type="button"
                  disabled={!!picking}
                  onClick={async () => {
                    setPicking(o.itemId ?? "remove");
                    try {
                      await onPick(o, itemId!);
                    } finally {
                      setPicking(null);
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-line p-2 text-left transition hover:border-ink/40 disabled:opacity-60"
                >
                  {it ? <ItemImage item={it} className="size-16 shrink-0 rounded-xl" /> : <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xs text-muted">ohne</div>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it ? it.name : "Weglassen"}</div>
                    <div className="text-xs text-muted">Neue Bewertung: {o.score}/100</div>
                  </div>
                  <span className={clsx("text-sm font-semibold tabular-nums", o.delta > 0 ? "text-ok" : o.delta < 0 ? "text-danger" : "text-muted")}>
                    {o.delta > 0 ? "+" : ""}
                    {o.delta}
                  </span>
                  {picking === (o.itemId ?? "remove") && <Spinner className="size-4" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

function PlanSheet({ open, onOpenChange, ensureStored }: { open: boolean; onOpenChange: (o: boolean) => void; ensureStored: () => Promise<string> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Outfit einplanen"
      footer={
        <div className="flex justify-end">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const id = await ensureStored();
                await api.post("/api/calendar", { date, outfitId: id, status: "planned" });
                qc.invalidateQueries({ queryKey: ["calendar"] });
                toast("Im Kalender eingeplant");
                onOpenChange(false);
              } catch (e) {
                toast(errorMessage(e), "danger");
              } finally {
                setBusy(false);
              }
            }}
          >
            Einplanen
          </Button>
        </div>
      }
    >
      <label className="text-sm font-medium" htmlFor="plan-date">
        Datum
      </label>
      <Input id="plan-date" type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} className="mt-1.5" />
      <p className="mt-2 text-xs text-muted">Das Outfit wird dafür in deinen gespeicherten Looks abgelegt.</p>
    </Sheet>
  );
}

async function shareOutfit(outfit: GeneratedOutfit, items: Map<string, import("../../shared/types").ClothingItem>) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const paper = css.getPropertyValue("--paper").trim() || "#f3f0ea";
  const ink = css.getPropertyValue("--ink").trim() || "#1b1815";
  const ga = css.getPropertyValue("--garment-a").trim() || "#faf8f4";
  const gb = css.getPropertyValue("--garment-b").trim() || "#ebe5db";
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ink;
  ctx.font = "600 54px 'Fraunces Variable', Georgia, serif";
  ctx.fillText(outfit.explanation.title.slice(0, 34), 72, 120);
  ctx.font = "500 26px 'Inter Variable', sans-serif";
  ctx.globalAlpha = 0.6;
  ctx.fillText(`Stimmigkeit ${outfit.score}/100`, 72, 170);
  ctx.globalAlpha = 1;

  const refs = outfit.items;
  const cols = refs.length > 4 ? 3 : 2;
  const gap = 18;
  const top = 220;
  const tileW = (W - 144 - gap * (cols - 1)) / cols;
  const rows = Math.ceil(refs.length / cols);
  const tileH = Math.min(tileW, (H - top - 140 - gap * (rows - 1)) / rows);
  for (let i = 0; i < refs.length; i++) {
    const it = items.get(refs[i].itemId);
    const x = 72 + (i % cols) * (tileW + gap);
    const y = top + Math.floor(i / cols) * (tileH + gap);
    const g = ctx.createRadialGradient(x + tileW / 2, y + tileH * 0.2, 10, x + tileW / 2, y + tileH / 2, tileW);
    g.addColorStop(0, ga);
    g.addColorStop(1, gb);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, tileW, tileH, 28);
    ctx.fill();
    if (!it) continue;
    try {
      const blob = await (await fetch(it.imageUrl, { credentials: "same-origin" })).blob();
      const bmp = await createImageBitmap(blob);
      const s = Math.min((tileW * 0.84) / bmp.width, (tileH * 0.84) / bmp.height);
      ctx.drawImage(bmp, x + (tileW - bmp.width * s) / 2, y + (tileH - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      bmp.close();
    } catch {
      /* skip missing image */
    }
  }
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.font = "500 24px 'Inter Variable', sans-serif";
  ctx.fillText(`Zusammengestellt mit ${BRAND.name}`, 72, H - 64);
  ctx.globalAlpha = 1;

  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erstellt werden."))), "image/png"));
  await shareOrDownload(blob, "outfit.png", outfit.explanation.title, `Mein Outfit: ${outfit.explanation.title}`);
}

export function outfitFromSaved(o: Outfit): GeneratedOutfit {
  return {
    key: o.id,
    items: o.items,
    score: Math.round(o.score ?? 0),
    breakdown: (o.breakdown ?? {}) as GeneratedOutfit["breakdown"],
    colorKind: "",
    explanation: o.explanation ?? {
      title: o.name,
      summary: "Manuell zusammengestellt.",
      colorNotes: "",
      layeringNotes: "",
      accessoryNotes: "",
      weatherNotes: "",
      occasionNotes: "",
      source: "regelbasiert",
    },
    warnings: [],
    styles: o.styles,
    occasion: o.occasion,
  };
}
