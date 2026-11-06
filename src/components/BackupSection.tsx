// Browser edition: data lives only in this browser, so backups are the person's safety net.
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/api";
import { downloadFrom } from "../lib/download";
import { storagePersisted } from "../lib/edition";
import { Button, Card, ConfirmDialog, Notice, useToast } from "./ui";

const LAST_KEY = "styleai.lastBackup";

const readLast = () => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};

const mb = (bytes: number) => (bytes < 1024 * 1024 ? "unter 1 MB" : `${Math.round(bytes / 1024 / 1024)} MB`);

export function BackupSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [last, setLast] = useState(readLast);
  const [busy, setBusy] = useState<"save" | "restore" | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [storage, setStorage] = useState<{ used: number | null; persisted: boolean | null }>({ used: null, persisted: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => null);
      const persisted = await storagePersisted();
      if (alive) setStorage({ used: est?.usage ?? null, persisted });
    })();
    return () => {
      alive = false;
    };
  }, [busy]);

  const save = async () => {
    setBusy("save");
    try {
      await downloadFrom("/api/local/backup", "styleai-sicherung.zip");
      const now = new Date().toISOString();
      try {
        localStorage.setItem(LAST_KEY, now);
      } catch {
        // private mode: only the reminder is lost
      }
      setLast(now);
      toast("Sicherung heruntergeladen");
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setBusy("restore");
    try {
      const res = await fetch("/api/local/restore", { method: "POST", headers: { "content-type": "application/zip" }, body: file });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "Die Sicherung konnte nicht wiederhergestellt werden.");
      setPending(null);
      qc.clear();
      toast(`Sicherung wiederhergestellt: ${data.items} Kleidungsstücke`);
      setTimeout(() => window.location.assign(import.meta.env.BASE_URL), 600);
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card id="sicherung">
      <div className="mb-4 flex items-center gap-2">
        <Archive className="size-5" />
        <h2 className="font-display text-2xl">Sicherung</h2>
      </div>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Deine Daten liegen nur in diesem Browser auf diesem Gerät – nicht in einer Cloud. Lade ab und zu eine Sicherung herunter, zum Beispiel bevor du Browserdaten löschst
          oder das Gerät wechselst. Gespeicherte API-Schlüssel sind aus Sicherheitsgründen nicht enthalten.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={busy === "save"} icon={<Download className="size-4" />}>
            Sicherung herunterladen
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} loading={busy === "restore"} icon={<Upload className="size-4" />}>
            Sicherung wiederherstellen
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setPending(f);
            }}
          />
        </div>
        <ul className="space-y-1 text-muted">
          <li>{last ? `Letzte Sicherung: ${new Date(last).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}` : "Noch keine Sicherung angelegt."}</li>
          {storage.used !== null && (
            <li>
              Belegt: {mb(storage.used)}
              {storage.persisted === true && " · vor automatischem Löschen geschützt"}
              {storage.persisted === false && " · der Browser darf die Daten bei Platzmangel löschen"}
            </li>
          )}
        </ul>
        <Notice tone="info">
          Tipp: Über „Zum Home-Bildschirm“ (Handy) oder „App installieren“ (Computer) wird StyleAI wie eine App installiert und startet auch ohne Internet.
        </Notice>
      </div>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Sicherung wiederherstellen?"
        confirmLabel="Wiederherstellen"
        danger
        loading={busy === "restore"}
        onConfirm={() => pending && restore(pending)}
      >
        Alle Daten, die gerade in diesem Browser gespeichert sind, werden durch die Sicherung „{pending?.name}“ ersetzt.
      </ConfirmDialog>
    </Card>
  );
}
