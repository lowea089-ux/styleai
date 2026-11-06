import clsx from "clsx";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { GROUPS } from "../../shared/taxonomy";
import type { ClothingItem } from "../../shared/types";
import { useCategoryMap, useItemMap, ItemImage } from "./garments";
import { Button, Chip, EmptyState, Input, Sheet } from "./ui";

export function ItemPicker({
  open,
  onOpenChange,
  title,
  description,
  selected,
  onChange,
  max,
  filter,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  filter?: (i: ClothingItem) => boolean;
}) {
  const { data: items = [] } = useItemMap();
  const { map: cats } = useCategoryMap();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>(selected);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!filter || filter(i)) &&
        (!group || cats.get(i.categoryId)?.group === group) &&
        (!needle || `${i.name} ${cats.get(i.categoryId)?.name ?? ""} ${i.brand ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [items, q, group, cats, filter]);

  const toggle = (id: string) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : max && d.length >= max ? [...d.slice(1), id] : [...d, id]));

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(selected);
        onOpenChange(o);
      }}
      title={title}
      description={description}
      wide
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted">{draft.length} ausgewählt{max ? ` (max. ${max})` : ""}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDraft([])}>
              Leeren
            </Button>
            <Button
              onClick={() => {
                onChange(draft);
                onOpenChange(false);
              }}
            >
              Übernehmen
            </Button>
          </div>
        </div>
      }
    >
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen…" className="pl-9" aria-label="Kleidung suchen" />
      </div>
      <div className="no-scrollbar -mx-5 mb-3 flex gap-2 overflow-x-auto px-5">
        <Chip active={!group} onClick={() => setGroup(null)}>
          Alle
        </Chip>
        {GROUPS.map((g) => (
          <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label}
          </Chip>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState title="Keine passenden Teile">Passe die Suche an oder füge neue Kleidung hinzu.</EmptyState>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((i) => {
            const on = draft.includes(i.id);
            return (
              <button key={i.id} type="button" onClick={() => toggle(i.id)} aria-pressed={on} className="text-left">
                <div className={clsx("relative rounded-2xl ring-2 transition", on ? "ring-ink" : "ring-transparent")}>
                  <ItemImage item={i} className={clsx("aspect-square rounded-2xl", i.status !== "available" && "opacity-50")} />
                  {on && (
                    <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-paper">
                      <Check className="size-3.5" />
                    </span>
                  )}
                </div>
                <span className="mt-1 block truncate text-xs">{i.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
