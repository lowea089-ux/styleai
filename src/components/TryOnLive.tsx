// Realistic live try-on (Decart Lucy VTON), modelled on the flow of Decart's Anywear demo:
// window → body outline with "step back" guidance → automatic start once framed → live AI video with a
// session countdown → switch garments without reconnecting.
import type { ConnectionState } from "@decartai/sdk";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Check, Download, Loader2, Play, RotateCcw, Timer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { collectGarments, vtonPlans, type VtonPlan } from "../../shared/tryon/vton";
import type { OutfitItemRef, TryonStatus } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { qk } from "../lib/queries";
import { shareOrDownload } from "../lib/share";
import { garmentReference, startLiveSession, type LiveSession } from "../lib/tryon/decart";
import { loadPoseLandmarker } from "../lib/tryon/pose";
import { useCategoryMap, useItemMap } from "./garments";

type Phase = "consent" | "camera" | "framing" | "connecting" | "live" | "ended";
type Framing = "none" | "close" | "ready";

const PRICE_NOTE = "laut Decart-Preisliste ca. 0,02 $ pro Sekunde (Stand November 2026)";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

export function LiveTryOn({ refs, title, status, onBack, onClose }: { refs: OutfitItemRef[]; title: string; status: TryonStatus; onBack: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const { map: items } = useItemMap();
  const { map: cats } = useCategoryMap();
  const plans = useMemo(() => vtonPlans(collectGarments(refs, items, cats)), [refs, items, cats]);
  const [phase, setPhase] = useState<Phase>(status.consent ? "camera" : "consent");
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [framing, setFraming] = useState<Framing>("none");
  const [kneesMissing, setKneesMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(status.maxSessionSeconds);

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  /** Latest phase, also from inside async callbacks. */
  const currentPhase = () => phaseRef.current;
  const refsCache = useRef(new Map<string, Blob>());
  const plan = plans.find((p) => p.key === planKey) ?? plans[0];
  const planRef = useRef(plan);
  planRef.current = plan;

  const stopSession = () => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
  };
  const stopAll = () => {
    stopSession();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => stopAll, []);

  const end = (msg: string) => {
    stopSession();
    setMessage(msg);
    setPhase("ended");
  };

  async function reference(p: VtonPlan) {
    const cached = refsCache.current.get(p.key);
    if (cached) return cached;
    const blob = await garmentReference(p.itemIds.map((id) => items.get(id)!).filter(Boolean));
    refsCache.current.set(p.key, blob);
    return blob;
  }

  // 1. Camera (model resolution: 1280×720, front camera).
  async function startCamera() {
    setError(null);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: "Insecure" });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } });
      streamRef.current = stream;
      const v = localRef.current!;
      v.srcObject = stream;
      await v.play();
      setPhase("framing");
    } catch (e) {
      const name = (e as Error).name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Kein Zugriff auf die Kamera. Erlaube die Kamera in den Einstellungen des Browsers bzw. unter Windows → Datenschutz → Kamera."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "Keine Kamera gefunden."
            : name === "NotReadableError"
              ? "Die Kamera wird gerade von einem anderen Programm verwendet."
              : name === "Insecure"
                ? "Die Kamera funktioniert nur über HTTPS, auf localhost oder in der Desktop-App."
                : `Die Kamera konnte nicht gestartet werden: ${(e as Error).message}`,
      );
    }
  }
  useEffect(() => {
    if (phase === "camera") startCamera();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Framing guide with local pose detection; also pauses the paid session when nobody is in view.
  useEffect(() => {
    if (phase !== "framing" && phase !== "live") return;
    let stop = false;
    let readySince = 0;
    let lastSeen = performance.now();
    let timer = 0;
    (async () => {
      const lm = await loadPoseLandmarker().catch(() => null);
      if (!lm || stop) return;
      await lm.setOptions({ runningMode: "VIDEO" });
      const tick = () => {
        if (stop) return;
        const v = localRef.current;
        if (v && v.readyState >= 2) {
          // Assigned inside the detector callback.
          let state = "none" as Framing;
          let knees = false;
          lm.detectForVideo(v, performance.now(), (res) => {
            const p = res.landmarks[0];
            if (!p) return;
            const vis = (i: number) => (p[i]?.visibility ?? 0) > 0.5;
            const shoulders = vis(11) && vis(12);
            const hips = vis(23) && vis(24);
            knees = vis(25) && vis(26);
            const wide = shoulders && Math.abs(p[11].x - p[12].x) > 0.42;
            state = shoulders && hips && !wide ? "ready" : shoulders || vis(0) ? "close" : "none";
          });
          const now = performance.now();
          if (phaseRef.current === "framing") {
            setFraming(state);
            setKneesMissing(state === "ready" && !knees);
            readySince = state === "ready" ? readySince || now : 0;
            // Start automatically once the person stands in the outline for a moment.
            if (readySince && now - readySince > 900) {
              readySince = 0;
              connect(planRef.current);
            }
          } else if (phaseRef.current === "live") {
            if (state !== "none") lastSeen = now;
            else if (now - lastSeen > 6000) end("Niemand mehr im Bild – die Sitzung wurde beendet, damit keine Kosten entstehen.");
          }
        }
        timer = window.setTimeout(tick, phaseRef.current === "live" ? 500 : 150);
      };
      tick();
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. Connect to Decart with the selected garments as the initial state.
  async function connect(p: VtonPlan | undefined = plan) {
    if (!p || !streamRef.current || phaseRef.current === "connecting" || phaseRef.current === "live") return;
    setPhase("connecting");
    setError(null);
    setMessage("Verbinde mit der KI …");
    try {
      const image = await reference(p);
      const session = await startLiveSession(streamRef.current, status.model, { image, prompt: p.prompt }, {
        onRemoteStream: (s) => {
          if (remoteRef.current) remoteRef.current.srcObject = s;
        },
        onState: (s: ConnectionState) => {
          if (s === "generating" && phaseRef.current === "connecting") {
            setPhase("live");
            setMessage(null);
          } else if (s === "connected" && phaseRef.current === "connecting") setMessage("Kleidung wird angelegt …");
          else if (s === "reconnecting") setMessage("Verbindung wird wiederhergestellt …");
          else if (s === "generating") setMessage(null);
        },
        onEnded: (msg) => end(msg),
        onError: (msg) => setError(msg),
        onCapacityWait: (sec) => setMessage(`Decart ist gerade ausgelastet – neuer Versuch in ${sec} s …`),
      });
      // Closed or ended while connecting: do not leave a paid session running.
      if (currentPhase() !== "connecting" && currentPhase() !== "live") {
        session.disconnect();
        return;
      }
      sessionRef.current = session;
      setPlanKey(p.key);
      setRemaining(session.maxSessionSeconds);
    } catch (e) {
      stopSession();
      setError(errorMessage(e));
      setMessage(null);
      setPhase("framing");
    }
  }

  // 4. Countdown while the AI is generating; Decart also ends the session at the same limit.
  useEffect(() => {
    if (phase !== "live") return;
    const t = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(t);
          end("Zeit abgelaufen – die Sitzung ist beendet.");
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(p: VtonPlan) {
    if (phase !== "live" || !sessionRef.current) {
      setPlanKey(p.key);
      return;
    }
    setApplying(p.key);
    try {
      await sessionRef.current.setGarment(await reference(p), p.prompt);
      setPlanKey(p.key);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setApplying(null);
    }
  }

  async function giveConsent() {
    setBusy(true);
    try {
      qc.setQueryData(qk.tryon, await api.put<TryonStatus>("/api/tryon/settings", { consent: true }));
      setPhase("camera");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function snapshot() {
    const v = remoteRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (blob) await shareOrDownload(blob, "anprobe.jpg", title, `Anprobe: ${title}`).catch(() => undefined);
  }

  const restart = () => {
    setMessage(null);
    setError(null);
    setRemaining(status.maxSessionSeconds);
    setPhase(streamRef.current ? "framing" : "camera");
  };

  const guide = framing === "ready" ? "Perfekt – bleib kurz so" : framing === "close" ? "Tritt einen Schritt zurück" : "Stell dich in den Umriss";

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-0 sm:p-6">
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[#111] sm:h-auto sm:max-h-full sm:rounded-2xl sm:border sm:border-white/10 sm:shadow-2xl">
        {/* Window title bar */}
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onBack} aria-label="Zurück zur Auswahl" title="Zurück" className="flex size-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1 text-center text-[13px] text-white/80">
            Live-Anprobe <span className="text-white/40">•</span> <span className="truncate">{title}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Anprobe schließen" className="flex size-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        {/* Stage */}
        <div className="relative aspect-video max-h-[70dvh] w-full flex-shrink overflow-hidden bg-black max-sm:flex-1 max-sm:aspect-auto">
          <video ref={localRef} muted playsInline className={clsx("absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity", phase === "live" ? "opacity-0" : "opacity-40")} />
          <video ref={remoteRef} autoPlay muted playsInline className={clsx("absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity", phase === "live" ? "opacity-100" : "opacity-0")} />

          {phase === "consent" && (
            <div className="absolute inset-0 overflow-y-auto bg-[#111] p-5 sm:p-8">
              <h2 className="font-display text-2xl">Realistische Anprobe mit KI</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
                Eine KI von <strong>Decart</strong> zieht dir die gewählte Kleidung live und fotorealistisch an – mit Faltenwurf und jeder Bewegung. Dafür wird dein Kamerabild während der Sitzung
                an Decart (decart.ai) gesendet und dort verarbeitet, zusammen mit den Fotos der gewählten Teile.
              </p>
              <ul className="mt-3 max-w-xl list-disc space-y-1 pl-5 text-sm text-white/70">
                <li>Kosten über den Decart-Schlüssel: {PRICE_NOTE}.</li>
                <li>Jede Sitzung endet automatisch nach höchstens {status.maxSessionSeconds} Sekunden und sobald niemand mehr im Bild ist.</li>
                <li>Ohne Einwilligung bleibt die lokale Anprobe verfügbar, die nichts überträgt.</li>
              </ul>
              <label className="mt-4 flex max-w-xl cursor-pointer items-start gap-3 rounded-2xl border border-white/15 p-3 text-sm">
                <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} className="mt-0.5 size-4 accent-white" />
                <span>Ich willige ein, dass mein Kamerabild während der realistischen Anprobe live an Decart übertragen wird. Widerruf jederzeit unter „Mein Stil“.</span>
              </label>
              {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
              <button
                type="button"
                onClick={giveConsent}
                disabled={!consentChecked || busy}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Zustimmen & Kamera starten
              </button>
            </div>
          )}

          {(phase === "camera" || phase === "framing") && (
            <>
              <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                <path
                  d="M80 12 c-7 0 -11.5 5.5 -11.5 12.5 c0 5 2.5 9.5 6 11.5 l0 3 c-10 2 -19 5 -22.5 10 c-3 4 -4 16 -4.5 41 l65 0 c-0.5 -25 -1.5 -37 -4.5 -41 c-3.5 -5 -12.5 -8 -22.5 -10 l0 -3 c3.5 -2 6 -6.5 6 -11.5 c0 -7 -4.5 -12.5 -11.5 -12.5 z"
                  fill="none"
                  stroke={framing === "ready" ? "#86efac" : "rgba(255,255,255,0.85)"}
                  strokeWidth="0.6"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4 text-center" role="status" aria-live="polite">
                <span className={clsx("rounded-full px-4 py-1.5 text-sm font-medium backdrop-blur", framing === "ready" ? "bg-emerald-500/80 text-white" : "bg-black/60 text-white")}>
                  {phase === "camera" ? "Kamera wird gestartet …" : guide}
                </span>
                {kneesMissing && plan?.itemIds.length === 2 && <span className="rounded-full bg-black/50 px-3 py-1 text-xs text-white/80">Tipp: Für die Hose weiter zurück, bis die Knie zu sehen sind</span>}
              </div>
            </>
          )}

          {phase === "connecting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 text-center" role="status" aria-live="polite">
              <Loader2 className="size-8 animate-spin" />
              <span className="text-sm text-white/85">{message}</span>
            </div>
          )}

          {phase === "live" && (
            <>
              <div className={clsx("absolute left-3 top-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium tabular-nums backdrop-blur", remaining <= 10 ? "bg-red-600/80" : "bg-black/60")}>
                <Timer className="size-3.5" /> {fmt(remaining)}
              </div>
              <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-emerald-600/85 px-2.5 py-1 text-xs font-medium">
                <span className="size-1.5 animate-pulse rounded-full bg-white" /> Live
              </div>
              {message && <div className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-black/60 px-3 py-1 text-xs">{message}</div>}
            </>
          )}

          {phase === "ended" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 p-6 text-center">
              <p className="max-w-sm text-sm text-white/85">{message}</p>
              <div className="flex gap-2">
                <button type="button" onClick={restart} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black">
                  <RotateCcw className="size-4" /> Nochmal
                </button>
                <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-full border border-white/30 px-4 text-sm">
                  Schließen
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Garments + actions */}
        {phase !== "consent" && (
          <div className="space-y-3 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {error && (
              <p role="alert" className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            )}
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3">
              {plans.map((p) => {
                const active = p.key === (plan?.key ?? null);
                const first = items.get(p.itemIds[0]);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => choose(p)}
                    disabled={!!applying || phase === "connecting"}
                    aria-pressed={active}
                    className={clsx("flex h-11 shrink-0 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] transition disabled:opacity-60", active ? "border-white bg-white text-black" : "border-white/20 hover:border-white/50")}
                  >
                    <span className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-white">
                      {first && <img src={first.thumbUrl} alt="" className="size-full object-contain p-0.5" />}
                    </span>
                    <span className="max-w-[10rem] truncate">{p.label}</span>
                    {applying === p.key && <Loader2 className="size-3.5 animate-spin" />}
                  </button>
                );
              })}
              {plans.length === 0 && <span className="text-sm text-white/60">Hier ist kein Teil dabei, das die KI anziehen kann (z. B. Schmuck, Gürtel, Taschen).</span>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-white/45">
                Kamerabild wird live an Decart übertragen · max. {status.maxSessionSeconds} s{status.remainingToday !== null ? ` · heute noch ${status.remainingToday} Sitzungen` : ""}
              </p>
              <div className="flex gap-2">
                {phase === "camera" && error && (
                  <button type="button" onClick={startCamera} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 px-3 text-sm hover:bg-white/10">
                    <RotateCcw className="size-3.5" /> Kamera erneut starten
                  </button>
                )}
                {phase === "framing" && (
                  <button type="button" onClick={() => connect()} disabled={!plan} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 px-3 text-sm hover:bg-white/10 disabled:opacity-50">
                    <Play className="size-3.5" /> Jetzt starten
                  </button>
                )}
                {phase === "live" && (
                  <>
                    <button type="button" onClick={snapshot} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-medium text-black">
                      <Download className="size-3.5" /> Bild speichern
                    </button>
                    <button type="button" onClick={() => end("Sitzung beendet.")} className="inline-flex h-9 items-center rounded-full border border-white/25 px-3 text-sm hover:bg-white/10">
                      Beenden
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
