import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, KeyRound, ScanFace, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { TryonStatus } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { qk, useTryonStatus } from "../lib/queries";
import { Badge, Button, Card, Field, Input, Notice, Skeleton, Slider, useToast } from "./ui";
import { LOCAL_EDITION } from "../lib/edition";

/** Decart key, session length and camera consent for the realistic live try-on. */
export function TryonSettings() {
  const status = useTryonStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const s = status.data;
  const [apiKey, setApiKey] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);

  useEffect(() => {
    if (s) {
      setSeconds(s.maxSessionSeconds);
      setConsent(s.consent);
    }
  }, [s?.maxSessionSeconds, s?.consent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status.isLoading) return <Skeleton className="h-56" />;
  if (status.isError || !s) return <Notice tone="danger">{errorMessage(status.error)}</Notice>;

  const save = async () => {
    setBusy("save");
    try {
      const next = await api.put<TryonStatus>("/api/tryon/settings", { apiKey: apiKey.trim() || null, maxSessionSeconds: seconds, consent });
      qc.setQueryData(qk.tryon, next);
      setApiKey("");
      toast(apiKey.trim() ? "Decart-Schlüssel geprüft und gespeichert" : "Einstellungen gespeichert");
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      qc.setQueryData(qk.tryon, await api.del<TryonStatus>("/api/tryon/settings"));
      toast("Schlüssel und Einwilligung entfernt", "info");
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div id="live-anprobe" className="mb-1 flex items-center gap-2">
        <ScanFace className="size-5" />
        <h2 className="font-display text-2xl">Realistische Live-Anprobe</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Mit Decart (Modell Lucy VTON) zieht dir eine KI deine Outfits live und fotorealistisch an. Dein Kamerabild wird dafür während einer Sitzung an Decart übertragen. Kosten entstehen im
        Decart-Konto (laut Decart-Preisliste ca. 0,02 $ pro Sekunde, Stand November 2026; neue Konten erhalten Testguthaben). Die lokale Anprobe funktioniert auch ohne.
      </p>

      <div className="mb-5 rounded-2xl bg-surface-2 p-4 text-sm">
        {s.available ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ok">
              <CheckCircle2 className="size-3" /> Bereit
            </Badge>
            <span className="text-muted">
              {s.source === "user" ? `eigener Schlüssel (${s.keyHint})` : `Schlüssel vom Server · heute noch ${s.remainingToday} Sitzungen`} · Modell {s.model}
              {!s.consent && " · Einwilligung fehlt noch"}
            </span>
          </div>
        ) : (
          <span className="text-muted">Noch kein Decart-Schlüssel hinterlegt.</span>
        )}
      </div>

      <div className="space-y-4">
        <Field
          label="Decart-API-Schlüssel"
          htmlFor="decart-key"
          aside={
            <a href="https://platform.decart.ai/" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink hover:underline">
              Schlüssel erstellen <ExternalLink className="size-3" />
            </a>
          }
          hint={
            LOCAL_EDITION
              ? "Wird verschlüsselt nur in diesem Browser gespeichert und danach nie wieder angezeigt."
              : "Wird geprüft, verschlüsselt gespeichert und danach nie wieder angezeigt. Der Browser bekommt nur kurzlebige Zugangs-Tokens."
          }
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              id="decart-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={s.source === "user" ? `Gespeichert (${s.keyHint}) – leer lassen zum Behalten` : "Schlüssel hier einfügen"}
              className="pl-9"
            />
          </div>
        </Field>
        <Field label={`Maximale Dauer pro Sitzung: ${seconds} s`} hint="Danach endet die Sitzung automatisch – auch auf Decarts Seite. So bleiben die Kosten planbar.">
          <Slider label="Maximale Dauer pro Sitzung" min={20} max={300} step={10} value={seconds} onChange={setSeconds} left="20 s" right="5 min" />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            Ich willige ein, dass mein Kamerabild und die Fotos der gewählten Kleidungsstücke während einer realistischen Anprobe live an <strong>Decart</strong> übertragen werden.
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={busy === "save"} disabled={!consent || !!busy || (!apiKey.trim() && !s.available)}>
            Speichern
          </Button>
          {(s.source === "user" || s.consent) && (
            <Button variant="ghost" className="text-danger" onClick={remove} loading={busy === "remove"} disabled={!!busy} icon={<Trash2 className="size-4" />}>
              Schlüssel & Einwilligung entfernen
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
