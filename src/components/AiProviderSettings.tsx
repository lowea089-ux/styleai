import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, ExternalLink, KeyRound, PlugZap, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiProviderId, AiStatus } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { qk, useAiStatus } from "../lib/queries";
import { Badge, Button, Card, Field, Input, Notice, Skeleton, useToast } from "./ui";

/** Choose the AI provider (Claude, Groq, Gemini, OpenAI-compatible) and store an own API key. */
export function AiProviderSettings() {
  const status = useAiStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const s = status.data;
  const [provider, setProvider] = useState<AiProviderId>("groq");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [textModel, setTextModel] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  // Prefill from the stored settings once they are loaded.
  useEffect(() => {
    if (!s) return;
    const p = s.own?.providerId ?? s.server?.providerId ?? "groq";
    setProvider(p);
    setBaseUrl(s.own?.baseUrl ?? "");
    setVisionModel(s.own?.providerId === p ? (s.own.visionModel ?? "") : "");
    setTextModel(s.own?.providerId === p ? (s.own.textModel ?? "") : "");
  }, [s?.own?.updatedAt, s?.server?.providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status.isLoading) return <Skeleton className="h-64" />;
  if (status.isError || !s) return <Notice tone="danger">{errorMessage(status.error)}</Notice>;

  const info = s.providers.find((p) => p.id === provider) ?? s.providers[0];
  const keepsKey = s.own?.providerId === provider;
  const apply = (next: AiStatus) => {
    qc.setQueryData(qk.ai, next);
    qc.invalidateQueries({ queryKey: qk.me });
  };

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      const r = await api.post<{ provider: string; model: string; ms: number }>("/api/ai/test");
      setTest({ ok: true, text: `Verbindung zu ${r.provider} steht (${r.model}, ${(r.ms / 1000).toFixed(1)} s).` });
    } catch (e) {
      setTest({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setTest(null);
    try {
      const next = await api.put<AiStatus>("/api/ai/settings", {
        provider,
        apiKey: apiKey.trim() || null,
        baseUrl: info.requiresBaseUrl ? baseUrl.trim() : null,
        visionModel: visionModel.trim() || null,
        textModel: textModel.trim() || null,
        consent,
      });
      apply(next);
      setApiKey("");
      toast(`${info.label} gespeichert`);
      setBusy(null);
      await runTest();
    } catch (e) {
      toast(errorMessage(e), "danger");
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      apply(await api.del<AiStatus>("/api/ai/settings"));
      setTest(null);
      toast("Eigener KI-Anbieter entfernt", "info");
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div id="ki-anbieter" className="mb-1 flex items-center gap-2">
        <Sparkles className="size-5" />
        <h2 className="font-display text-2xl">KI-Anbieter</h2>
      </div>
      <p className="mb-4 text-sm text-muted">Wähle, welche KI Fotos analysiert und Outfits begründet. Ohne Anbieter funktioniert die App im lokalen Modus weiter.</p>

      <div className="mb-5 rounded-2xl bg-surface-2 p-4 text-sm">
        {s.active ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ok">
              <CheckCircle2 className="size-3" /> Aktiv
            </Badge>
            <span className="font-medium">{s.active.provider}</span>
            <span className="text-muted">
              {s.active.source === "user" ? `eigener Schlüssel (${s.own?.keyHint})` : "Schlüssel vom Server"} · Bild: {s.active.visionModel} · Text: {s.active.textModel}
            </span>
          </div>
        ) : s.activeError ? (
          <Notice tone="danger">{s.activeError}</Notice>
        ) : (
          <span className="text-muted">Kein Anbieter eingerichtet – lokaler Modus.</span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {s.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={provider === p.id}
            onClick={() => {
              setProvider(p.id);
              setTest(null);
              setVisionModel(s.own?.providerId === p.id ? (s.own.visionModel ?? "") : "");
              setTextModel(s.own?.providerId === p.id ? (s.own.textModel ?? "") : "");
            }}
            className={clsx(
              "rounded-2xl border p-3 text-left transition",
              provider === p.id ? "border-ink bg-surface ring-1 ring-ink" : "border-line hover:border-ink/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{p.label}</span>
              {s.own?.providerId === p.id && <Badge tone="accent">gespeichert</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted">{p.note}</p>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        <Field
          label="API-Schlüssel"
          htmlFor="ai-key"
          aside={
            info.keyUrl ? (
              <a href={info.keyUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink hover:underline">
                Schlüssel erstellen <ExternalLink className="size-3" />
              </a>
            ) : undefined
          }
          hint={info.requiresBaseUrl ? "Bei lokalen Modellen ohne Anmeldung leer lassen." : "Wird verschlüsselt gespeichert und danach nie wieder angezeigt."}
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keepsKey ? `Gespeichert (${s.own!.keyHint}) – leer lassen zum Behalten` : "Schlüssel hier einfügen"}
              className="pl-9"
            />
          </div>
        </Field>
        {info.requiresBaseUrl && (
          <Field label="Basis-URL" htmlFor="ai-url" hint="z. B. https://api.openai.com/v1, https://openrouter.ai/api/v1 oder http://localhost:1234/v1">
            <Input id="ai-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" spellCheck={false} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Modell für Bildanalyse" htmlFor="ai-vision" hint={info.requiresBaseUrl ? "Muss Bilder verarbeiten können." : "Leer = Standard"}>
            <Input id="ai-vision" value={visionModel} onChange={(e) => setVisionModel(e.target.value)} placeholder={info.defaultVisionModel ?? "z. B. gpt-4.1-mini"} spellCheck={false} />
          </Field>
          <Field label="Modell für Text" htmlFor="ai-text" hint={info.requiresBaseUrl ? "Leer = wie Bildanalyse" : "Leer = Standard"}>
            <Input id="ai-text" value={textModel} onChange={(e) => setTextModel(e.target.value)} placeholder={info.defaultTextModel ?? "wie Bildanalyse"} spellCheck={false} />
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            Ich willige ein, dass Fotos meiner Kleidung (verkleinert, ohne Metadaten) sowie Namen, Kategorien und Farben meiner Teile zur Analyse an <strong>{info.label}</strong> übertragen
            werden. Widerruf jederzeit unter „KI & Datenschutz“.
          </span>
        </label>
        {test && <Notice tone={test.ok ? "ok" : "danger"}>{test.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={busy === "save"} disabled={!consent || !!busy || (!apiKey.trim() && !keepsKey && !info.requiresBaseUrl)}>
            Speichern & testen
          </Button>
          <Button variant="outline" onClick={runTest} loading={busy === "test"} disabled={!s.active || !!busy} icon={<PlugZap className="size-4" />}>
            Verbindung testen
          </Button>
          {s.own && (
            <Button variant="ghost" className="text-danger" onClick={remove} loading={busy === "remove"} disabled={!!busy} icon={<Trash2 className="size-4" />}>
              Eigenen Anbieter entfernen
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
