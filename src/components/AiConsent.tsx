import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Me } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { qk, useAiStatus } from "../lib/queries";
import { Button, Notice, Sheet, useToast } from "./ui";

/** Explains exactly what is sent to the external AI provider before the user opts in. */
export function AiConsentSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const status = useAiStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const provider = status.data?.active?.provider ?? "dem KI-Anbieter";

  const consent = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ user: Me }>("/api/account/ai-consent", { consent: true });
      qc.setQueryData(qk.me, r.user);
      qc.invalidateQueries({ queryKey: qk.ai });
      toast("KI-Funktionen aktiviert");
      onOpenChange(false);
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="KI-Funktionen aktivieren"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Nicht jetzt
          </Button>
          <Button onClick={consent} loading={busy}>
            Einwilligen
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-ink-soft">
        <p>Mit deiner Einwilligung nutzt die App {provider} für:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Bildanalyse:</strong> Das Foto eines Kleidungsstücks (verkleinert, ohne Metadaten/GPS) wird übertragen, um Kategorie, Muster, Stil und eine Beschreibung zu erkennen.
          </li>
          <li>
            <strong>Outfit-Begründungen und Stylist-Chat:</strong> Namen, Kategorien und Farben deiner Kleidungsstücke sowie deine Nachricht werden als Text übertragen – keine Fotos.
          </li>
        </ul>
        <p>
          Laut den kommerziellen API-Bedingungen des Anbieters werden diese Daten standardmäßig nicht zum Training verwendet. Die App selbst nutzt deine Bilder nicht für Werbung oder fremde Trainingszwecke.
        </p>
        <Notice>Ohne Einwilligung funktioniert alles weiter: Freistellung und Farberkennung laufen auf deinem Gerät, Outfits werden regelbasiert erstellt. Du kannst die Einwilligung jederzeit unter „Mein Stil“ widerrufen.</Notice>
      </div>
    </Sheet>
  );
}
