import clsx from "clsx";
import { ArrowLeft, Camera, Check, Eraser, ImagePlus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { getFamily } from "../../shared/color";
import { itemInputSchema } from "../../shared/schemas";
import type { Category } from "../../shared/types";
import { AiConsentSheet } from "../components/AiConsent";
import { CutoutEditor } from "../components/CutoutEditor";
import { ItemForm, type ItemValues } from "../components/ItemForm";
import { Badge, Button, ButtonLink, Notice, Segmented, Slider, Spinner, Toggle, useToast } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { alphaOf, blobToCanvas, canvasColors, canvasToBlob, composeCutout, correctLighting, cropNormalized, describeLightFix, loadImage, removeBackground } from "../lib/image";
import { suggestName } from "../lib/names";
import { useAiStatus, useCapabilities, useCategories, useInvalidateWardrobe, useMe } from "../lib/queries";

interface AnalyzedItem {
  categoryId: string | null;
  subtype: string | null;
  name: string;
  pattern: ItemValues["pattern"];
  colorNames: string[];
  material: string | null;
  fit: ItemValues["fit"];
  styles: ItemValues["styles"];
  seasons: ItemValues["seasons"];
  occasions: ItemValues["occasions"];
  formality: number;
  warmth: number;
  description: string;
  brand: string | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  confidence: "hoch" | "mittel" | "niedrig";
  aiConfidence: Record<string, "hoch" | "mittel" | "niedrig">;
}

interface Draft {
  key: string;
  fileName: string;
  status: "processing" | "ready" | "saving" | "saved" | "error";
  step: string;
  error?: string;
  /** Photo the cut-out is made from: the light-corrected version when `lightOn`, else `raw`. */
  original?: HTMLCanvasElement;
  /** Photo as taken. */
  raw?: HTMLCanvasElement;
  /** Light-corrected photo; only set when a correction was needed. */
  corrected?: HTMLCanvasElement;
  lightOn: boolean;
  lightNote?: string;
  cutout?: HTMLCanvasElement;
  /** Alpha of the cut-out at the size of `original` (null when it cannot be edited, e.g. foreign size). */
  alpha?: Uint8ClampedArray | null;
  /** Enclosed background-colored regions found by the cut-out, and whether they are cut away. */
  holeCount: number;
  cutHoles: boolean;
  useCutout: boolean;
  tolerance: number;
  confident: boolean;
  preview?: string;
  values: ItemValues;
  nameTouched: boolean;
  note?: string;
}

// Schema defaults for every field; category and name are filled in by the user or the AI.
const emptyValues = (): ItemValues => ({ ...itemInputSchema.parse({ categoryId: "-", name: "-" }), categoryId: "", name: "" });

let seq = 0;

export function AddItemsPage() {
  const caps = useCapabilities();
  const aiStatus = useAiStatus();
  const activeAi = aiStatus.data?.active ?? null;
  const me = useMe();
  const { data: categories = [] } = useCategories();
  const invalidate = useInvalidateWardrobe();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [useAi, setUseAi] = useState(true);
  const [consentOpen, setConsentOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const aiReady = !!activeAi && !!me.data?.aiImageConsent && useAi;

  useEffect(() => () => draftsRef.current.forEach((d) => d.preview && URL.revokeObjectURL(d.preview)), []);

  const update = (key: string, patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) =>
    setDrafts((ds) =>
      ds.map((d) => {
        if (d.key !== key) return d;
        const p = typeof patch === "function" ? patch(d) : patch;
        if (p.preview && d.preview && p.preview !== d.preview) URL.revokeObjectURL(d.preview);
        return { ...d, ...p };
      }),
    );

  async function previewOf(c: HTMLCanvasElement) {
    return URL.createObjectURL(await canvasToBlob(c, "image/webp", 0.85));
  }

  function applyCategoryDefaults(values: ItemValues, cat: Category | undefined, nameTouched: boolean): ItemValues {
    if (!cat) return values;
    return {
      ...values,
      formality: values.aiAnalyzed ? values.formality : cat.formality,
      warmth: values.aiAnalyzed ? values.warmth : cat.warmth,
      name: nameTouched ? values.name : suggestName(cat, values.colors[0]?.family),
    };
  }

  async function processFile(file: File) {
    const key = `d${++seq}`;
    setDrafts((ds) => [
      ...ds,
      { key, fileName: file.name, status: "processing", step: "Foto wird geladen…", useCutout: true, tolerance: 20, confident: true, lightOn: false, holeCount: 0, cutHoles: false, values: emptyValues(), nameTouched: false },
    ]);
    try {
      const raw = await loadImage(file);
      update(key, { step: "Licht wird geprüft…" });
      await new Promise((r) => setTimeout(r, 0));
      // Dim or tinted photos are corrected first: cut-out, colors and AI analysis all use the fixed version.
      const fix = correctLighting(raw);
      const original = fix.canvas;
      update(key, {
        step: "Hintergrund wird entfernt…",
        original,
        raw,
        corrected: fix.applied ? fix.canvas : undefined,
        lightOn: fix.applied,
        lightNote: describeLightFix(fix.analysis) ?? undefined,
      });
      await new Promise((r) => setTimeout(r, 0));
      const cut = removeBackground(original, 20);
      const colors = canvasColors(cut.canvas);
      update(key, (d) => ({ cutout: cut.canvas, alpha: cut.alpha, holeCount: cut.holeCount, confident: cut.confident, useCutout: cut.confident, values: { ...d.values, colors } }));
      const preview = await previewOf(cut.confident ? cut.canvas : original);
      update(key, { preview });

      if (!aiReady) {
        update(key, {
          status: "ready",
          step: "",
          note: cut.confident ? undefined : "Der Hintergrund ist unruhig – Freistellung unsicher. Prüfe die Vorschau oder nutze das Original.",
        });
        return;
      }
      update(key, { step: "KI analysiert das Foto…" });
      const fd = new FormData();
      fd.append("image", await canvasToBlob(original, "image/jpeg", 0.9), "photo.jpg");
      let analysis: { items: AnalyzedItem[]; imageQuality: string; notes: string | null };
      try {
        analysis = await api.post("/api/ai/analyze", fd);
      } catch (e) {
        update(key, { status: "ready", step: "", note: `KI-Analyse nicht möglich: ${errorMessage(e)} Bitte die Angaben selbst ergänzen.` });
        return;
      }
      if (!analysis.items.length) {
        update(key, { status: "ready", step: "", note: "Die KI hat auf diesem Foto kein Kleidungsstück erkannt. Bitte Angaben selbst ergänzen." });
        return;
      }
      if (analysis.items.length === 1) {
        const a = analysis.items[0];
        update(key, (d) => ({
          status: "ready",
          step: "",
          nameTouched: true,
          values: fromAnalysis(d.values, a),
          note: a.confidence === "niedrig" ? "Die KI ist sich bei diesem Teil unsicher – bitte prüfen." : analysis.imageQuality === "schlecht" ? "Bildqualität ist gering – Angaben bitte prüfen." : undefined,
        }));
        return;
      }
      // Several garments in one photo: one draft per detected piece, each cut out separately.
      const subDrafts: Draft[] = [];
      for (const [i, a] of analysis.items.entries()) {
        const crop = a.bbox ? cropNormalized(original, a.bbox) : original;
        const rawCrop = a.bbox ? cropNormalized(raw, a.bbox) : raw;
        const c = removeBackground(crop, 20);
        const cols = canvasColors(c.confident ? c.canvas : crop);
        subDrafts.push({
          key: `d${++seq}`,
          fileName: file.name,
          status: "ready",
          step: "",
          original: crop,
          raw: rawCrop,
          corrected: fix.applied ? crop : undefined,
          lightOn: fix.applied,
          lightNote: describeLightFix(fix.analysis) ?? undefined,
          cutout: c.canvas,
          alpha: c.alpha,
          holeCount: c.holeCount,
          cutHoles: false,
          useCutout: c.confident,
          tolerance: 20,
          confident: c.confident,
          preview: await previewOf(c.confident ? c.canvas : crop),
          values: fromAnalysis({ ...emptyValues(), colors: cols }, a),
          nameTouched: true,
          note: `Teil ${i + 1} von ${analysis.items.length} aus einem Sammelfoto – Ausschnitt bitte prüfen.`,
        });
      }
      setDrafts((ds) => {
        const idx = ds.findIndex((d) => d.key === key);
        const old = ds[idx];
        if (old?.preview) URL.revokeObjectURL(old.preview);
        return [...ds.slice(0, idx), ...subDrafts, ...ds.slice(idx + 1)];
      });
    } catch (e) {
      update(key, { status: "error", step: "", error: errorMessage(e) });
    }
  }

  function fromAnalysis(v: ItemValues, a: AnalyzedItem): ItemValues {
    const colors = v.colors.length
      ? v.colors
      : a.colorNames.map((f, i) => ({ family: f as ItemValues["colors"][number]["family"], hex: getFamily(f)?.hex ?? "#888888", ratio: i === 0 ? 0.7 : 0.15 }));
    return {
      ...v,
      categoryId: a.categoryId ?? v.categoryId,
      name: a.name,
      subtype: a.subtype,
      pattern: a.pattern,
      material: a.material,
      fit: a.fit,
      styles: a.styles,
      seasons: a.seasons,
      occasions: a.occasions,
      formality: a.formality,
      warmth: a.warmth,
      description: a.description,
      brand: a.brand,
      colors,
      aiAnalyzed: true,
      aiConfidence: a.aiConfidence,
    };
  }

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(hei[cf]|jpe?g|png|webp|avif)$/i.test(f.name));
    if (!list.length) return toast("Bitte Bilddateien auswählen.", "danger");
    for (const f of list) queue.current = queue.current.then(() => processFile(f));
  };

  async function rerunCutout(d: Draft, tolerance: number, cutHoles = d.cutHoles) {
    if (!d.original) return;
    const c = removeBackground(d.original, tolerance, { cutHoles });
    update(d.key, {
      cutout: c.canvas,
      alpha: c.alpha,
      holeCount: c.holeCount,
      cutHoles,
      tolerance,
      confident: c.confident,
      useCutout: true,
      preview: await previewOf(c.canvas),
      values: { ...d.values, colors: canvasColors(c.canvas) },
    });
  }

  /** Switch between the light-corrected photo and the photo as taken, then redo cut-out and colors. */
  async function toggleLight(d: Draft, on: boolean) {
    const base = on ? d.corrected : d.raw;
    if (!base) return;
    const c = removeBackground(base, d.tolerance, { cutHoles: d.cutHoles });
    const shown = d.useCutout ? c.canvas : base;
    update(d.key, { lightOn: on, original: base, cutout: c.canvas, alpha: c.alpha, holeCount: c.holeCount, confident: c.confident, preview: await previewOf(shown), values: { ...d.values, colors: canvasColors(shown) } });
  }

  /** Result of the manual editor: the user checked it, so it counts as a confident cut-out. */
  async function applyEdit(d: Draft, alpha: Uint8ClampedArray) {
    if (!d.original) return;
    const c = composeCutout(d.original, alpha);
    update(d.key, { cutout: c, alpha, useCutout: true, confident: true, note: undefined, preview: await previewOf(c), values: { ...d.values, colors: canvasColors(c) } });
  }

  async function proCutout(d: Draft) {
    if (!d.original) return;
    update(d.key, { step: "Profi-Freistellung läuft…" });
    try {
      const fd = new FormData();
      fd.append("image", await canvasToBlob(d.original, "image/jpeg", 0.92), "photo.jpg");
      const png = await api.post<Blob>("/api/images/remove-background", fd);
      const c = await blobToCanvas(png);
      update(d.key, { cutout: c, alpha: alphaOf(c, d.original), holeCount: 0, useCutout: true, confident: true, step: "", preview: await previewOf(c), values: { ...d.values, colors: canvasColors(c) } });
    } catch (e) {
      update(d.key, { step: "" });
      toast(errorMessage(e), "danger");
    }
  }

  async function switchVersion(d: Draft, useCutout: boolean) {
    const c = useCutout ? d.cutout : d.original;
    if (!c) return;
    update(d.key, { useCutout, preview: await previewOf(c), values: { ...d.values, colors: canvasColors(c) } });
  }

  async function save(d: Draft): Promise<boolean> {
    const parsed = itemInputSchema.safeParse(d.values);
    if (!d.values.categoryId) {
      update(d.key, { note: "Bitte eine Kategorie wählen." });
      return false;
    }
    if (!parsed.success) {
      update(d.key, { note: parsed.error.issues[0]?.message ?? "Angaben unvollständig." });
      return false;
    }
    const canvas = d.useCutout && d.cutout ? d.cutout : d.original;
    if (!canvas) return false;
    update(d.key, { status: "saving" });
    try {
      const fd = new FormData();
      fd.append("image", await canvasToBlob(canvas, d.useCutout ? "image/png" : "image/jpeg", 0.92), d.useCutout ? "item.png" : "item.jpg");
      fd.append("data", JSON.stringify(parsed.data));
      await api.post("/api/items", fd);
      update(d.key, { status: "saved", note: undefined });
      return true;
    } catch (e) {
      update(d.key, { status: "ready", note: errorMessage(e) });
      return false;
    }
  }

  const saveAll = async () => {
    let n = 0;
    for (const d of drafts.filter((x) => x.status === "ready")) if (await save(d)) n++;
    invalidate();
    if (n) toast(`${n} Teil${n > 1 ? "e" : ""} gespeichert`);
  };

  const discard = (d: Draft) => {
    if (d.preview) URL.revokeObjectURL(d.preview);
    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
  };

  const open = drafts.filter((d) => d.status !== "saved");
  const saved = drafts.filter((d) => d.status === "saved");
  const readyCount = drafts.filter((d) => d.status === "ready").length;

  return (
    <div>
      <Link to="/wardrobe" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Kleiderschrank
      </Link>
      <h1 className="font-display text-4xl md:text-5xl">Kleidung hinzufügen</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">Fotografiere jedes Teil am besten flach liegend oder auf dem Bügel vor ruhigem Hintergrund. Du kannst mehrere Fotos auf einmal wählen.</p>

      <div className="mt-5 space-y-3">
        {activeAi ? (
          me.data?.aiImageConsent ? (
            <div className="rounded-2xl bg-surface-2 p-4">
              <Toggle
                checked={useAi}
                onChange={setUseAi}
                label="KI-Erkennung verwenden"
                description={`Fotos werden verkleinert und ohne Metadaten an ${activeAi.provider} gesendet, um Kategorie, Muster und Stil zu erkennen. Freistellung und Farben bleiben lokal.`}
              />
            </div>
          ) : (
            <Notice action={<Button size="sm" variant="outline" onClick={() => setConsentOpen(true)}>Aktivieren</Button>}>
              <strong>KI-Erkennung ist verfügbar</strong>, aber noch nicht aktiviert. Ohne KI stellst du Kategorie und Details selbst ein – Freistellung und Farben funktionieren trotzdem.
            </Notice>
          )
        ) : (
          <Notice action={<ButtonLink to="/style#ki-anbieter" size="sm" variant="outline">KI einrichten</ButtonLink>}>
            <strong>Lokaler Modus:</strong> Freistellung und Farberkennung laufen auf deinem Gerät. Kategorie und Details wählst du selbst. Mit einem eigenen Schlüssel für Claude, Groq oder Gemini erkennt die KI sie automatisch.
          </Notice>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={clsx("mt-5 rounded-3xl border-2 border-dashed p-6 text-center transition-colors", dragOver ? "border-accent bg-accent-soft" : "border-line")}
      >
        <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button size="lg" onClick={() => cameraRef.current?.click()} icon={<Camera className="size-5" />}>
            Foto aufnehmen
          </Button>
          <Button size="lg" variant="outline" onClick={() => galleryRef.current?.click()} icon={<ImagePlus className="size-5" />}>
            Fotos auswählen
          </Button>
        </div>
        <p className="mt-3 hidden text-xs text-muted sm:block">…oder Fotos hierher ziehen. JPEG, PNG, WebP · max. {caps.data?.limits.maxUploadMb ?? 12} MB</p>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
        <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      </div>

      {open.length > 0 && (
        <div className="sticky top-14 z-20 -mx-4 mt-6 flex items-center justify-between gap-3 bg-paper/90 px-4 py-3 backdrop-blur md:top-0 md:-mx-8 md:px-8">
          <span className="text-sm text-muted">
            {open.length} zu prüfen{drafts.some((d) => d.status === "processing") && " · wird verarbeitet…"}
          </span>
          <Button onClick={saveAll} disabled={!readyCount} icon={<Check className="size-4" />}>
            Alle speichern ({readyCount})
          </Button>
        </div>
      )}

      <div className="mt-4 space-y-5">
        {open.map((d) => (
          <section key={d.key} className="animate-fade-up overflow-hidden rounded-[28px] border border-line bg-surface shadow-card" aria-label={`Entwurf ${d.values.name || d.fileName}`}>
            <div className="grid gap-0 md:grid-cols-[320px_minmax(0,1fr)]">
              <div className="border-b border-line p-4 md:border-b-0 md:border-r">
                <div className={clsx("relative aspect-[4/5] overflow-hidden rounded-2xl", d.useCutout ? "checker" : "garment-bg")}>
                  {d.preview ? <img src={d.preview} alt="Vorschau" className="h-full w-full object-contain p-2" /> : <div className="skeleton h-full w-full" />}
                  {(d.status === "processing" || d.step) && (
                    <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-full bg-surface/90 px-3 py-2 text-xs backdrop-blur">
                      <Spinner className="size-3.5" /> {d.step || "Verarbeite…"}
                    </div>
                  )}
                </div>
                {d.original && d.cutout && (
                  <div className="mt-3 space-y-3">
                    <Segmented label="Bildversion" value={d.useCutout ? "cut" : "orig"} onChange={(v) => switchVersion(d, v === "cut")} options={[{ value: "cut", label: "Freigestellt" }, { value: "orig", label: "Original" }]} />
                    {d.corrected && (
                      <div className="rounded-2xl bg-surface-2 p-3">
                        <Toggle
                          checked={d.lightOn}
                          onChange={(on) => toggleLight(d, on)}
                          label="Lichtkorrektur"
                          description={d.lightOn ? d.lightNote : "Aus – Foto wird so verwendet, wie es aufgenommen wurde."}
                        />
                      </div>
                    )}
                    {d.useCutout && (
                      <div>
                        <div className="mb-1 text-xs text-muted">Freistellungs-Toleranz: {d.tolerance}</div>
                        <Slider label="Freistellungs-Toleranz" min={6} max={40} step={1} value={d.tolerance} onChange={(v) => update(d.key, { tolerance: v })} left="genauer" right="großzügiger" />
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" onClick={() => rerunCutout(d, d.tolerance)}>
                            Neu freistellen
                          </Button>
                          {d.alpha && (
                            <Button size="sm" variant="outline" onClick={() => setEditing(d.key)} icon={<Eraser className="size-4" />}>
                              Ausschnitt bearbeiten
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    {d.useCutout && d.holeCount > 0 && (
                      <div className="rounded-2xl bg-surface-2 p-3">
                        <Toggle
                          checked={d.cutHoles}
                          onChange={(on) => rerunCutout(d, d.tolerance, on)}
                          label={d.holeCount === 1 ? "Lücke ausschneiden" : `${d.holeCount} Lücken ausschneiden`}
                          description="Erkannt: eingeschlossene Fläche in Hintergrundfarbe, z. B. im Henkel oder zwischen den Hosenbeinen. Prüfe die Vorschau – ein Aufdruck in Hintergrundfarbe würde mit entfernt."
                        />
                      </div>
                    )}
                    {caps.data?.backgroundRemoval.server && (
                      <Button size="sm" variant="outline" onClick={() => proCutout(d)} icon={<Wand2 className="size-4" />}>
                        Profi-Freistellung ({caps.data.backgroundRemoval.server})
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="p-4 md:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {d.values.aiAnalyzed && (
                    <Badge tone="accent">
                      <Sparkles className="size-3" /> KI-Vorschlag
                    </Badge>
                  )}
                  <span className="truncate text-xs text-muted">{d.fileName}</span>
                </div>
                {d.error && <Notice tone="danger">{d.error}</Notice>}
                {d.note && (
                  <div className="mb-4">
                    <Notice tone="warn">{d.note}</Notice>
                  </div>
                )}
                {d.status !== "error" && (
                  <ItemForm
                    value={d.values}
                    categories={categories}
                    showStatus={false}
                    onChange={(patch) =>
                      update(d.key, (cur) => {
                        const nameTouched = cur.nameTouched || patch.name !== undefined;
                        let values = { ...cur.values, ...patch };
                        if (patch.categoryId) values = applyCategoryDefaults(values, categories.find((c) => c.id === patch.categoryId), nameTouched);
                        return { values, nameTouched, note: undefined };
                      })
                    }
                  />
                )}
                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => discard(d)} icon={<Trash2 className="size-4" />}>
                    Verwerfen
                  </Button>
                  {d.status !== "error" && (
                    <Button
                      onClick={async () => {
                        if (await save(d)) {
                          invalidate();
                          toast("Gespeichert");
                        }
                      }}
                      loading={d.status === "saving"}
                      disabled={d.status === "processing"}
                    >
                      Speichern
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {saved.length > 0 && (
        <div className="mt-8 rounded-3xl bg-ok-soft p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ok">
              <Check className="mr-1 inline size-4" />
              {saved.length} Teil{saved.length > 1 ? "e" : ""} im Kleiderschrank gespeichert.
            </p>
            <ButtonLink to="/wardrobe" size="sm" variant="outline">
              Zum Kleiderschrank
            </ButtonLink>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {saved.map((d) => d.preview && <img key={d.key} src={d.preview} alt={d.values.name} className="size-16 shrink-0 rounded-xl bg-surface object-contain p-1" />)}
          </div>
        </div>
      )}
      <AiConsentSheet open={consentOpen} onOpenChange={setConsentOpen} />
      {(() => {
        const d = drafts.find((x) => x.key === editing);
        if (!d?.original || !d.alpha) return null;
        return <CutoutEditor open onOpenChange={(o) => !o && setEditing(null)} photo={d.original} alpha={d.alpha} onApply={(a) => applyEdit(d, a)} />;
      })()}
    </div>
  );
}
