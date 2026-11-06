// Manual touch-up of a cut-out: erase or restore with a soft brush, or tap a region (magic wand).
// Removed parts stay faintly visible, so missing pieces of the garment can be painted back.
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Brush, Eraser, Redo2, RotateCcw, Undo2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { applyRegion, brushStroke, regionGrow } from "../../shared/vision/edit";
import { Button, Segmented, Slider } from "./ui";

type Tool = "erase" | "restore";
type Mode = "brush" | "wand";

export function CutoutEditor({
  open,
  onOpenChange,
  photo,
  alpha: initial,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  photo: HTMLCanvasElement;
  alpha: Uint8ClampedArray;
  onApply: (alpha: Uint8ClampedArray) => void;
}) {
  const W = photo.width;
  const H = photo.height;
  const [tool, setTool] = useState<Tool>("erase");
  const [mode, setMode] = useState<Mode>("wand");
  const [size, setSize] = useState(Math.round(Math.max(W, H) * 0.025));
  const [wandTol, setWandTol] = useState(16);
  const [, setVersion] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const alphaRef = useRef<Uint8ClampedArray>(new Uint8ClampedArray(initial));
  const undo = useRef<Uint8ClampedArray[]>([]);
  const redo = useRef<Uint8ClampedArray[]>([]);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const cutRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<ImageData | null>(null);
  const rgbaRef = useRef<Uint8ClampedArray | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  // Callback ref: the dialog content mounts in a portal, so measure once the element really exists.
  const [stageEl, stageRef] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Fit the photo into the available area without distortion.
  useEffect(() => {
    const el = stageEl;
    if (!open || !el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min((r.width - 24) / W, (r.height - 24) / H);
      setBox({ w: Math.max(1, Math.floor(W * s)), h: Math.max(1, Math.floor(H * s)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, W, H, stageEl]);

  // Draw the photo once; the cut-out layer gets the photo's pixels with the edited alpha.
  useEffect(() => {
    if (!open) return;
    alphaRef.current = new Uint8ClampedArray(initial);
    undo.current = [];
    redo.current = [];
    const raf = requestAnimationFrame(() => {
      const base = baseRef.current;
      const cut = cutRef.current;
      if (!base || !cut) return;
      base.width = cut.width = W;
      base.height = cut.height = H;
      base.getContext("2d")!.drawImage(photo, 0, 0);
      const src = photo.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H);
      rgbaRef.current = new Uint8ClampedArray(src.data);
      imgRef.current = src;
      redraw();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, photo, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  function redraw(rect?: { x: number; y: number; w: number; h: number }) {
    const img = imgRef.current;
    const ctx = cutRef.current?.getContext("2d");
    if (!img || !ctx) return;
    const a = alphaRef.current;
    const r = rect ?? { x: 0, y: 0, w: W, h: H };
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) img.data[(y * W + x) * 4 + 3] = a[y * W + x];
    ctx.putImageData(img, 0, 0, r.x, r.y, r.w, r.h);
  }

  const snapshot = () => {
    undo.current.push(new Uint8ClampedArray(alphaRef.current));
    if (undo.current.length > 20) undo.current.shift();
    redo.current = [];
    setVersion((v) => v + 1);
  };

  const toSource = (e: ReactPointerEvent) => {
    const r = cutRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, sx: e.clientX - r.left, sy: e.clientY - r.top, k: r.width / W };
  };

  function onDown(e: ReactPointerEvent) {
    const p = toSource(e);
    snapshot();
    if (mode === "wand") {
      const a = alphaRef.current;
      const rgba = rgbaRef.current;
      if (!rgba) return;
      const region = regionGrow(rgba, W, H, p.x, p.y, wandTol, tool === "erase" ? (i) => a[i] > 127 : (i) => a[i] <= 127);
      applyRegion(a, region, W, H, tool === "erase" ? 0 : 255);
      redraw();
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    last.current = p;
    const box = brushStroke(alphaRef.current, W, H, p, p, size, tool);
    if (box) redraw(box);
  }

  function onMove(e: ReactPointerEvent) {
    const p = toSource(e);
    setCursor({ x: p.sx, y: p.sy });
    if (mode !== "brush" || !last.current || !(e.buttons & 1)) return;
    const box = brushStroke(alphaRef.current, W, H, last.current, p, size, tool);
    last.current = p;
    if (box) redraw(box);
  }

  const step = (from: { current: Uint8ClampedArray[] }, to: { current: Uint8ClampedArray[] }) => {
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(new Uint8ClampedArray(alphaRef.current));
    alphaRef.current = prev;
    redraw();
    setVersion((v) => v + 1);
  };

  const k = box.w / W || 1;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-50 flex flex-col bg-surface outline-none sm:inset-6 sm:rounded-3xl sm:border sm:border-line sm:shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <Dialog.Title className="font-display text-xl">Ausschnitt bearbeiten</Dialog.Title>
              <p className="text-xs text-muted">
                {mode === "wand" ? "Tippe auf eine Fläche, um sie" : "Male über Stellen, um sie"} {tool === "erase" ? "zu entfernen" : "wiederherzustellen"}. Entfernte Bereiche sind blass zu sehen.
              </p>
            </div>
            <Dialog.Close className="flex size-9 items-center justify-center rounded-full hover:bg-surface-2" aria-label="Schließen">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-2 p-3">
            <div className="checker relative overflow-hidden rounded-xl" style={{ width: box.w, height: box.h }}>
              <canvas ref={baseRef} className="absolute inset-0 h-full w-full opacity-25" />
              <canvas
                ref={cutRef}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={() => (last.current = null)}
                onPointerLeave={() => setCursor(null)}
                className={clsx("absolute inset-0 h-full w-full touch-none", mode === "wand" ? "cursor-crosshair" : "cursor-none")}
              />
              {mode === "brush" && cursor && (
                <div
                  className={clsx("pointer-events-none absolute rounded-full border-2", tool === "erase" ? "border-danger" : "border-ok")}
                  style={{ left: cursor.x - size * k, top: cursor.y - size * k, width: size * 2 * k, height: size * 2 * k }}
                />
              )}
            </div>
          </div>

          <div className="space-y-3 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Werkzeug"
                value={tool}
                onChange={setTool}
                options={[
                  { value: "erase", label: <span className="inline-flex items-center gap-1"><Eraser className="size-3.5" /> Entfernen</span> },
                  { value: "restore", label: <span className="inline-flex items-center gap-1"><Brush className="size-3.5" /> Wiederherstellen</span> },
                ]}
              />
              <Segmented
                label="Art"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "wand", label: <span className="inline-flex items-center gap-1"><Wand2 className="size-3.5" /> Antippen</span> },
                  { value: "brush", label: <span className="inline-flex items-center gap-1"><Brush className="size-3.5" /> Pinsel</span> },
                ]}
              />
              <div className="ml-auto flex gap-1">
                <button type="button" onClick={() => step(undo, redo)} disabled={!undo.current.length} className="flex size-9 items-center justify-center rounded-full hover:bg-surface-2 disabled:opacity-40" aria-label="Rückgängig" title="Rückgängig">
                  <Undo2 className="size-4" />
                </button>
                <button type="button" onClick={() => step(redo, undo)} disabled={!redo.current.length} className="flex size-9 items-center justify-center rounded-full hover:bg-surface-2 disabled:opacity-40" aria-label="Wiederholen" title="Wiederholen">
                  <Redo2 className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    snapshot();
                    alphaRef.current = new Uint8ClampedArray(initial);
                    redraw();
                  }}
                  className="flex size-9 items-center justify-center rounded-full hover:bg-surface-2"
                  aria-label="Automatischen Ausschnitt wiederherstellen"
                  title="Automatischen Ausschnitt wiederherstellen"
                >
                  <RotateCcw className="size-4" />
                </button>
              </div>
            </div>
            <div className="max-w-sm">
              {mode === "brush" ? (
                <>
                  <div className="mb-1 text-xs text-muted">Pinselgröße</div>
                  <Slider label="Pinselgröße" min={Math.max(2, Math.round(Math.max(W, H) * 0.004))} max={Math.round(Math.max(W, H) * 0.08)} step={1} value={size} onChange={setSize} left="fein" right="grob" />
                </>
              ) : (
                <>
                  <div className="mb-1 text-xs text-muted">Farbähnlichkeit beim Antippen</div>
                  <Slider label="Farbähnlichkeit" min={4} max={40} step={1} value={wandTol} onChange={setWandTol} left="genau" right="großzügig" />
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Abbrechen
              </Button>
              <Button
                onClick={() => {
                  onApply(new Uint8ClampedArray(alphaRef.current));
                  onOpenChange(false);
                }}
              >
                Übernehmen
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
