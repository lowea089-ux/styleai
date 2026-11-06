import { useQueryClient } from "@tanstack/react-query";
import { Heart, Plus, Search, Shirt, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { COLOR_FAMILIES, colorLabel } from "../../shared/color";
import { GROUPS, ITEM_STATUSES, SEASONS, STYLES, labelOf } from "../../shared/taxonomy";
import type { ClothingItem } from "../../shared/types";
import { ItemCard, useCategoryMap } from "../components/garments";
import { TryOnDialog } from "../components/TryOnDialog";
import { inferRole } from "../lib/roles";
import { Button, ButtonLink, Chip, EmptyState, IconButton, Input, Notice, Select, Sheet, Skeleton, Toggle, useToast } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { qk, useItems } from "../lib/queries";
import { createStore } from "../lib/store";

type Sort = "added" | "worn" | "most" | "name";
const filterStore = createStore(
  {
    q: "",
    group: null as string | null,
    categoryId: null as string | null,
    colors: [] as string[],
    styles: [] as string[],
    seasons: [] as string[],
    statuses: [] as string[],
    favorites: false,
    sort: "added" as Sort,
  },
  "styleai-wardrobe-filter",
);

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function WardrobePage() {
  const items = useItems();
  const { data: categories = [], map: cats } = useCategoryMap();
  const f = filterStore.use((s) => s);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tryItem, setTryItem] = useState<ClothingItem | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const visible = useMemo(() => {
    const needle = f.q.trim().toLowerCase();
    const list = (items.data ?? []).filter((i) => {
      const c = cats.get(i.categoryId);
      if (f.group && c?.group !== f.group) return false;
      if (f.categoryId && i.categoryId !== f.categoryId) return false;
      if (f.favorites && !i.favorite) return false;
      if (f.colors.length && !i.colors.some((x) => f.colors.includes(x.family))) return false;
      if (f.styles.length && !i.styles.some((x) => f.styles.includes(x))) return false;
      if (f.seasons.length && i.seasons.length && !i.seasons.some((x) => f.seasons.includes(x))) return false;
      if (f.statuses.length && !f.statuses.includes(i.status)) return false;
      if (needle) {
        const hay = `${i.name} ${i.subtype ?? ""} ${c?.name ?? ""} ${i.brand ?? ""} ${i.tags.join(" ")} ${i.colors.map((x) => colorLabel(x.family)).join(" ")} ${i.material ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const by: Record<Sort, (a: ClothingItem, b: ClothingItem) => number> = {
      added: (a, b) => b.createdAt.localeCompare(a.createdAt),
      worn: (a, b) => (b.lastWornOn ?? "").localeCompare(a.lastWornOn ?? ""),
      most: (a, b) => b.wearCount - a.wearCount,
      name: (a, b) => a.name.localeCompare(b.name, "de"),
    };
    return list.sort(by[f.sort]);
  }, [items.data, cats, f]);

  const activeFilters = f.colors.length + f.styles.length + f.seasons.length + f.statuses.length + (f.favorites ? 1 : 0);
  const groupCats = categories.filter((c) => c.group === f.group);

  const toggleFavorite = async (item: ClothingItem) => {
    qc.setQueryData<ClothingItem[]>(qk.items, (old) => old?.map((i) => (i.id === item.id ? { ...i, favorite: !i.favorite } : i)));
    try {
      await api.patch(`/api/items/${item.id}`, { favorite: !item.favorite });
    } catch (e) {
      toast(errorMessage(e), "danger");
      qc.invalidateQueries({ queryKey: qk.items });
    }
  };

  const reset = () => filterStore.set({ colors: [], styles: [], seasons: [], statuses: [], favorites: false });

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">{items.data ? `${items.data.length} Teile` : "Kleiderschrank"}</div>
          <h1 className="font-display text-4xl leading-none md:text-5xl">Kleiderschrank</h1>
        </div>
        <ButtonLink to="/wardrobe/add" icon={<Plus className="size-4" />}>
          <span className="hidden sm:inline">Hinzufügen</span>
          <span className="sm:hidden">Neu</span>
        </ButtonLink>
      </div>

      <div className="sticky top-14 z-20 -mx-4 space-y-3 bg-paper/90 px-4 pb-3 pt-1 backdrop-blur md:top-0 md:-mx-8 md:px-8">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={f.q} onChange={(e) => filterStore.set({ q: e.target.value })} placeholder="Suche nach Name, Farbe, Marke…" className="pl-9" aria-label="Kleiderschrank durchsuchen" />
            {f.q && (
              <button type="button" aria-label="Suche leeren" onClick={() => filterStore.set({ q: "" })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:text-ink">
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button variant="outline" onClick={() => setFiltersOpen(true)} icon={<SlidersHorizontal className="size-4" />} aria-label="Filter und Sortierung">
            <span className="hidden sm:inline">Filter</span>
            {activeFilters > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-ink">{activeFilters}</span>}
          </Button>
          <IconButton label={f.favorites ? "Alle anzeigen" : "Nur Favoriten"} active={f.favorites} onClick={() => filterStore.set({ favorites: !f.favorites })} className="border border-line">
            <Heart className={f.favorites ? "size-4 fill-current" : "size-4"} />
          </IconButton>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Chip active={!f.group} onClick={() => filterStore.set({ group: null, categoryId: null })}>
            Alle
          </Chip>
          {GROUPS.map((g) => (
            <Chip key={g.id} active={f.group === g.id} onClick={() => filterStore.set({ group: f.group === g.id ? null : g.id, categoryId: null })}>
              {g.label}
            </Chip>
          ))}
        </div>
        {f.group && groupCats.length > 0 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
            {groupCats.map((c) => (
              <Chip key={c.id} active={f.categoryId === c.id} onClick={() => filterStore.set({ categoryId: f.categoryId === c.id ? null : c.id })} className="h-7 text-xs">
                {c.name} <span className="text-muted">{c.itemCount}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>

      {items.isError && <Notice tone="danger">{errorMessage(items.error)}</Notice>}
      {items.isLoading && (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5]" />
          ))}
        </div>
      )}
      {items.data && items.data.length === 0 && (
        <div className="mt-6">
          <EmptyState icon={<Shirt className="size-6" />} title="Dein Kleiderschrank ist noch leer" action={<ButtonLink to="/wardrobe/add" icon={<Plus className="size-4" />}>Erste Teile hinzufügen</ButtonLink>}>
            Fotografiere deine Kleidung – einzeln oder mehrere Fotos auf einmal. Die App stellt die Teile frei und erkennt Farben automatisch.
          </EmptyState>
        </div>
      )}
      {items.data && items.data.length > 0 && visible.length === 0 && (
        <div className="mt-6">
          <EmptyState title="Nichts gefunden" action={<Button variant="outline" onClick={() => { reset(); filterStore.set({ q: "", group: null, categoryId: null }); }}>Filter zurücksetzen</Button>}>
            Keine Kleidungsstücke passen zu Suche und Filtern.
          </EmptyState>
        </div>
      )}
      {visible.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((i) => (
            <ItemCard key={i.id} item={i} category={cats.get(i.categoryId)} onToggleFavorite={() => toggleFavorite(i)} onTryOn={() => setTryItem(i)} />
          ))}
        </div>
      )}

      {tryItem && (
        <TryOnDialog
          open
          onOpenChange={(o) => !o && setTryItem(null)}
          refs={[{ itemId: tryItem.id, role: inferRole(tryItem, cats.get(tryItem.categoryId)) }]}
          title={tryItem.name}
        />
      )}
      <Sheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filter & Sortierung"
        footer={
          <div className="flex justify-between">
            <Button variant="ghost" onClick={reset}>
              Zurücksetzen
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>{visible.length} Teile anzeigen</Button>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <div className="eyebrow mb-2">Sortierung</div>
            <Select value={f.sort} onChange={(e) => filterStore.set({ sort: e.target.value as Sort })} aria-label="Sortierung">
              <option value="added">Zuletzt hinzugefügt</option>
              <option value="worn">Zuletzt getragen</option>
              <option value="most">Am häufigsten getragen</option>
              <option value="name">Name (A–Z)</option>
            </Select>
          </div>
          <div>
            <div className="eyebrow mb-2">Farbe</div>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_FAMILIES.filter((c) => c.id !== "gold" && c.id !== "silber").map((c) => (
                <Chip key={c.id} swatch={c.hex} active={f.colors.includes(c.id)} onClick={() => filterStore.set({ colors: toggle(f.colors, c.id) })}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Stil</div>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map((s) => (
                <Chip key={s.id} active={f.styles.includes(s.id)} onClick={() => filterStore.set({ styles: toggle(f.styles, s.id) })}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Jahreszeit</div>
            <div className="flex flex-wrap gap-1.5">
              {SEASONS.map((s) => (
                <Chip key={s.id} active={f.seasons.includes(s.id)} onClick={() => filterStore.set({ seasons: toggle(f.seasons, s.id) })}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Verfügbarkeit</div>
            <div className="flex flex-wrap gap-1.5">
              {ITEM_STATUSES.map((s) => (
                <Chip key={s.id} active={f.statuses.includes(s.id)} onClick={() => filterStore.set({ statuses: toggle(f.statuses, s.id) })}>
                  {labelOf.status(s.id)}
                </Chip>
              ))}
            </div>
          </div>
          <Toggle checked={f.favorites} onChange={(v) => filterStore.set({ favorites: v })} label="Nur Favoriten" />
        </div>
      </Sheet>
    </div>
  );
}
