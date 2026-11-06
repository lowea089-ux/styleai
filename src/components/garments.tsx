import clsx from "clsx";
import { Heart, PersonStanding, Repeat2, Shirt } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { colorLabel, getFamily } from "../../shared/color";
import { labelOf } from "../../shared/taxonomy";
import type { Category, ClothingItem, OutfitItemRef } from "../../shared/types";
import { useCategories, useItems } from "../lib/queries";

export function useItemMap() {
  const q = useItems();
  const map = useMemo(() => new Map((q.data ?? []).map((i) => [i.id, i])), [q.data]);
  return { ...q, map };
}

export function useCategoryMap() {
  const q = useCategories();
  const map = useMemo(() => new Map((q.data ?? []).map((c) => [c.id, c])), [q.data]);
  return { ...q, map };
}

export function ItemImage({ item, thumb = true, className, imgClassName }: { item: Pick<ClothingItem, "name" | "thumbUrl" | "imageUrl"> | undefined; thumb?: boolean; className?: string; imgClassName?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={clsx("garment-bg relative flex items-center justify-center overflow-hidden", className)}>
      {item && !failed ? (
        <img
          src={thumb ? item.thumbUrl : item.imageUrl}
          alt={item.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={clsx("h-full w-full object-contain p-[8%] drop-shadow-[0_6px_10px_rgba(0,0,0,0.12)]", imgClassName)}
        />
      ) : (
        <Shirt className="size-1/3 text-muted/40" aria-hidden />
      )}
    </div>
  );
}

export function ColorDots({ colors, size = "sm" }: { colors: { family: string; hex: string }[]; size?: "sm" | "md" }) {
  if (!colors.length) return null;
  return (
    <span className="inline-flex items-center -space-x-1" aria-label={`Farben: ${colors.map((c) => colorLabel(c.family)).join(", ")}`}>
      {colors.slice(0, 4).map((c) => (
        <span
          key={c.family}
          title={colorLabel(c.family)}
          className={clsx("rounded-full border-2 border-surface ring-1 ring-line", size === "sm" ? "size-3.5" : "size-5")}
          style={{ background: getFamily(c.family)?.hex ?? c.hex }}
        />
      ))}
    </span>
  );
}

export function ItemCard({ item, category, onToggleFavorite, onTryOn }: { item: ClothingItem; category?: Category; onToggleFavorite?: () => void; onTryOn?: () => void }) {
  return (
    <div className="group relative animate-fade-up">
      <Link to={`/wardrobe/${item.id}`} className="block rounded-3xl focus-visible:outline-offset-4">
        <ItemImage item={item} className="aspect-[4/5] rounded-3xl transition-transform duration-300 group-hover:scale-[1.015]" />
        <div className="mt-2 px-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-medium">{item.name}</h3>
            <ColorDots colors={item.colors} />
          </div>
          <p className="truncate text-xs text-muted">{category?.name ?? "Ohne Kategorie"}</p>
        </div>
      </Link>
      {item.status !== "available" && (
        <span className="absolute left-2.5 top-2.5 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-warn backdrop-blur">{labelOf.status(item.status)}</span>
      )}
      {onToggleFavorite && (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={item.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
          aria-pressed={item.favorite}
          className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-surface/80 backdrop-blur transition hover:bg-surface"
        >
          <Heart className={clsx("size-4", item.favorite ? "fill-accent text-accent" : "text-ink")} />
        </button>
      )}
      {onTryOn && (
        <button
          type="button"
          onClick={onTryOn}
          aria-label={`${item.name} anprobieren`}
          title="Anprobieren"
          className="absolute right-2 top-12 flex size-9 items-center justify-center rounded-full bg-surface/80 text-ink backdrop-blur transition hover:bg-surface md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <PersonStanding className="size-4" />
        </button>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  top: "Oberteil",
  base: "Basis",
  mid: "Zwischenschicht",
  bottom: "Unterteil",
  onepiece: "Kleid",
  suit: "Anzug",
  outer: "Jacke/Mantel",
  shoes: "Schuhe",
};
export const roleLabel = (r: string) => (r.startsWith("acc:") ? "Accessoire" : (ROLE_LABEL[r] ?? r));

export function OutfitCollage({
  refs,
  items,
  onSwap,
  size = "md",
}: {
  refs: OutfitItemRef[];
  items: Map<string, ClothingItem>;
  onSwap?: (itemId: string) => void;
  size?: "sm" | "md";
}) {
  const main = refs.filter((r) => !r.role.startsWith("acc:"));
  const acc = refs.filter((r) => r.role.startsWith("acc:"));
  const n = main.length;
  const tile = (r: OutfitItemRef, cls?: string) => {
    const it = items.get(r.itemId);
    return (
      <div key={r.itemId} className={clsx("group/tile relative min-h-0", cls)}>
        <ItemImage item={it} className="h-full w-full rounded-2xl" />
        {size === "md" && (
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 max-w-[85%] truncate rounded-full bg-surface/85 px-2 py-0.5 text-[10.5px] text-ink-soft backdrop-blur">
            {it?.name ?? "Gelöschtes Teil"}
          </span>
        )}
        {onSwap && it && (
          <button
            type="button"
            onClick={() => onSwap(r.itemId)}
            aria-label={`${it.name} austauschen`}
            className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-surface/85 text-ink opacity-100 backdrop-blur transition hover:bg-surface md:opacity-0 md:group-hover/tile:opacity-100 md:focus-visible:opacity-100"
          >
            <Repeat2 className="size-4" />
          </button>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-1.5">
      <div
        className={clsx(
          "grid gap-1.5",
          size === "md" ? "aspect-square" : "aspect-[5/4]",
          n <= 1 && "grid-cols-1",
          n === 2 && "grid-cols-2",
          n === 3 && "grid-cols-2 grid-rows-2",
          n === 4 && "grid-cols-2 grid-rows-2",
          n >= 5 && "grid-cols-3 grid-rows-2",
        )}
      >
        {main.map((r, i) => tile(r, clsx(n === 3 && i === 0 && "row-span-2", n === 5 && i === 0 && "row-span-2")))}
      </div>
      {acc.length > 0 && <div className="grid grid-cols-4 gap-1.5">{acc.map((r) => tile(r, "aspect-square"))}</div>}
    </div>
  );
}

export function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const tone = score >= 75 ? "var(--ok)" : score >= 55 ? "var(--accent)" : "var(--warn)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Stilkompatibilität ${score} von 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth="4" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={tone} strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{score}</span>
    </div>
  );
}
