import { lazy, Suspense } from "react";
import type { OutfitItemRef } from "../../shared/types";

// Camera try-on incl. MediaPipe and the Decart SDK is only downloaded when someone opens it.
const TryOn = lazy(() => import("./TryOn"));

/** Try-on for a whole outfit or a single piece (pass one ref). */
export function TryOnDialog({ open, onOpenChange, refs, title }: { open: boolean; onOpenChange: (o: boolean) => void; refs: OutfitItemRef[]; title: string }) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <TryOn open={open} onOpenChange={onOpenChange} refs={refs} title={title} />
    </Suspense>
  );
}
