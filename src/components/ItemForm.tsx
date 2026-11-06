import { ChevronDown, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { COLOR_FAMILIES, colorLabel, getFamily } from "../../shared/color";
import type { ItemInput } from "../../shared/schemas";
import { FITS, GROUPS, ITEM_STATUSES, MATERIAL_SUGGESTIONS, OCCASIONS, PATTERNS, SEASONS, STYLES } from "../../shared/taxonomy";
import type { Category } from "../../shared/types";
import { Badge, Chip, Field, Input, Segmented, Select, Slider, Textarea, Toggle } from "./ui";

export type ItemValues = ItemInput;

const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function ItemForm({
  value,
  onChange,
  categories,
  showStatus = true,
}: {
  value: ItemValues;
  onChange: (patch: Partial<ItemValues>) => void;
  categories: Category[];
  showStatus?: boolean;
}) {
  const id = useId();
  const [more, setMore] = useState(false);
  const [palette, setPalette] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const conf = value.aiConfidence ?? {};
  const unsure = (k: string) => conf[k] === "niedrig" && <Badge tone="warn">KI unsicher – bitte prüfen</Badge>;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={value.name} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} placeholder="z. B. Schwarze Bomberjacke" />
        </Field>
        <Field label="Kategorie" htmlFor={`${id}-cat`} aside={unsure("category")}>
          <Select id={`${id}-cat`} value={value.categoryId} onChange={(e) => onChange({ categoryId: e.target.value })}>
            <option value="" disabled>
              Bitte wählen…
            </option>
            {GROUPS.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {categories
                  .filter((c) => c.group === g.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Art / Unterkategorie" htmlFor={`${id}-sub`} hint="Optional, z. B. Rollkragen, Chelsea Boots">
          <Input id={`${id}-sub`} value={value.subtype ?? ""} maxLength={60} onChange={(e) => onChange({ subtype: e.target.value || null })} />
        </Field>
        <Field label="Material" htmlFor={`${id}-mat`} hint="Leer lassen, wenn unbekannt" aside={unsure("material")}>
          <Input id={`${id}-mat`} list={`${id}-materials`} value={value.material ?? ""} maxLength={60} placeholder="unbekannt" onChange={(e) => onChange({ material: e.target.value || null })} />
          <datalist id={`${id}-materials`}>
            {MATERIAL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Farben" hint="Hauptfarbe zuerst. Automatisch aus dem Bild erkannt – tippe zum Entfernen.">
        <div className="flex flex-wrap items-center gap-2">
          {value.colors.map((c, i) => (
            <Chip key={c.family} active={i === 0} swatch={getFamily(c.family)?.hex ?? c.hex} onClick={() => onChange({ colors: value.colors.filter((x) => x.family !== c.family) })}>
              {colorLabel(c.family)}
              <X className="size-3" aria-hidden />
            </Chip>
          ))}
          <Chip onClick={() => setPalette((p) => !p)}>
            <Plus className="size-3.5" /> Farbe
          </Chip>
        </div>
        {palette && (
          <div className="mt-2 grid grid-cols-8 gap-1.5 rounded-2xl border border-line p-2 sm:grid-cols-11">
            {COLOR_FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.label}
                aria-label={f.label}
                onClick={() => {
                  if (!value.colors.some((c) => c.family === f.id)) onChange({ colors: [...value.colors, { family: f.id, hex: f.hex, ratio: 0.2 }].slice(0, 5) });
                  setPalette(false);
                }}
                className="aspect-square rounded-full border border-black/10 transition hover:scale-110"
                style={{ background: f.hex }}
              />
            ))}
          </div>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Muster" htmlFor={`${id}-pat`}>
          <Select id={`${id}-pat`} value={value.pattern} onChange={(e) => onChange({ pattern: e.target.value as ItemValues["pattern"] })}>
            {PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Passform">
          <div className="no-scrollbar overflow-x-auto">
            <Segmented
              label="Passform"
              value={value.fit ?? "?"}
              onChange={(v) => onChange({ fit: v === "?" ? null : (v as ItemValues["fit"]) })}
              options={[{ value: "?", label: "?" }, ...FITS.map((f) => ({ value: f.id as string, label: f.label.split(" ")[0] }))]}
            />
          </div>
        </Field>
      </div>

      <Field label="Stilrichtung">
        <div className="flex flex-wrap gap-1.5">
          {STYLES.map((s) => (
            <Chip key={s.id} active={value.styles.includes(s.id)} onClick={() => onChange({ styles: toggleIn(value.styles, s.id) })}>
              {s.label}
            </Chip>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Jahreszeiten" hint="Keine Auswahl = ganzjährig">
          <div className="flex flex-wrap gap-1.5">
            {SEASONS.map((s) => (
              <Chip key={s.id} active={value.seasons.includes(s.id)} onClick={() => onChange({ seasons: toggleIn(value.seasons, s.id) })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Anlässe">
          <div className="flex flex-wrap gap-1.5">
            {OCCASIONS.map((o) => (
              <Chip key={o.id} active={value.occasions.includes(o.id)} onClick={() => onChange({ occasions: toggleIn(value.occasions, o.id) })}>
                {o.label}
              </Chip>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`Formalität: ${value.formality.toFixed(1).replace(".", ",")}`}>
          <Slider label="Formalität" min={1} max={5} step={0.5} value={value.formality} onChange={(v) => onChange({ formality: v })} left="leger" right="formell" />
        </Field>
        <Field label={`Wärme: ${value.warmth.toFixed(1).replace(".", ",")}`}>
          <Slider label="Wärme" min={0} max={5} step={0.5} value={value.warmth} onChange={(v) => onChange({ warmth: v })} left="luftig" right="sehr warm" />
        </Field>
      </div>

      {showStatus && (
        <Field label="Verfügbarkeit">
          <div className="flex flex-wrap gap-1.5">
            {ITEM_STATUSES.map((s) => (
              <Chip key={s.id} active={value.status === s.id} onClick={() => onChange({ status: s.id })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink">
        Weitere Angaben (Marke, Kauf, Tags) <ChevronDown className={`size-4 transition-transform ${more ? "rotate-180" : ""}`} />
      </button>
      {more && (
        <div className="grid animate-fade-up gap-4 sm:grid-cols-2">
          <Field label="Marke" htmlFor={`${id}-brand`} hint="Nur angeben, wenn bekannt">
            <Input id={`${id}-brand`} value={value.brand ?? ""} maxLength={60} onChange={(e) => onChange({ brand: e.target.value || null })} />
          </Field>
          <Field label="Kaufdatum" htmlFor={`${id}-date`}>
            <Input id={`${id}-date`} type="date" value={value.purchaseDate ?? ""} onChange={(e) => onChange({ purchaseDate: e.target.value || null })} />
          </Field>
          <Field label="Preis (€)" htmlFor={`${id}-price`} hint="Für „Kosten pro Tragen“">
            <Input
              id={`${id}-price`}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={value.priceCents != null ? (value.priceCents / 100).toString() : ""}
              onChange={(e) => onChange({ priceCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })}
            />
          </Field>
          <Field label="Tags" htmlFor={`${id}-tags`} hint="Enter zum Hinzufügen">
            <div className="flex flex-wrap gap-1.5">
              {value.tags.map((t) => (
                <Chip key={t} onClick={() => onChange({ tags: value.tags.filter((x) => x !== t) })}>
                  {t} <X className="size-3" />
                </Chip>
              ))}
            </div>
            <Input
              id={`${id}-tags`}
              value={tagDraft}
              maxLength={30}
              placeholder="z. B. Lieblingsteil, Erbstück"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagDraft.trim()) {
                  e.preventDefault();
                  if (!value.tags.includes(tagDraft.trim())) onChange({ tags: [...value.tags, tagDraft.trim()].slice(0, 20) });
                  setTagDraft("");
                }
              }}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Beschreibung" htmlFor={`${id}-desc`}>
              <Textarea id={`${id}-desc`} value={value.description} maxLength={600} onChange={(e) => onChange({ description: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Toggle checked={value.favorite} onChange={(v) => onChange({ favorite: v })} label="Lieblingsteil" />
          </div>
        </div>
      )}
    </div>
  );
}
