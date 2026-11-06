// Rule-based German explanations derived from the score breakdown. Always available, no AI needed.
import { colorLabel } from "../color";
import { labelOf, patternBoldness } from "../taxonomy";
import type { Explanation } from "../types";
import type { EngineContext, Part } from "./context";
import { colorList, type ScoreResult } from "./score";

const q = (name: string) => `„${name}“`;

function listNames(parts: Part[]) {
  const names = parts.map((p) => q(p.item.name));
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " und " + names[names.length - 1];
}

export function buildTitle(ctx: EngineContext): string {
  const styleLabel = ctx.styles.length
    ? ctx.styles.slice(0, 2).map(labelOf.style).join(" × ")
    : ctx.request.customStyle || "Dein Look";
  const occ = ctx.occasion ? labelOf.occasion(ctx.occasion) : ctx.request.customOccasion;
  const base = occ ? `${styleLabel} · ${occ}` : styleLabel;
  return ctx.trend ? `${ctx.trend.name} · ${base}` : base;
}

export function explainOutfit(parts: Part[], r: ScoreResult, ctx: EngineContext): Explanation {
  const by = (role: string) => parts.filter((p) => p.role === role);
  const torso = [...by("onepiece"), ...by("suit"), ...by("top"), ...by("base"), ...by("mid")];
  const bottom = by("bottom");
  const outer = by("outer");
  const shoes = by("shoes");
  const acc = parts.filter((p) => p.role.startsWith("acc:"));

  // --- summary ----------------------------------------------------------------------
  const core = [...torso, ...bottom];
  let summary = `${listNames(core)} ${core.length === 1 ? "bildet" : "bilden"} die Basis`;
  if (outer.length) summary += `, ${listNames(outer)} kommt darüber`;
  summary += shoes.length ? `; ${listNames(shoes)} runden den Look ab.` : ".";
  const strengths: string[] = [];
  const b = r.breakdown;
  if (b.style >= 0.8 && ctx.styles.length) strengths.push(`alle Teile treffen den gewünschten Stil (${ctx.styles.map(labelOf.style).join(", ")})`);
  else if (b.cohesion >= 0.75) strengths.push("die Teile sprechen dieselbe Stilsprache");
  if (b.color >= 0.88) strengths.push("die Farben harmonieren");
  if (b.formality >= 0.85) strengths.push("die Formalität ist stimmig");
  if (b.personal >= 0.65) strengths.push("die Kombination passt zu deinen bisherigen Vorlieben");
  if (strengths.length) summary += ` Das funktioniert, weil ${strengths.slice(0, 3).join(", ")}.`;

  // --- colors ----------------------------------------------------------------------------
  const h = r.harmony;
  let colorNotes: string;
  switch (h.kind) {
    case "neutral":
      colorNotes = `Komplett neutrale Palette (${colorList(h.neutrals)}) – zeitlos und ruhig.`;
      colorNotes +=
        h.contrast > 45
          ? " Der Hell-Dunkel-Kontrast sorgt für Spannung."
          : " Ähnliche Helligkeiten wirken weich und hochwertig.";
      break;
    case "ton_in_ton":
      colorNotes = `Ton-in-Ton in ${colorList(h.accents)}: verschiedene Nuancen derselben Farbe wirken durchdacht.`;
      break;
    case "akzent":
      colorNotes = h.neutrals.length
        ? `Neutrale Basis (${colorList(h.neutrals)}) mit einem Akzent in ${colorList(h.accents)} – der Blick fällt gezielt auf dieses Teil.`
        : `${colorList(h.accents)} steht im Mittelpunkt.`;
      break;
    case "analog":
      colorNotes = `Benachbarte Farbtöne (${colorList(h.accents)}) gehen weich ineinander über.`;
      break;
    case "komplementaer":
      colorNotes = `Komplementärkontrast aus ${colorList(h.accents)} – kräftig und bewusst gesetzt.`;
      if (h.neutrals.length) colorNotes += ` ${colorList(h.neutrals)} beruhigt das Ganze.`;
      break;
    case "triade":
      colorNotes = `Mutige Farbkombination (${colorList(h.accents)}).`;
      colorNotes += h.neutrals.length ? ` ${colorList(h.neutrals)} erdet die Farben.` : " Verlangt etwas Selbstbewusstsein.";
      break;
    default:
      colorNotes = `Viele Farben (${colorList(h.accents)}) – eher experimentell.`;
  }
  const wanted = ctx.request.colors.filter((c) => parts.some((p) => p.item.colors.some((x) => x.family === c)));
  if (wanted.length) colorNotes += ` Deine Wunschfarbe${wanted.length > 1 ? "n" : ""} ${colorList(wanted)} ${wanted.length > 1 ? "sind" : "ist"} enthalten.`;
  const patterned = parts.filter((p) => p.item.pattern !== "uni");
  if (patterned.length === 1) colorNotes += ` Muster: ${q(patterned[0].item.name)} (${labelOf.pattern(patterned[0].item.pattern)}) ist der Blickfang, der Rest bleibt ruhig.`;
  else if (patterned.length >= 2) {
    const subtle = patterned.some((p) => patternBoldness(p.item.pattern) <= 0.4);
    colorNotes += subtle
      ? " Zwei Muster in unterschiedlicher Stärke – das dezentere hält das lautere in Balance."
      : " Mehrere kräftige Muster – bewusst experimentell.";
  }

  // --- layering -----------------------------------------------------------------------------
  const cl = ctx.climate;
  const layers = [...by("base"), ...by("top"), ...by("onepiece"), ...by("mid"), ...by("suit"), ...outer];
  let layeringNotes: string;
  if (layers.length >= 2) {
    layeringNotes = `Schichten von innen nach außen: ${layers.map((p) => q(p.item.name)).join(" → ")}.`;
    if (outer.length && cl) layeringNotes += ` ${q(outer[0].item.name)} lässt sich drinnen ablegen.`;
  } else {
    layeringNotes = "Eine Lage reicht – kein Layering nötig.";
  }
  if (cl && cl.spread >= 8 && ctx.weather?.tempMinC != null && ctx.weather?.tempMaxC != null) {
    layeringNotes += ` Zwischen ${Math.round(ctx.weather.tempMinC)} und ${Math.round(ctx.weather.tempMaxC)} °C lohnt sich der Zwiebellook.`;
  }

  // --- accessories ------------------------------------------------------------------------------
  let accessoryNotes: string;
  if (acc.length) {
    const notes = acc.map((a) => {
      const fam = a.item.colors[0]?.family;
      const echo = fam ? parts.find((p) => p !== a && p.item.colors[0]?.family === fam) : undefined;
      return echo ? `${q(a.item.name)} greift das ${colorLabel(fam!)} von ${q(echo.item.name)} auf` : `${q(a.item.name)} ergänzt den Look`;
    });
    accessoryNotes = notes.join("; ") + ".";
  } else {
    accessoryNotes = "Keine Accessoires nötig – der Look steht für sich.";
  }

  // --- weather -------------------------------------------------------------------------------------
  let weatherNotes: string;
  if (cl && ctx.weather) {
    const w = ctx.weather;
    weatherNotes = `${w.description ? w.description + ", " : ""}${Math.round(w.tempC)} °C`;
    if (w.feelsLikeC != null && Math.abs(w.feelsLikeC - w.tempC) >= 2) weatherNotes += ` (gefühlt ${Math.round(w.feelsLikeC)} °C)`;
    const diff = r.torsoWarmth - cl.targetTorso;
    weatherNotes += diff < -1.5 ? ": eher luftig angezogen." : diff > 2 ? ": eher warm angezogen." : ": passend warm.";
    if (cl.rain) weatherNotes += outer.length ? ` Regen möglich – ${q(outer[0].item.name)} schützt.` : " Regen möglich – denk an einen Schirm.";
    if (cl.windy) weatherNotes += " Es ist windig.";
  } else {
    weatherNotes = `Ohne Wetterdaten nach Saison (${labelOf.season(ctx.season)}) zusammengestellt.`;
  }

  // --- occasion ----------------------------------------------------------------------------------------
  const occ = ctx.occasion ? labelOf.occasion(ctx.occasion) : ctx.request.customOccasion;
  const fm = r.formalityMean.toFixed(1).replace(".", ",");
  const target = ctx.targetFormality.toFixed(1).replace(".", ",");
  const fitWord = r.breakdown.formality >= 0.8 ? "passt gut" : r.breakdown.formality >= 0.6 ? "passt" : "weicht etwas ab";
  let occasionNotes = occ
    ? `Formalität ${fm} von 5 – ${fitWord} zu „${occ}“ (Ziel etwa ${target}).`
    : `Formalität ${fm} von 5 (Ziel etwa ${target}).`;
  if (ctx.trend) occasionNotes += ` Trendbezug: ${ctx.trend.name}.`;

  return {
    title: buildTitle(ctx),
    summary,
    colorNotes,
    layeringNotes,
    accessoryNotes,
    weatherNotes,
    occasionNotes,
    source: "regelbasiert",
  };
}
