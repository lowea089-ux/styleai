// Try-on: either realistic via Decart's live AI (TryOnLive) or locally – camera (or a full-body photo) +
// pose detection + the outfit's garments warped onto the body. Loaded lazily, so MediaPipe, the Decart SDK
// and this view only download when someone opens it.
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { AlertTriangle, Camera, Check, Download, Eye, EyeOff, ImagePlus, Loader2, SlidersHorizontal, Sparkles, SwitchCamera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { LandmarkSmoother } from "../../shared/tryon/filter";
import type { Landmark } from "../../shared/tryon/layout";
import type { OutfitItemRef } from "../../shared/types";
import { correctLighting, loadImage } from "../lib/image";
import { useTryonStatus } from "../lib/queries";
import { shareOrDownload } from "../lib/share";
import { kindForRole, prepareGarment, type PreparedGarment } from "../lib/tryon/garment";
import { loadPoseLandmarker } from "../lib/tryon/pose";
import { measureLuma, TryOnRenderer, type PersonMask, type RenderReport } from "../lib/tryon/render";
import { useCategoryMap, useItemMap } from "./garments";
import { LiveTryOn } from "./TryOnLive";
import { Slider, Toggle } from "./ui";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  refs: OutfitItemRef[];
  title: string;
}

export default function TryOn({ open, onOpenChange, refs, title }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none">
          <Dialog.Title className="sr-only">Live-Anprobe: {title}</Dialog.Title>
          {open && <Stage refs={refs} title={title} onClose={() => onOpenChange(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Mode = "intro" | "camera" | "photo" | "live";

interface Settings {
  fit: { size: number; length: number };
  lightMatch: boolean;
  occlusion: boolean;
  hidden: Set<string>;
  garments: PreparedGarment[];
}

function cameraError(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Kein Zugriff auf die Kamera. Erlaube die Kamera in den Einstellungen des Browsers bzw. unter Windows → Datenschutz → Kamera – oder nutze ein Foto.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Keine Kamera gefunden. Du kannst stattdessen ein Ganzkörperfoto verwenden.";
  if (name === "NotReadableError") return "Die Kamera wird gerade von einem anderen Programm verwendet. Schließe es und versuche es erneut.";
  if (name === "Insecure") return "Die Kamera funktioniert nur über eine sichere Verbindung (HTTPS), auf localhost oder in der Desktop-App.";
  return `Die Anprobe konnte nicht gestartet werden: ${(e as Error)?.message ?? String(e)}`;
}

function statusText(r: RenderReport, photo: boolean): string {
  if (!r.body) return photo ? "Auf dem Foto wurde keine Person erkannt. Am besten eignet sich ein Ganzkörperfoto von vorn." : "Stell dich so vor die Kamera, dass Kopf und Oberkörper zu sehen sind.";
  const m = r.missing[0];
  if (!m) return "";
  const hint = photo ? "" : m.reason.startsWith("Hüfte") ? " – geh einen Schritt zurück." : m.reason.startsWith("Füße") ? " – geh weiter zurück, bis die Füße zu sehen sind." : "";
  return `${m.name}: ${m.reason}${hint}`;
}

function Stage({ refs, title, onClose }: { refs: OutfitItemRef[]; title: string; onClose: () => void }) {
  const { map: items } = useItemMap();
  const { map: cats } = useCategoryMap();
  const tryon = useTryonStatus();
  const [mode, setMode] = useState<Mode>("intro");
  const [garments, setGarments] = useState<PreparedGarment[]>([]);
  const [preparing, setPreparing] = useState(true);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [fit, setFit] = useState({ size: 1, length: 1 });
  const [lightMatch, setLightMatch] = useState(true);
  const [occlusion, setOcclusion] = useState(true);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [cameraCount, setCameraCount] = useState(0);
  const [busy, setBusy] = useState<"camera" | "photo" | null>(null);
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [lowLight, setLowLight] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const probeRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const rendererRef = useRef(new TryOnRenderer());
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const smootherRef = useRef(new LandmarkSmoother());
  const photoRef = useRef<{ canvas: HTMLCanvasElement; landmarks: Landmark[] | null; mask: PersonMask | null } | null>(null);
  const preparedRef = useRef(false);
  const settings = useRef<Settings>({ fit, lightMatch, occlusion, hidden, garments });
  settings.current = { fit, lightMatch, occlusion, hidden, garments };

  // Start loading the pose model right away; it is needed for both camera and photo.
  useEffect(() => {
    loadPoseLandmarker()
      .then((l) => {
        landmarkerRef.current = l;
        setModelState("ready");
      })
      .catch(() => setModelState("error"));
  }, []);

  // Prepare the garments once wardrobe and categories are loaded.
  useEffect(() => {
    if (preparedRef.current || !items.size || !cats.size) return;
    preparedRef.current = true;
    (async () => {
      const ready: PreparedGarment[] = [];
      const skip: string[] = [];
      for (const r of refs) {
        const it = items.get(r.itemId);
        if (!it) continue;
        if (!kindForRole(r.role)) {
          skip.push(it.name);
          continue;
        }
        try {
          const g = await prepareGarment(it, cats.get(it.categoryId), r.role);
          if (g) ready.push(g);
          else skip.push(it.name);
        } catch {
          skip.push(it.name);
        }
      }
      setGarments(ready);
      setSkipped(skip);
      setPreparing(false);
    })();
  }, [items, cats, refs]);

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };
  useEffect(() => stopCamera, []);

  async function ensureModel() {
    if (landmarkerRef.current) return landmarkerRef.current;
    const l = await loadPoseLandmarker();
    landmarkerRef.current = l;
    setModelState("ready");
    return l;
  }

  async function startCamera(face = facing) {
    setError(null);
    setBusy("camera");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("insecure"), { name: "Insecure" });
      const lm = await ensureModel();
      await lm.setOptions({ runningMode: "VIDEO" });
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setCameraCount(d.filter((x) => x.kind === "videoinput").length))
        .catch(() => undefined);
      smootherRef.current.reset();
      photoRef.current = null;
      setFacing(face);
      setStatus("");
      setMode("camera");
      runLoop();
    } catch (e) {
      stopCamera();
      setError(cameraError(e));
    } finally {
      setBusy(null);
    }
  }

  function runLoop() {
    cancelAnimationFrame(rafRef.current);
    let lastTime = -1;
    let frame = 0;
    let boost = 1;
    let luma = 0.5;
    let lastSeen = 0;
    let lastStatus = "";
    let lastLow = false;
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const v = videoRef.current;
      const canvas = canvasRef.current;
      const lm = landmarkerRef.current;
      if (!v || !canvas || !lm || v.readyState < 2 || v.currentTime === lastTime) return;
      lastTime = v.currentTime;
      const W = v.videoWidth;
      const H = v.videoHeight;
      if (!W || !H) return;
      const base = baseRef.current;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = base.width = W;
        canvas.height = base.height = H;
      }
      const s = settings.current;
      if (frame++ % 15 === 0) {
        const raw = measureLuma(v, probeRef.current);
        const low = raw < 0.32;
        // Brighten dark rooms before detection: helps the pose model and the preview alike.
        boost = s.lightMatch && low ? Math.min(1.9, 1 + (0.36 - raw) * 2.6) : 1;
        luma = Math.min(1, raw * boost);
        if (low !== lastLow) setLowLight((lastLow = low));
      }
      const bctx = base.getContext("2d")!;
      bctx.filter = boost > 1.02 ? `brightness(${boost.toFixed(2)}) contrast(1.06) saturate(1.05)` : "none";
      bctx.drawImage(v, 0, 0, W, H);
      bctx.filter = "none";
      const now = performance.now();
      let landmarks: Landmark[] | null = null;
      let mask: PersonMask | null = null;
      lm.detectForVideo(base, now, (res) => {
        const p = res.landmarks[0];
        if (!p) return;
        landmarks = smootherRef.current
          .smooth(p.map((l) => ({ x: l.x, y: l.y, visibility: l.visibility ?? 1 })), now / 1000)
          .map((l) => ({ x: l.x * W, y: l.y * H, visibility: l.visibility }));
        lastSeen = now;
        const m = s.occlusion ? res.segmentationMasks?.[0] : undefined;
        // Masks are only valid inside the callback, so copy the data.
        if (m) mask = { data: new Float32Array(m.getAsFloat32Array()), width: m.width, height: m.height };
      });
      if (!landmarks && now - lastSeen > 600) smootherRef.current.reset();
      const visible = s.garments.filter((g) => !s.hidden.has(g.itemId));
      const report = rendererRef.current.render(canvas.getContext("2d")!, base, W, H, landmarks, mask, visible, { fit: s.fit, lightMatch: s.lightMatch, occlusion: s.occlusion, sceneLuma: luma });
      const msg = statusText(report, false);
      if (msg !== lastStatus) setStatus((lastStatus = msg));
    };
    tick();
  }

  async function usePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("photo");
    try {
      const lm = await ensureModel();
      stopCamera();
      let canvas = await loadImage(file, 1600);
      if (settings.current.lightMatch) canvas = correctLighting(canvas).canvas;
      await lm.setOptions({ runningMode: "IMAGE" });
      let landmarks: Landmark[] | null = null;
      let mask: PersonMask | null = null;
      lm.detect(canvas, (res) => {
        const p = res.landmarks[0];
        if (!p) return;
        landmarks = p.map((l) => ({ x: l.x * canvas.width, y: l.y * canvas.height, visibility: l.visibility ?? 1 }));
        const m = res.segmentationMasks?.[0];
        if (m) mask = { data: new Float32Array(m.getAsFloat32Array()), width: m.width, height: m.height };
      });
      photoRef.current = { canvas, landmarks, mask };
      setMode("photo");
    } catch (e) {
      setError(`Das Foto konnte nicht verarbeitet werden: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  // Photo mode re-renders whenever a setting changes.
  useEffect(() => {
    const p = photoRef.current;
    const canvas = canvasRef.current;
    if (mode !== "photo" || !p || !canvas) return;
    canvas.width = p.canvas.width;
    canvas.height = p.canvas.height;
    const visible = garments.filter((g) => !hidden.has(g.itemId));
    const report = rendererRef.current.render(canvas.getContext("2d")!, p.canvas, canvas.width, canvas.height, p.landmarks, occlusion ? p.mask : null, visible, {
      fit,
      lightMatch,
      occlusion,
      sceneLuma: measureLuma(p.canvas, probeRef.current),
    });
    setStatus(statusText(report, true));
  }, [mode, garments, hidden, fit, lightMatch, occlusion]);

  const mirrored = mode === "camera" && facing === "user";

  async function snapshot() {
    const c = canvasRef.current;
    if (!c) return;
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const o = out.getContext("2d")!;
    if (mirrored) {
      o.translate(c.width, 0);
      o.scale(-1, 1);
    }
    o.drawImage(c, 0, 0);
    try {
      const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erstellt werden."))), "image/jpeg", 0.92));
      await shareOrDownload(blob, "anprobe.jpg", title, `Anprobe: ${title}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const toggleHidden = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const canStart = !preparing && garments.length > 0 && modelState !== "error";
  const photoInput = (label: string, className: string) => (
    <label className={clsx(className, (!canStart || busy) && "pointer-events-none opacity-50")}>
      {busy === "photo" ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
      {label}
      <input type="file" accept="image/*" hidden disabled={!canStart || !!busy} onChange={(e) => (usePhoto(e.target.files?.[0]), (e.target.value = ""))} />
    </label>
  );

  if (mode === "live" && tryon.data) return <LiveTryOn refs={refs} title={title} status={tryon.data} onBack={() => setMode("intro")} onClose={onClose} />;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/60">Live-Anprobe</div>
          <div className="truncate font-display text-lg">{title}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Anprobe schließen" className="pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25">
          <X className="size-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted className="pointer-events-none absolute size-px opacity-0" />
        <canvas ref={canvasRef} className={clsx("max-h-full max-w-full", mode === "intro" && "hidden", mirrored && "-scale-x-100")} />

        {mode === "intro" && (
          <div className="mx-auto max-h-full w-full max-w-md overflow-y-auto px-5 py-20 text-center">
            <h2 className="font-display text-3xl">{refs.length === 1 ? "Teil anprobieren" : "Outfit anprobieren"}</h2>
            <div className="mt-5 rounded-3xl border border-white/15 bg-white/[0.07] p-4 text-left">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4" />
                <span className="font-medium">Realistisch mit KI</span>
                <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/80">Decart · Cloud</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-white/70">
                Eine KI zieht dir die Kleidung live und fotorealistisch an – mit Faltenwurf und jeder Bewegung. Das Kamerabild wird dafür an Decart übertragen, es fallen Kosten an.
              </p>
              {tryon.isLoading ? (
                <Loader2 className="mt-3 size-4 animate-spin" />
              ) : tryon.data?.available ? (
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setMode("live");
                  }}
                  className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black transition hover:bg-white/90"
                >
                  <Sparkles className="size-4" /> Realistisch anprobieren
                </button>
              ) : (
                <Link to="/style#live-anprobe" onClick={onClose} className="mt-3 inline-flex h-10 items-center rounded-full border border-white/30 px-4 text-sm transition hover:bg-white/10">
                  Decart-Schlüssel einrichten
                </Link>
              )}
            </div>
            <div className="mt-6 text-left text-[11px] uppercase tracking-[0.14em] text-white/50">Schnell & lokal · kostenlos</div>
            <p className="mt-1 text-left text-sm leading-relaxed text-white/75">
              Die Kamera erkennt deinen Körper und legt deine Kleidungsfotos über das Bild – nichts verlässt das Gerät. Stell dich etwa 2–3 Meter vor die Kamera, von vorn und gut beleuchtet.
            </p>
            <ul className="mt-5 space-y-1.5 text-left text-sm">
              {preparing && (
                <li className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2">
                  <Loader2 className="size-4 animate-spin" /> Kleidungsstücke werden vorbereitet…
                </li>
              )}
              {garments.map((g) => (
                <li key={g.itemId} className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2">
                  {g.warning ? <AlertTriangle className="size-4 shrink-0 text-amber-300" /> : <Check className="size-4 shrink-0 text-emerald-300" />}
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  {g.warning && <span className="shrink-0 text-xs text-amber-200">{g.warning}</span>}
                </li>
              ))}
              {skipped.map((n) => (
                <li key={n} className="flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 text-white/55">
                  <EyeOff className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{n}</span>
                  <span className="shrink-0 text-xs">wird nicht angezeigt</span>
                </li>
              ))}
            </ul>
            {!preparing && garments.length === 0 && <p className="mt-4 text-sm text-amber-200">Hier ist kein Teil dabei, das sich lokal anprobieren lässt (z. B. Schmuck).</p>}
            {modelState === "error" && <p className="mt-4 text-sm text-red-200">Die Körpererkennung konnte nicht geladen werden. Bitte die Seite neu laden.</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => startCamera()}
                disabled={!canStart || !!busy}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                {busy === "camera" ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                Kamera starten
              </button>
              {photoInput("Foto verwenden", "inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/30 px-6 text-[15px] font-medium transition hover:bg-white/10")}
            </div>
            {modelState === "loading" && !preparing && <p className="mt-3 text-xs text-white/50">Körpererkennung wird geladen…</p>}
            {error && (
              <p role="alert" className="mt-4 rounded-2xl bg-red-500/15 px-4 py-3 text-left text-sm text-red-100">
                {error}
              </p>
            )}
            <p className="mt-6 text-xs leading-relaxed text-white/50">
              Kamerabild und Foto werden nur auf diesem Gerät verarbeitet – nichts wird hochgeladen oder gespeichert, außer du sicherst selbst ein Bild.
            </p>
          </div>
        )}

        {mode !== "intro" && (status || (lowLight && lightMatch && mode === "camera")) && (
          <div className="pointer-events-none absolute inset-x-4 top-20 flex flex-col items-center gap-2" role="status" aria-live="polite">
            {status && <div className="max-w-md rounded-full bg-black/65 px-4 py-2 text-center text-sm backdrop-blur">{status}</div>}
            {lowLight && lightMatch && mode === "camera" && <div className="rounded-full bg-black/50 px-3 py-1 text-xs text-white/80 backdrop-blur">Wenig Licht – das Bild wird automatisch aufgehellt</div>}
          </div>
        )}
      </div>

      {mode !== "intro" && (
        <div className="z-10 space-y-3 bg-gradient-to-t from-black via-black/85 to-black/40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {error && (
            <p role="alert" className="rounded-2xl bg-red-500/15 px-4 py-2 text-sm text-red-100">
              {error}
            </p>
          )}
          {showSettings && (
            <div className="mx-auto grid max-w-2xl gap-4 rounded-3xl bg-white/10 p-4 backdrop-blur sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-white/70">Größe</div>
                <Slider label="Größe" min={0.8} max={1.4} step={0.02} value={fit.size} onChange={(v) => setFit((f) => ({ ...f, size: v }))} left="enger" right="weiter" />
              </div>
              <div>
                <div className="mb-1 text-xs text-white/70">Länge</div>
                <Slider label="Länge" min={0.8} max={1.3} step={0.02} value={fit.length} onChange={(v) => setFit((f) => ({ ...f, length: v }))} left="kürzer" right="länger" />
              </div>
              <Toggle checked={lightMatch} onChange={setLightMatch} label="Licht automatisch anpassen" description="Hellt dunkle Räume auf und passt die Kleidung an die Raumhelligkeit an." />
              <Toggle checked={occlusion} onChange={setOcclusion} label="Kopf & Hände im Vordergrund" description="Gesicht und Hände bleiben vor Kragen und Oberteil." />
            </div>
          )}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {garments.map((g) => {
              const off = hidden.has(g.itemId);
              return (
                <button
                  key={g.itemId}
                  type="button"
                  onClick={() => toggleHidden(g.itemId)}
                  aria-pressed={!off}
                  className={clsx("flex h-11 shrink-0 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] transition", off ? "border-white/15 text-white/45" : "border-white/40 bg-white/10")}
                >
                  <img src={g.thumb} alt="" className={clsx("size-9 rounded-full bg-white/80 object-contain p-0.5", off && "opacity-40")} />
                  <span className="max-w-[9rem] truncate">{g.name}</span>
                  {off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={() => setShowSettings((s) => !s)} aria-pressed={showSettings} aria-label="Anpassen" title="Anpassen" className={clsx("flex size-11 items-center justify-center rounded-full transition", showSettings ? "bg-white text-black" : "bg-white/15 hover:bg-white/25")}>
              <SlidersHorizontal className="size-5" />
            </button>
            {mode === "camera" && cameraCount > 1 && (
              <button type="button" onClick={() => startCamera(facing === "user" ? "environment" : "user")} aria-label="Kamera wechseln" title="Kamera wechseln" className="flex size-11 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25">
                <SwitchCamera className="size-5" />
              </button>
            )}
            <button type="button" onClick={snapshot} aria-label="Bild speichern oder teilen" title="Bild speichern oder teilen" className="flex size-16 items-center justify-center rounded-full border-4 border-white/40 bg-white text-black transition hover:bg-white/90">
              <Download className="size-6" />
            </button>
            {mode === "camera"
              ? photoInput("Foto", "flex h-11 cursor-pointer items-center gap-2 rounded-full bg-white/15 px-4 text-sm transition hover:bg-white/25")
              : (
                <button type="button" onClick={() => startCamera()} disabled={!!busy} className="flex h-11 items-center gap-2 rounded-full bg-white/15 px-4 text-sm transition hover:bg-white/25 disabled:opacity-50">
                  {busy === "camera" ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Kamera
                </button>
              )}
          </div>
        </div>
      )}
    </>
  );
}
