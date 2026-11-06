import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { GeneratedOutfit, Outfit, OutfitItemRef } from "../../shared/types";
import { ItemImage, roleLabel, useCategoryMap, useItemMap } from "../components/garments";
import { ItemPicker } from "../components/ItemPicker";
import { OutfitCard, outfitFromSaved } from "../components/OutfitCard";
import { Button, ConfirmDialog, IconButton, Input, Notice, Skeleton, useToast } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { inferRole } from "../lib/roles";
import { qk, useOutfit } from "../lib/queries";

export function OutfitDetailPage() {
  const { id = "" } = useParams();
  const q = useOutfit(id);
  const { map: items } = useItemMap();
  const { map: cats } = useCategoryMap();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Skeleton className="h-[60dvh]" />;
  if (q.isError || !q.data) return <Notice tone="danger">{q.isError ? errorMessage(q.error) : "Outfit nicht gefunden."}</Notice>;
  const outfit = q.data;

  const updateItems = async (refs: OutfitItemRef[]) => {
    if (!refs.length) return toast("Ein Outfit braucht mindestens ein Teil.", "danger");
    setBusy(true);
    try {
      const { outfit: scored } = await api.post<{ outfit: GeneratedOutfit }>("/api/outfits/score", {
        items: refs,
        request: { styles: outfit.styles, occasion: outfit.occasion, weather: outfit.weather },
      });
      const r = await api.patch<{ outfit: Outfit }>(`/api/outfits/${id}`, {
        items: scored.items,
        score: scored.score,
        breakdown: scored.breakdown,
        explanation: { ...scored.explanation, title: outfit.name },
      });
      qc.setQueryData(qk.outfit(id), r.outfit);
      qc.invalidateQueries({ queryKey: qk.outfits });
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const addItems = (ids: string[]) => {
    let refs = [...outfit.items];
    for (const iid of ids) {
      if (refs.some((r) => r.itemId === iid)) continue;
      const it = items.get(iid);
      if (!it) continue;
      refs = [...refs, { itemId: iid, role: inferRole(it, cats.get(it.categoryId), refs) }];
    }
    updateItems(refs);
  };

  return (
    <div>
      <Link to="/outfits?tab=saved" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Gespeicherte Looks
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {renaming ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await api.patch<{ outfit: Outfit }>(`/api/outfits/${id}`, { name: name.trim() || outfit.name });
                qc.setQueryData(qk.outfit(id), r.outfit);
                qc.invalidateQueries({ queryKey: qk.outfits });
                setRenaming(false);
              } catch (err) {
                toast(errorMessage(err), "danger");
              }
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus aria-label="Name des Outfits" />
            <Button type="submit">Speichern</Button>
          </form>
        ) : (
          <>
            <h1 className="font-display text-3xl md:text-4xl">{outfit.name}</h1>
            <IconButton
              label="Umbenennen"
              onClick={() => {
                setName(outfit.name);
                setRenaming(true);
              }}
            >
              <Pencil className="size-4" />
            </IconButton>
          </>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">Erstellt am {formatDate(outfit.createdAt)}</p>
      {outfit.missingItems > 0 && (
        <div className="mb-4">
          <Notice tone="warn">{outfit.missingItems} Teil(e) dieses Outfits wurden aus dem Kleiderschrank gelöscht.</Notice>
        </div>
      )}
      <OutfitCard
        key={outfit.updatedAt}
        outfit={outfitFromSaved(outfit)}
        savedOutfit={outfit}
        request={{ styles: outfit.styles, occasion: outfit.occasion, weather: outfit.weather }}
        onChange={() => qc.invalidateQueries({ queryKey: qk.outfit(id) })}
      />

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl">Teile bearbeiten</h2>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} icon={<Plus className="size-4" />} loading={busy}>
            Teil hinzufügen
          </Button>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {outfit.items.map((r) => {
            const it = items.get(r.itemId);
            return (
              <li key={r.itemId} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2">
                <ItemImage item={it} className="size-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it?.name ?? "Gelöschtes Teil"}</div>
                  <div className="text-xs text-muted">{roleLabel(r.role)}</div>
                </div>
                <IconButton label={`${it?.name ?? "Teil"} entfernen`} size="sm" onClick={() => updateItems(outfit.items.filter((x) => x.itemId !== r.itemId))} disabled={busy}>
                  <X className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">Nach jeder Änderung wird das Outfit neu bewertet und erklärt.</p>
      </section>

      <div className="mt-10 border-t border-line pt-6">
        <Button variant="ghost" className="text-danger" onClick={() => setConfirm(true)} icon={<Trash2 className="size-4" />}>
          Outfit löschen
        </Button>
      </div>

      <ItemPicker open={pickerOpen} onOpenChange={setPickerOpen} title="Teile hinzufügen" selected={[]} onChange={addItems} filter={(i) => !outfit.items.some((r) => r.itemId === i.id)} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Outfit löschen?"
        confirmLabel="Löschen"
        danger
        onConfirm={async () => {
          try {
            await api.del(`/api/outfits/${id}`);
            qc.invalidateQueries({ queryKey: qk.outfits });
            qc.invalidateQueries({ queryKey: ["calendar"] });
            toast("Outfit gelöscht");
            nav("/outfits?tab=saved", { replace: true });
          } catch (e) {
            toast(errorMessage(e), "danger");
          }
        }}
      >
        Das Outfit und seine Kalendereinträge werden gelöscht. Die Kleidungsstücke bleiben erhalten.
      </ConfirmDialog>
    </div>
  );
}
