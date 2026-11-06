import { describe, expect, it } from "vitest";
import { analyzeHarmony, deltaE2000, extractColors, familiesHarmony, hexToLab, nearestFamily, rgbToLab } from "../shared/color";

describe("color conversions", () => {
  it("converts sRGB to Lab", () => {
    const [L] = rgbToLab([255, 255, 255]);
    expect(L).toBeCloseTo(100, 0);
    const black = rgbToLab([0, 0, 0]);
    expect(black[0]).toBeCloseTo(0, 1);
  });

  it("computes CIEDE2000 (reference pair from Sharma et al.)", () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000(hexToLab("#123456"), hexToLab("#123456"))).toBe(0);
  });

  it("names colors by nearest family", () => {
    expect(nearestFamily([10, 10, 10])).toBe("schwarz");
    expect(nearestFamily([250, 250, 248])).toBe("weiss");
    expect(nearestFamily([30, 40, 70])).toBe("navy");
    expect(nearestFamily([200, 40, 40])).toBe("rot");
    expect(nearestFamily([128, 128, 130])).toBe("grau");
  });
});

describe("extractColors", () => {
  it("finds dominant colors and ignores transparent pixels", () => {
    const w = 100;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const o = i * 4;
      if (x < 20) {
        // transparent background in bright pink – must be ignored
        data.set([255, 0, 255, 0], o);
      } else if (x < 75) {
        data.set([28, 38, 66, 255], o); // navy
      } else {
        data.set([245, 245, 242, 255], o); // white
      }
    }
    const colors = extractColors(data, w, h);
    expect(colors[0].family).toBe("navy");
    expect(colors.map((c) => c.family)).toContain("weiss");
    expect(colors.map((c) => c.family)).not.toContain("pink");
    expect(colors[0].ratio).toBeGreaterThan(0.6);
  });

  it("returns nothing for fully transparent images", () => {
    expect(extractColors(new Uint8ClampedArray(40 * 40 * 4), 40, 40)).toEqual([]);
  });
});

describe("harmony", () => {
  it("rates neutral outfits as safe", () => {
    const h = analyzeHarmony([
      { hex: "#151515", family: "schwarz", weight: 1 },
      { hex: "#f7f7f4", family: "weiss", weight: 1 },
      { hex: "#8a8a8e", family: "grau", weight: 0.5 },
    ]);
    expect(h.kind).toBe("neutral");
    expect(h.score).toBeGreaterThan(0.85);
  });

  it("prefers one accent on a neutral base over clashing saturated hues", () => {
    const accent = analyzeHarmony([
      { hex: "#1d2741", family: "navy", weight: 1 },
      { hex: "#c12c2c", family: "rot", weight: 0.3 },
    ]);
    const clash = analyzeHarmony([
      { hex: "#c12c2c", family: "rot", weight: 1 },
      { hex: "#3d8c4d", family: "gruen", weight: 1 },
      { hex: "#64478f", family: "lila", weight: 1 },
    ]);
    expect(accent.kind).toBe("akzent");
    expect(accent.score).toBeGreaterThan(clash.score);
  });

  it("lets boldness soften complementary contrast penalties", () => {
    const colors = [
      { hex: "#2c5db3", family: "blau", weight: 1 },
      { hex: "#e3772b", family: "orange", weight: 1 },
    ];
    expect(analyzeHarmony(colors, 0.9).score).toBeGreaterThan(analyzeHarmony(colors, 0.1).score);
  });

  it("answers simple pair questions", () => {
    expect(familiesHarmony("braun", "schwarz").score).toBeGreaterThan(0.7);
  });
});
