import { useQueryClient } from "@tanstack/react-query";
import { Download, LogOut, MapPin, Pencil, Plus, ShieldCheck, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { COLOR_FAMILIES, colorLabel, getFamily, type ColorFamilyId } from "../../shared/color";
import { GROUPS, OCCASIONS, STYLES, labelOf, type GroupId, type Slot } from "../../shared/taxonomy";
import type { Category, StylePreferences } from "../../shared/types";
import { AiConsentSheet } from "../components/AiConsent";
import { AiProviderSettings } from "../components/AiProviderSettings";
import { BackupSection } from "../components/BackupSection";
import { TryonSettings } from "../components/TryonSettings";
import { ItemImage, useItemMap } from "../components/garments";
import { LocationSheet } from "../components/WeatherPanel";
import { Badge, Button, Card, Chip, ConfirmDialog, Field, Input, Notice, Segmented, Select, Sheet, Skeleton, Slider, Toggle, useToast } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { downloadFrom } from "../lib/download";
import { LOCAL_EDITION } from "../lib/edition";
import { qk, useAiStatus, useCategories, useLearned, useMe, usePreferences } from "../lib/queries";
import { applyTheme } from "../lib/theme";

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function StylePage() {
  const me = useMe();
  const prefs = usePreferences();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const { hash } = useLocation();

  // Deep links like /style#ki-anbieter: scroll once the sections have rendered.
  useEffect(() => {
    if (!hash || prefs.isLoading) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(t);
  }, [hash, prefs.isLoading]);

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    qc.clear();
    qc.setQueryData(qk.me, null);
    nav("/login", { replace: true });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">{LOCAL_EDITION ? "Gespeichert auf diesem Gerät" : me.data?.email}</div>
          <h1 className="font-display text-4xl leading-none md:text-5xl">Mein Stil</h1>
        </div>
        {!LOCAL_EDITION && (
          <Button variant="outline" onClick={logout} icon={<LogOut className="size-4" />}>
            Abmelden
          </Button>
        )}
      </div>
      {prefs.isLoading && <Skeleton className="h-96" />}
      {prefs.data && <ProfileSection prefs={prefs.data} onSaved={() => toast("Stilprofil gespeichert")} />}
      <LearnedSection />
      <Link to="/trends" className="flex items-center gap-4 rounded-[28px] border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <TrendingUp className="size-5" />
        </span>
        <span>
          <span className="block font-display text-xl">Aktuelle Trends</span>
          <span className="text-sm text-muted">Was gerade angesagt ist – umgesetzt mit deinen Teilen</span>
        </span>
      </Link>
      <CategoriesSection />
      {prefs.data && <SettingsSection prefs={prefs.data} />}
      <AiProviderSettings />
      <TryonSettings />
      {LOCAL_EDITION && <BackupSection />}
      <PrivacySection />
    </div>
  );
}

function ProfileSection({ prefs, onSaved }: { prefs: StylePreferences; onSaved: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(prefs);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(prefs), [prefs]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);
  const set = (p: Partial<StylePreferences>) => setDraft((d) => ({ ...d, ...p }));

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.patch<{ preferences: StylePreferences }>("/api/preferences", {
        preferredStyles: draft.preferredStyles,
        customStyle: draft.customStyle?.trim() || null,
        favoriteColors: draft.favoriteColors,
        avoidedColors: draft.avoidedColors,
        typicalOccasions: draft.typicalOccasions,
        experimental: draft.experimental,
        boldness: draft.boldness,
        avoidRepeatDays: draft.avoidRepeatDays,
      });
      qc.setQueryData(qk.prefs, r.preferences);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-5 font-display text-2xl">Stilprofil</h2>
      <div className="space-y-6">
        <Field label="Bevorzugte Stilrichtungen">
          <div className="flex flex-wrap gap-1.5">
            {STYLES.map((s) => (
              <Chip key={s.id} active={draft.preferredStyles.includes(s.id)} onClick={() => set({ preferredStyles: toggle(draft.preferredStyles, s.id) })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Eigener Stil (frei beschreibbar)" htmlFor="custom-style">
          <Input id="custom-style" value={draft.customStyle ?? ""} maxLength={200} onChange={(e) => set({ customStyle: e.target.value })} placeholder="z. B. skandinavisch-reduziert mit Vintage-Details" />
        </Field>
        <div className="grid gap-6 md:grid-cols-2">
          <ColorPick label="Lieblingsfarben" value={draft.favoriteColors} onChange={(v) => set({ favoriteColors: v as ColorFamilyId[], avoidedColors: draft.avoidedColors.filter((x) => !v.includes(x)) })} />
          <ColorPick label="Farben, die ich meide" value={draft.avoidedColors} onChange={(v) => set({ avoidedColors: v as ColorFamilyId[], favoriteColors: draft.favoriteColors.filter((x) => !v.includes(x)) })} />
        </div>
        <Field label="Typische Anlässe" hint="Der erste Anlass wird für „Mein Outfit für heute“ verwendet.">
          <div className="flex flex-wrap gap-1.5">
            {OCCASIONS.map((o) => (
              <Chip key={o.id} active={draft.typicalOccasions.includes(o.id)} onClick={() => set({ typicalOccasions: toggle(draft.typicalOccasions, o.id) })}>
                {o.label}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Experimentierfreude">
            <Slider label="Experimentierfreude" min={0} max={1} step={0.05} value={draft.experimental} onChange={(v) => set({ experimental: v })} left="klassisch" right="experimentell" />
          </Field>
          <Field label="Wirkung">
            <Slider label="Schlicht oder auffällig" min={0} max={1} step={0.05} value={draft.boldness} onChange={(v) => set({ boldness: v })} left="schlicht" right="auffällig" />
          </Field>
        </div>
        <Field label={`Wiederholungen vermeiden: ${draft.avoidRepeatDays === 0 ? "aus" : `${draft.avoidRepeatDays} Tage`}`}>
          <Slider label="Wiederholungen vermeiden (Tage)" min={0} max={30} step={1} value={draft.avoidRepeatDays} onChange={(v) => set({ avoidRepeatDays: v })} left="aus" right="30 Tage" />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(prefs)}>
            Verwerfen
          </Button>
        )}
        <Button onClick={save} disabled={!dirty} loading={busy}>
          Speichern
        </Button>
      </div>
    </Card>
  );
}

function ColorPick({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label} hint={value.length ? value.map(colorLabel).join(", ") : "Keine Auswahl"}>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_FAMILIES.filter((c) => c.id !== "gold" && c.id !== "silber").map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            aria-label={c.label}
            aria-pressed={value.includes(c.id)}
            onClick={() => onChange(toggle(value, c.id))}
            className={`size-7 rounded-full border-2 transition ${value.includes(c.id) ? "scale-110 border-ink" : "border-transparent ring-1 ring-black/10"}`}
            style={{ background: c.hex }}
          />
        ))}
      </div>
    </Field>
  );
}

function LearnedSection() {
  const learned = useLearned();
  const prefs = usePreferences();
  const { map } = useItemMap();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const l = learned.data;
  const setPersonalization = async (v: boolean) => {
    try {
      const r = await api.patch<{ preferences: StylePreferences }>("/api/preferences", { personalizationEnabled: v });
      qc.setQueryData(qk.prefs, r.preferences);
      qc.invalidateQueries({ queryKey: qk.learned });
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return (
    <Card>
      <h2 className="font-display text-2xl">Was ich über dich gelernt habe</h2>
      <p className="mt-1 text-sm text-muted">Aus gespeicherten, gelikten, getragenen und abgelehnten Outfits. Ablehnungen machen Teile nur seltener – sie werden nie ausgeschlossen.</p>
      <div className="mt-4">
        <Toggle checked={prefs.data?.personalizationEnabled ?? true} onChange={setPersonalization} label="Personalisierte Empfehlungen" description="Aus: Vorschläge berücksichtigen nur Profil und Regeln." />
      </div>
      {learned.isLoading && <Skeleton className="mt-4 h-24" />}
      {l && l.eventCount === 0 && <p className="mt-4 text-sm text-muted">Noch keine Signale. Speichere, like oder trage Outfits – die Empfehlungen werden mit der Zeit persönlicher.</p>}
      {l && l.eventCount > 0 && (
        <div className="mt-5 space-y-4">
          <p className="text-sm">{l.eventCount} Rückmeldungen ausgewertet (neuere zählen stärker).</p>
          {l.likedItems.length > 0 && (
            <div>
              <div className="eyebrow mb-2">Gern kombiniert</div>
              <div className="flex gap-2 overflow-x-auto">
                {l.likedItems.map((x) => (
                  <Link key={x.id} to={`/wardrobe/${x.id}`} title={map.get(x.id)?.name} className="shrink-0">
                    <ItemImage item={map.get(x.id)} className="size-16 rounded-xl" />
                  </Link>
                ))}
              </div>
            </div>
          )}
          {(l.colors.length > 0 || l.styles.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {l.colors.map((c) => (
                <Badge key={c.family} tone={c.value > 0 ? "ok" : "warn"}>
                  <span className="size-2.5 rounded-full" style={{ background: getFamily(c.family)?.hex }} /> {colorLabel(c.family)} {c.value > 0 ? "↑" : "↓"}
                </Badge>
              ))}
              {l.styles.map((s) => (
                <Badge key={s.style} tone={s.value > 0 ? "ok" : "warn"}>
                  {labelOf.style(s.style)} {s.value > 0 ? "↑" : "↓"}
                </Badge>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            Gelerntes zurücksetzen
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Gelernte Vorlieben löschen?"
        confirmLabel="Zurücksetzen"
        danger
        onConfirm={async () => {
          try {
            await api.del("/api/preferences/learned");
            qc.invalidateQueries({ queryKey: qk.learned });
            toast("Lernverlauf gelöscht");
            setConfirm(false);
          } catch (e) {
            toast(errorMessage(e), "danger");
          }
        }}
      >
        Alle Rückmeldungen (Likes, Ablehnungen, Tausch-Aktionen) werden gelöscht. Dein Stilprofil, gespeicherte Outfits und der Kalender bleiben erhalten.
      </ConfirmDialog>
    </Card>
  );
}

const SLOT_OPTIONS: { value: Slot; label: string }[] = [
  { value: "top", label: "Oberteil" },
  { value: "bottom", label: "Unterteil" },
  { value: "onepiece", label: "Einteiler (Kleid)" },
  { value: "outer", label: "Jacke / Mantel" },
  { value: "suit", label: "Anzug" },
  { value: "shoes", label: "Schuhe" },
  { value: "accessory", label: "Accessoire" },
];

function CategoriesSection() {
  const cats = useCategories();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl">Kategorien</h2>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")} icon={<Plus className="size-4" />}>
          Eigene Kategorie
        </Button>
      </div>
      {cats.isLoading && <Skeleton className="h-40" />}
      <div className="space-y-4">
        {GROUPS.map((g) => (
          <div key={g.id}>
            <div className="eyebrow mb-2">{g.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {(cats.data ?? [])
                .filter((c) => c.group === g.id)
                .map((c) => (
                  <Chip key={c.id} onClick={() => setEditing(c)}>
                    {c.name}
                    <span className="text-muted">{c.itemCount}</span>
                    {!c.isDefault && <Pencil className="size-3 text-muted" />}
                  </Chip>
                ))}
            </div>
          </div>
        ))}
      </div>
      <CategoryEditor category={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = category === "new";
  const [name, setName] = useState("");
  const [group, setGroup] = useState<GroupId>("tops");
  const [slot, setSlot] = useState<Slot>("top");
  const [layer, setLayer] = useState<Category["layer"]>("base");
  const [warmth, setWarmth] = useState(1.5);
  const [formality, setFormality] = useState(2.5);
  const [accessoryKind, setAccessoryKind] = useState<NonNullable<Category["accessoryKind"]>>("other");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!category) return;
    if (category === "new") {
      setName("");
      setGroup("tops");
      setSlot("top");
      setLayer("base");
      setWarmth(1.5);
      setFormality(2.5);
      setAccessoryKind("other");
    } else {
      setName(category.name);
      setGroup(category.group);
      setSlot(category.slot);
      setLayer(category.layer);
      setWarmth(category.warmth);
      setFormality(category.formality);
      setAccessoryKind(category.accessoryKind ?? "other");
    }
  }, [category]);

  const body = {
    name: name.trim(),
    group,
    slot,
    layer: slot === "outer" ? "outer" : slot === "top" ? layer : "none",
    warmth,
    formality,
    accessoryKind: slot === "accessory" ? accessoryKind : null,
    standalone: !(slot === "top" && layer === "mid") || /pullover|hoodie|sweat/i.test(name),
    beltLoops: slot === "bottom",
    legCoverage: slot === "bottom" || slot === "onepiece" || slot === "suit" ? "full" : "none",
  };

  const save = async () => {
    setBusy(true);
    try {
      if (!existing) await api.post("/api/categories", body);
      else await api.patch(`/api/categories/${existing.id}`, existing.isDefault ? { name: body.name } : body);
      qc.invalidateQueries({ queryKey: qk.categories });
      qc.invalidateQueries({ queryKey: qk.items });
      toast("Kategorie gespeichert");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await api.del(`/api/categories/${existing.id}`);
      qc.invalidateQueries({ queryKey: qk.categories });
      toast("Kategorie gelöscht");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const existing = category && category !== "new" ? category : null;
  const isDefault = !!existing?.isDefault;
  const inUse = (existing?.itemCount ?? 0) > 0;
  return (
    <Sheet
      open={!!category}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? "Eigene Kategorie" : "Kategorie bearbeiten"}
      footer={
        <div className="flex justify-between gap-2">
          {existing ? (
            <Button variant="ghost" className="text-danger" onClick={remove} disabled={busy || inUse || isDefault} title={inUse ? "Nur leere Kategorien können gelöscht werden" : undefined} icon={<Trash2 className="size-4" />}>
              Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} loading={busy} disabled={!name.trim()}>
            Speichern
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="cat-name">
          <Input id="cat-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        {isDefault ? (
          <Notice>Bei Standardkategorien lässt sich der Name ändern. Ihre Eigenschaften für die Outfit-Logik bleiben fest.</Notice>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bereich" htmlFor="cat-group">
                <Select id="cat-group" value={group} onChange={(e) => setGroup(e.target.value as GroupId)}>
                  {GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Rolle im Outfit" htmlFor="cat-slot">
                <Select id="cat-slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
                  {SLOT_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {slot === "top" && (
              <Field label="Schicht">
                <Segmented label="Schicht" value={layer} onChange={setLayer} options={[{ value: "base", label: "Basis (z. B. Shirt)" }, { value: "mid", label: "Darüber (z. B. Weste)" }]} />
              </Field>
            )}
            {slot === "accessory" && (
              <Field label="Art" htmlFor="cat-acc">
                <Select id="cat-acc" value={accessoryKind} onChange={(e) => setAccessoryKind(e.target.value as typeof accessoryKind)}>
                  <option value="head">Kopfbedeckung</option>
                  <option value="belt">Gürtel</option>
                  <option value="bag">Tasche</option>
                  <option value="watch">Uhr</option>
                  <option value="jewelry">Schmuck</option>
                  <option value="scarf">Schal</option>
                  <option value="other">Sonstiges</option>
                </Select>
              </Field>
            )}
            <Field label={`Standard-Wärme: ${warmth}`}>
              <Slider label="Wärme" min={0} max={5} step={0.5} value={warmth} onChange={setWarmth} left="luftig" right="sehr warm" />
            </Field>
            <Field label={`Standard-Formalität: ${formality}`}>
              <Slider label="Formalität" min={1} max={5} step={0.5} value={formality} onChange={setFormality} left="leger" right="formell" />
            </Field>
          </>
        )}
      </div>
    </Sheet>
  );
}

function SettingsSection({ prefs }: { prefs: StylePreferences }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [locOpen, setLocOpen] = useState(false);
  const patch = async (p: Partial<StylePreferences>) => {
    try {
      const r = await api.patch<{ preferences: StylePreferences }>("/api/preferences", p);
      qc.setQueryData(qk.prefs, r.preferences);
      if (p.theme) applyTheme(p.theme);
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return (
    <Card>
      <h2 className="mb-5 font-display text-2xl">Einstellungen</h2>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">Darstellung</span>
          <Segmented label="Darstellung" value={prefs.theme} onChange={(v) => patch({ theme: v })} options={[{ value: "system", label: "System" }, { value: "light", label: "Hell" }, { value: "dark", label: "Dunkel" }]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            <span className="block font-medium">Ort für das Wetter</span>
            <span className="text-muted">{prefs.locationName ?? "Nicht festgelegt"}</span>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setLocOpen(true)} icon={<MapPin className="size-4" />}>
              {prefs.locationName ? "Ändern" : "Festlegen"}
            </Button>
            {prefs.locationName && (
              <Button size="sm" variant="ghost" onClick={() => patch({ locationName: null, locationLat: null, locationLon: null })}>
                Entfernen
              </Button>
            )}
          </div>
        </div>
      </div>
      <LocationSheet open={locOpen} onOpenChange={setLocOpen} />
    </Card>
  );
}

function PrivacySection() {
  const me = useMe();
  const aiStatus = useAiStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [consentOpen, setConsentOpen] = useState(false);
  const [deleteAll, setDeleteAll] = useState(false);
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    try {
      const r = await api.post<{ user: typeof me.data }>("/api/account/ai-consent", { consent: false });
      qc.setQueryData(qk.me, r.user);
      qc.invalidateQueries({ queryKey: qk.ai });
      toast("Einwilligung widerrufen", "info");
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="size-5" />
        <h2 className="font-display text-2xl">KI & Datenschutz</h2>
      </div>
      <div className="space-y-5 text-sm">
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center gap-2 font-medium">
            <Sparkles className="size-4" /> Übertragung an KI-Anbieter
          </div>
          {aiStatus.data?.active ? (
            <p className="mt-1 text-muted">Aktiver Anbieter: {aiStatus.data.active.provider}. Einstellungen oben unter „KI-Anbieter“.</p>
          ) : (
            <p className="mt-1 text-muted">Kein Anbieter eingerichtet – es werden keine Daten an KI-Dienste übertragen.</p>
          )}
          {aiStatus.data?.active && (
            <div className="mt-3">
              {me.data?.aiImageConsent ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone="ok">Einwilligung erteilt</Badge>
                  <Button size="sm" variant="outline" onClick={revoke}>
                    Widerrufen
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={() => setConsentOpen(true)}>
                  KI-Funktionen aktivieren
                </Button>
              )}
            </div>
          )}
        </div>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {LOCAL_EDITION ? (
            <li>Alle Daten und Fotos bleiben in diesem Browser auf deinem Gerät – es gibt keinen StyleAI-Server und kein Konto.</li>
          ) : (
            <li>Fotos werden privat gespeichert und nur nach Anmeldung an dich ausgeliefert.</li>
          )}
          <li>Beim Speichern werden Bilder neu kodiert – Metadaten wie GPS-Position werden entfernt.</li>
          <li>Freistellung und Farberkennung laufen in deinem Browser.</li>
          <li>Wetter: Es wird nur ein auf ca. 1 km gerundeter Ort an Open-Meteo übermittelt.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => downloadFrom("/api/account/export", "styleai-export.json").catch((e) => toast(errorMessage(e), "danger"))}
            icon={<Download className="size-4" />}
          >
            Daten exportieren (JSON)
          </Button>
          <Button variant="outline" onClick={() => setDeleteAll(true)} icon={<Trash2 className="size-4" />}>
            Alle Kleidungsstücke löschen
          </Button>
          <Button variant="danger" onClick={() => setDeleteAccount(true)}>
            {LOCAL_EDITION ? "Alle Daten löschen" : "Konto löschen"}
          </Button>
        </div>
      </div>
      <AiConsentSheet open={consentOpen} onOpenChange={setConsentOpen} />
      <ConfirmDialog
        open={deleteAll}
        onOpenChange={setDeleteAll}
        title="Alle Kleidungsstücke löschen?"
        confirmLabel="Alles löschen"
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            const r = await api.post<{ deleted: number }>("/api/items/delete-all", { confirm: true });
            qc.invalidateQueries();
            toast(`${r.deleted} Teile und Bilder gelöscht`);
            setDeleteAll(false);
          } catch (e) {
            toast(errorMessage(e), "danger");
          } finally {
            setBusy(false);
          }
        }}
      >
        Alle Kleidungsstücke und ihre Bilder werden dauerhaft gelöscht. Dein Konto und Stilprofil bleiben bestehen.
      </ConfirmDialog>
      <ConfirmDialog
        open={deleteAccount}
        onOpenChange={setDeleteAccount}
        title={LOCAL_EDITION ? "Alle Daten in diesem Browser löschen?" : "Konto endgültig löschen?"}
        confirmLabel={LOCAL_EDITION ? "Alles löschen" : "Konto löschen"}
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            if (LOCAL_EDITION) {
              await api.del("/api/account");
              setDeleteAccount(false);
              qc.clear();
              nav("/", { replace: true });
              return;
            }
            await api.del("/api/account", { password });
            qc.clear();
            qc.setQueryData(qk.me, null);
            nav("/register", { replace: true });
          } catch (e) {
            toast(errorMessage(e), "danger");
          } finally {
            setBusy(false);
          }
        }}
      >
        {LOCAL_EDITION ? (
          <p>
            Kleidungsstücke, Fotos, Outfits, Kalender, Stilprofil und gespeicherte Schlüssel werden unwiderruflich gelöscht. Lade vorher eine Sicherung herunter, wenn du sie
            behalten willst.
          </p>
        ) : (
          <>
            <p>Konto, Kleidungsstücke, Bilder, Outfits, Kalender und gelernte Vorlieben werden unwiderruflich gelöscht.</p>
            <Field label="Passwort zur Bestätigung" htmlFor="del-pw">
              <Input id="del-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
