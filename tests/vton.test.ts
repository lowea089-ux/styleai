import { describe, expect, it } from "vitest";
import { collectGarments, describeGarment, vtonPlans } from "../shared/tryon/vton";
import type { OutfitItemRef } from "../shared/types";
import { categories, item } from "./fixtures";

const cats = new Map(categories.map((c) => [c.id, c]));

function plans(list: ReturnType<typeof item>[], refs: OutfitItemRef[]) {
  return vtonPlans(collectGarments(refs, new Map(list.map((i) => [i.id, i])), cats));
}

describe("Lucy VTON prompts", () => {
  it("describes a garment only from stored attributes, in English", () => {
    const sweater = item("sweater", "navy", { id: "s", material: "Wolle", pattern: "gestreift" });
    expect(describeGarment({ item: sweater, category: cats.get(sweater.categoryId), role: "mid" })).toBe("navy blue striped wool knit sweater");
    const knit = item("sweater", "creme", { id: "k", material: "Strick" });
    // "knit" is not repeated.
    expect(describeGarment({ item: knit, category: cats.get(knit.categoryId), role: "mid" })).toBe("cream knit sweater");
    const twoTone = item("sweater", "blau", { id: "t", colors: [{ family: "blau", hex: "#2c5db3", ratio: 0.7 }, { family: "weiss", hex: "#fff", ratio: 0.3 }] });
    expect(describeGarment({ item: twoTone, category: cats.get(twoTone.categoryId), role: "mid" })).toBe("blue and white knit sweater");
  });

  it("builds a whole-outfit plan with top over bottom and the inner layer in the text", () => {
    const coat = item("coat", "camel", { id: "coat" });
    const tee = item("tshirt", "schwarz", { id: "tee" });
    const chinos = item("chinos", "beige", { id: "chinos" });
    const loafers = item("dress_shoes", "braun", { id: "loafers" });
    const p = plans([coat, tee, chinos, loafers], [
      { itemId: "tee", role: "base" },
      { itemId: "coat", role: "outer" },
      { itemId: "chinos", role: "bottom" },
      { itemId: "loafers", role: "shoes" },
    ]);
    expect(p[0]).toEqual({
      key: "outfit",
      label: "Ganzes Outfit",
      itemIds: ["coat", "chinos"],
      prompt: "Substitute the current outfit with a camel coat worn over a black t-shirt on top and beige chinos on the bottom",
    });
    expect(p.map((x) => x.key)).toEqual(["outfit", "tee", "coat", "chinos", "loafers"]);
    expect(p.find((x) => x.key === "coat")!.prompt).toBe("Substitute the current top with a camel coat");
    expect(p.find((x) => x.key === "chinos")!.prompt).toBe("Substitute the current pants with beige chinos");
    expect(p.find((x) => x.key === "loafers")!.prompt).toBe("Substitute the current shoes with brown dress shoes");
  });

  it("handles dresses, skirts, headwear and skips small accessories", () => {
    const dress = item("dress", "rot", { id: "dress" });
    const jacket = item("jacket", "schwarz", { id: "jacket" });
    const cap = item("headwear", "schwarz", { id: "cap" });
    const belt = item("belt", "braun", { id: "belt" });
    const p = plans([dress, jacket, cap, belt], [
      { itemId: "dress", role: "onepiece" },
      { itemId: "jacket", role: "outer" },
      { itemId: "cap", role: "acc:head" },
      { itemId: "belt", role: "acc:belt" },
    ]);
    expect(p[0].prompt).toBe("Substitute the current outfit with a red dress with a black jacket worn over it");
    expect(p[0].itemIds).toEqual(["dress"]);
    expect(p.find((x) => x.key === "cap")!.prompt).toBe("Substitute the current headwear with a black cap");
    expect(p.some((x) => x.key === "belt")).toBe(false);

    const skirt = item("skirt", "oliv", { id: "skirt" });
    expect(plans([skirt], [{ itemId: "skirt", role: "bottom" }])[0].prompt).toBe("Substitute the current bottoms with an olive skirt");
  });

  it("never invents items that are not in the wardrobe", () => {
    const tee = item("tshirt", "weiss", { id: "tee" });
    const p = plans([tee], [
      { itemId: "tee", role: "top" },
      { itemId: "deleted-item", role: "bottom" },
    ]);
    expect(p).toHaveLength(1);
    expect(p[0].itemIds).toEqual(["tee"]);
  });
});
