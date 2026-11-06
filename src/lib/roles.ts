import type { Category, ClothingItem, OutfitItemRef, OutfitRole } from "../../shared/types";

/** Pick a sensible outfit role for an item from its category (for manual outfits and single-item try-on). */
export function inferRole(item: ClothingItem, cat: Category | undefined, current: OutfitItemRef[] = []): OutfitRole {
  const slot = item.slotOverride ?? cat?.slot ?? "top";
  const has = (r: string) => current.some((x) => x.role === r);
  switch (slot) {
    case "top":
      if (cat?.layer === "mid") return has("top") || has("base") ? "mid" : "top";
      return has("mid") || has("suit") ? "base" : "top";
    case "accessory":
      return `acc:${cat?.accessoryKind ?? "other"}`;
    default:
      return slot as OutfitRole;
  }
}
