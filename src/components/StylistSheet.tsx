import clsx from "clsx";
import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GenerateRequestInput } from "../../shared/schemas";
import type { GeneratedOutfit } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { useAiStatus, useMe } from "../lib/queries";
import { createStore } from "../lib/store";
import { useActiveWeather } from "../lib/weather";
import { OutfitCard } from "./OutfitCard";
import { Badge, Chip, Notice, Sheet, Spinner } from "./ui";

interface StylistResponse {
  mode: "ki" | "lokal";
  notice: string | null;
  reply: string;
  intent: "outfit" | "frage";
  request: GenerateRequestInput | null;
  result: { outfits: GeneratedOutfit[]; diagnostics: string[]; aiUsed: boolean; aiNotice: string | null } | null;
}

interface Msg {
  id: number;
  role: "user" | "stylist";
  text: string;
  response?: StylistResponse;
  error?: boolean;
}

export const stylistStore = createStore({ open: false });
const chatStore = createStore<{ messages: Msg[] }>({ messages: [] });

const SUGGESTIONS = [
  "Was ziehe ich heute an?",
  "Elegantes Outfit fürs Restaurant",
  "Streetwear, aber minimalistisch",
  "Passt Braun zu Schwarz?",
  "Etwas Bequemes für eine Reise",
];

export function StylistSheet() {
  const open = stylistStore.use((s) => s.open);
  const messages = chatStore.use((s) => s.messages);
  const { weather } = useActiveWeather();
  const aiStatus = useAiStatus();
  const me = useMe();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  const send = async (msg: string) => {
    const m = msg.trim();
    if (!m || busy) return;
    setText("");
    chatStore.set((s) => ({ messages: [...s.messages, { id: Date.now(), role: "user", text: m }] }));
    setBusy(true);
    try {
      const r = await api.post<StylistResponse>("/api/stylist", { message: m, weather, useAi: true });
      chatStore.set((s) => ({ messages: [...s.messages, { id: Date.now() + 1, role: "stylist", text: r.reply, response: r }] }));
    } catch (e) {
      chatStore.set((s) => ({ messages: [...s.messages, { id: Date.now() + 1, role: "stylist", text: errorMessage(e), error: true }] }));
    } finally {
      setBusy(false);
    }
  };

  const aiActive = !!aiStatus.data?.active && me.data?.aiImageConsent;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => stylistStore.set({ open: o })}
      title="Dein Stylist"
      description={aiActive ? `KI-Modus · ${aiStatus.data?.active?.provider}` : "Einfacher Modus – versteht Anlass, Stil, Farben, Wetter und Teile aus deinem Schrank."}
      wide
      footer={
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="z. B. Outfit für ein Date mit meiner weißen Jeans"
            aria-label="Nachricht an den Stylisten"
            maxLength={1000}
            className="h-11 flex-1 rounded-full border border-line bg-surface px-4 text-sm focus:border-ink focus:outline-none"
          />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Senden" className="flex size-11 items-center justify-center rounded-full bg-ink text-paper disabled:opacity-40">
            <Send className="size-4" />
          </button>
        </form>
      }
    >
      {messages.length === 0 && (
        <div className="py-4 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Sparkles className="size-5" />
          </div>
          <p className="font-display text-lg">Wobei kann ich helfen?</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Ich stelle Outfits ausschließlich aus deinem Kleiderschrank zusammen.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <Chip key={s} onClick={() => send(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={clsx("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div
              className={clsx(
                "max-w-[85%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user" ? "rounded-br-md bg-ink text-paper" : m.error ? "rounded-bl-md bg-danger-soft text-danger" : "rounded-bl-md bg-surface-2",
              )}
            >
              {m.text}
            </div>
            {m.response && (
              <div className="mt-2 w-full space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={m.response.mode === "ki" ? "accent" : "neutral"}>{m.response.mode === "ki" ? "KI" : "Einfacher Modus"}</Badge>
                </div>
                {m.response.notice && <Notice>{m.response.notice}</Notice>}
                {m.response.result?.diagnostics.map((d) => (
                  <Notice key={d} tone="warn">
                    {d}
                  </Notice>
                ))}
                {m.response.result?.outfits.map((o) => (
                  <OutfitCard key={o.key} outfit={o} request={m.response!.request ?? {}} compact />
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" /> Ich stelle etwas zusammen…
          </div>
        )}
        <div ref={endRef} />
      </div>
    </Sheet>
  );
}
