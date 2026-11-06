import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Heart, ImageUp, Layers, PersonStanding, Shirt, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { itemInputSchema } from "../../shared/schemas";
import { ITEM_STATUSES } from "../../shared/taxonomy";
import type { ClothingItem } from "../../shared/types";
import { ItemImage, useCategoryMap } from "../components/garments";
import { ItemForm, type ItemValues } from "../components/ItemForm";
import { Badge, Button, Chip, ConfirmDialog, IconButton, Notice, Skeleton, useToast } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate, formatEuro, relativeDays, todayIso } from "../lib/format";
import { canvasToBlob, correctLighting, loadImage, removeBackground } from "../lib/image";
import { qk, useInvalidateWardrobe, useItem } from "../lib/queries";
import { inferRole } from "../lib/roles";
import { TryOnDialog } from "../components/TryOnDialog";
import { generatorStore } from "./Outfits";

const toValues = (i: ClothingItem): ItemValues =>
  itemInputSchema.parse({
    categoryId: i.categoryId,
    subtype: i.subtype,
    name: i.name,
    colors: i.colors,
    pattern: i.pattern,
    material: i.material,
    fit: i.fit,
    styles: i.styles,
    seasons: i.seasons,
    occasions: i.occasions,
    formality: i.formality,
    warmth: i.warmth,
    slotOverride: i.slotOverride,
    description: i.description,
    brand: i.brand,
    purchaseDate: i.purchaseDate,
    priceCents: i.priceCents,
    status: i.status,
    favorite: i.favorite,
    tags: i.tags,
    aiAnalyzed: i.aiAnalyzed,
    aiConfidence: i.aiConfidence,
  });

export function ItemDetailPage() {
  const { id = "" } = useParams();
  const q = useItem(id);
  const { data: categories = [], map: cats } = useCategoryMap();
  const qc = useQueryClient();
  const invalidate = useInvalidateWardrobe();
  const toast = useToast();
  const nav = useNavigate();
  const [values, setValues] = useState<ItemValues | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [tryOn, setTryOn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const item = q.data?.item;
  useEffect(() => {
    if (item && !dirty) setValues(toValues(item));
  }, [item, dirty]);

  if (q.isLoading) return <Skeleton className="h-[70dvh]" />;
  if (q.isError || !item || !values)
    return (
      <Notice tone="danger" action={<Link to="/wardrobe" className="underline">Zurück</Link>}>
        {q.isError ? errorMessage(q.error) : "Kleidungsstück nicht gefunden."}
      </Notice>
    );

  const patch = async (p: Partial<ItemValues>, msg?: string) => {
    try {
      const r = await api.patch<{ item: ClothingItem }>(`/api/items/${id}`, p);
      qc.setQueryData(qk.item(id), { item: r.item, wearHistory: q.data!.wearHistory });
      invalidate();
      if (msg) toast(msg);
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };

  const saveAll = async () => {
    const parsed = itemInputSchema.safeParse(values);
    if (!parsed.success) return toast(parsed.error.issues[0]?.message ?? "Angaben unvollständig", "danger");
    setSaving(true);
    await patch(parsed.data, "Änderungen gespeichert");
    setDirty(false);
    setSaving(false);
  };

  const replaceImage = async (file: File | undefined) => {
    if (!file) return;
    setReplacing(true);
    try {
      const original = correctLighting(await loadImage(file)).canvas;
      const cut = removeBackground(original, 20);
      const canvas = cut.confident ? cut.canvas : original;
      const fd = new FormData();
      fd.append("image", await canvasToBlob(canvas, cut.confident ? "image/png" : "image/jpeg", 0.92), "item.png");
      await api.put(`/api/items/${id}/image`, fd);
      invalidate();
      toast(cut.confident ? "Bild ersetzt und freigestellt" : "Bild ersetzt (Hintergrund war zu unruhig zum Freistellen)");
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setReplacing(false);
    }
  };

  const cat = cats.get(item.categoryId);
  const cpw = item.priceCents != null && item.wearCount > 0 ? item.priceCents / item.wearCount : null;

  return (
    <div>
      <Link to="/wardrobe" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Kleiderschrank
      </Link>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div>
          <div className="relative">
            <ItemImage item={item} thumb={false} className="aspect-[4/5] rounded-[32px]" />
            {replacing && <div className="absolute inset-0 skeleton rounded-[32px] opacity-70" />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setTryOn(true)} icon={<PersonStanding className="size-4" />}>
              Anprobieren
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} loading={replacing} icon={<ImageUp className="size-4" />}>
              Bild ersetzen
            </Button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (replaceImage(e.target.files?.[0]), (e.target.value = ""))} />
          </div>
        </div>
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow mb-1">{cat?.name ?? "Ohne Kategorie"}</div>
              <h1 className="font-display text-4xl leading-tight">{item.name}</h1>
              {item.aiAnalyzed && (
                <Badge tone="accent" className="mt-2">
                  Mit KI erfasst
                </Badge>
              )}
            </div>
            <IconButton label={item.favorite ? "Aus Favoriten entfernen" : "Als Favorit markieren"} active={item.favorite} onClick={() => patch({ favorite: !item.favorite })} className="border border-line">
              <Heart className={item.favorite ? "size-5 fill-current" : "size-5"} />
            </IconButton>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <Stat label="Getragen" value={`${item.wearCount}×`} />
            <Stat label="Zuletzt" value={relativeDays(item.lastWornOn)} />
            <Stat label="Pro Tragen" value={cpw != null ? formatEuro(Math.round(cpw)) : item.priceCents != null ? "–" : "kein Preis"} />
          </div>

          <div className="mt-5">
            <div className="eyebrow mb-2">Verfügbarkeit</div>
            <div className="flex flex-wrap gap-1.5">
              {ITEM_STATUSES.map((s) => (
                <Chip key={s.id} active={item.status === s.id} onClick={() => patch({ status: s.id }, s.id === "available" ? "Wieder verfügbar" : `Markiert: ${s.label}`)}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              icon={<Shirt className="size-4" />}
              onClick={async () => {
                try {
                  await api.post(`/api/items/${id}/worn`, { date: todayIso() });
                  qc.invalidateQueries({ queryKey: qk.item(id) });
                  invalidate();
                  toast("Als heute getragen vermerkt");
                } catch (e) {
                  toast(errorMessage(e), "danger");
                }
              }}
            >
              Heute getragen
            </Button>
            <Button
              variant="outline"
              icon={<Layers className="size-4" />}
              disabled={item.status !== "available"}
              onClick={() => {
                generatorStore.set((s) => ({ form: { ...s.form, mustInclude: [item.id] }, results: null, autoRun: true }));
                nav("/outfits");
              }}
            >
              Outfit mit diesem Teil
            </Button>
          </div>
          {item.status !== "available" && <p className="mt-2 text-xs text-muted">Nicht verfügbare Teile werden bei Outfit-Vorschlägen ausgelassen.</p>}

          <div className="mt-8 border-t border-line pt-6">
            <h2 className="mb-4 font-display text-2xl">Details bearbeiten</h2>
            <ItemForm
              value={values}
              categories={categories}
              showStatus={false}
              onChange={(p) => {
                setValues((v) => ({ ...v!, ...p }));
                setDirty(true);
              }}
            />
            <div className="sticky bottom-20 mt-6 flex justify-between gap-2 rounded-full bg-paper/90 py-2 backdrop-blur md:bottom-4">
              <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)} icon={<Trash2 className="size-4" />}>
                Löschen
              </Button>
              <div className="flex gap-2">
                {dirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDirty(false);
                      setValues(toValues(item));
                    }}
                  >
                    Verwerfen
                  </Button>
                )}
                <Button onClick={saveAll} disabled={!dirty} loading={saving}>
                  Speichern
                </Button>
              </div>
            </div>
          </div>

          {q.data!.wearHistory.length > 0 && (
            <div className="mt-8">
              <div className="eyebrow mb-2">Trage-Verlauf</div>
              <div className="flex flex-wrap gap-1.5">
                {q.data!.wearHistory.slice(0, 20).map((d, i) => (
                  <Badge key={`${d}-${i}`}>{formatDate(d, { day: "numeric", month: "short", year: "2-digit" })}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <TryOnDialog open={tryOn} onOpenChange={setTryOn} refs={[{ itemId: item.id, role: inferRole(item, cat) }]} title={item.name} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Kleidungsstück löschen?"
        confirmLabel="Endgültig löschen"
        danger
        loading={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api.del(`/api/items/${id}`);
            invalidate();
            qc.invalidateQueries({ queryKey: qk.outfits });
            toast("Gelöscht");
            nav("/wardrobe", { replace: true });
          } catch (e) {
            toast(errorMessage(e), "danger");
            setDeleting(false);
          }
        }}
      >
        „{item.name}“ und das zugehörige Bild werden dauerhaft gelöscht. Gespeicherte Outfits mit diesem Teil verlieren es.
      </ConfirmDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
