// Lightweight German request parser used by the stylist when no AI provider is configured.
// It maps keywords to generator settings and resolves item mentions against the real wardrobe.
import { colorLabel, familiesHarmony, type ColorFamilyId } from "./color";
import { labelOf, type OccasionId, type StyleId } from "./taxonomy";

export interface ParsedStylistRequest {
  intent: "outfit" | "frage";
  styles: StyleId[];
  occasion: OccasionId | null;
  colors: ColorFamilyId[];
  mustInclude: string[];
  exclude: string[];
  formality: number | null;
  boldness: number | null;
  experimental: number | null;
  temperatureC: number | null;
  rain: boolean | null;
  count: number | null;
  reply: string;
}

export interface NamedItem {
  id: string;
  name: string;
  categoryName: string;
  colors: { family: string }[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9°\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const STYLE_WORDS: [string, StyleId][] = [
  ["streetwear", "streetwear"],
  ["street", "streetwear"],
  ["smart casual", "smart_casual"],
  ["smart-casual", "smart_casual"],
  ["casual", "casual"],
  ["laessig", "casual"],
  ["old money", "old_money"],
  ["minimalistisch", "minimal"],
  ["minimal", "minimal"],
  ["clean", "minimal"],
  ["vintage", "vintage"],
  ["retro", "vintage"],
  ["grunge", "grunge"],
  ["sportlich", "sporty"],
  ["sporty", "sporty"],
  ["athleisure", "sporty"],
  ["elegant", "elegant"],
  ["business", "business"],
  ["skater", "skater"],
  ["y2k", "y2k"],
  ["preppy", "preppy"],
  ["dark academia", "dark_academia"],
];

const OCCASION_WORDS: [string, OccasionId][] = [
  ["alltag", "alltag"],
  ["jeden tag", "alltag"],
  ["schule", "schule_arbeit"],
  ["uni ", "schule_arbeit"],
  ["universitaet", "schule_arbeit"],
  ["arbeit", "schule_arbeit"],
  ["buero", "schule_arbeit"],
  ["job", "schule_arbeit"],
  ["meeting", "schule_arbeit"],
  ["freunde", "freunde"],
  ["freundin", "freunde"],
  ["kumpel", "freunde"],
  ["party", "party"],
  ["club", "party"],
  ["restaurant", "restaurant"],
  ["essen gehen", "restaurant"],
  ["dinner", "restaurant"],
  ["date", "restaurant"],
  ["hochzeit", "feier"],
  ["geburtstag", "feier"],
  ["feier", "feier"],
  ["taufe", "feier"],
  ["gym", "sport"],
  ["training", "sport"],
  ["joggen", "sport"],
  ["sport ", "sport"],
  ["fitness", "sport"],
  ["reise", "reise"],
  ["urlaub", "reise"],
  ["flug", "reise"],
  ["trip", "reise"],
  ["gala", "formell"],
  ["abiball", "formell"],
  ["formell", "formell"],
  ["vorstellungsgespraech", "formell"],
];

const COLOR_WORDS: [string, ColorFamilyId][] = [
  ["schwarz", "schwarz"],
  ["anthrazit", "anthrazit"],
  ["hellgrau", "hellgrau"],
  ["grau", "grau"],
  ["weiss", "weiss"],
  ["creme", "creme"],
  ["beige", "beige"],
  ["camel", "camel"],
  ["braun", "braun"],
  ["khaki", "khaki"],
  ["oliv", "oliv"],
  ["navy", "navy"],
  ["dunkelblau", "navy"],
  ["jeansblau", "jeansblau"],
  ["hellblau", "hellblau"],
  ["blau", "blau"],
  ["petrol", "petrol"],
  ["tuerkis", "tuerkis"],
  ["dunkelgruen", "dunkelgruen"],
  ["gruen", "gruen"],
  ["mint", "mint"],
  ["lila", "lila"],
  ["violett", "lila"],
  ["flieder", "flieder"],
  ["rosa", "rosa"],
  ["pink", "pink"],
  ["bordeaux", "bordeaux"],
  ["weinrot", "bordeaux"],
  ["rot", "rot"],
  ["orange", "orange"],
  ["terracotta", "terracotta"],
  ["senf", "senf"],
  ["gelb", "gelb"],
];

const NUMBER_WORDS: Record<string, number> = { ein: 1, eins: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6 };

function findColors(text: string): ColorFamilyId[] {
  const out: ColorFamilyId[] = [];
  let rest = ` ${text} `;
  for (const [w, id] of COLOR_WORDS) {
    const re = new RegExp(`\\b${w}(e|er|es|en|em)?\\b`);
    if (re.test(rest)) {
      out.push(id);
      rest = rest.replace(re, " ");
    }
  }
  return [...new Set(out)];
}

const FILLER = new Set(["meine", "meinen", "meinem", "meiner", "der", "die", "das", "dem", "den", "und", "einer", "einem", "einen", "ist", "sind", "wird"]);

function matchItem(phrase: string, items: NamedItem[]): string | null {
  const words = phrase.split(" ").filter((w) => w.length > 2 && !FILLER.has(w));
  if (!words.length) return null;
  const phraseColors = new Set(findColors(phrase));
  let best: { id: string; s: number } | null = null;
  for (const it of items) {
    const hay = norm(`${it.name} ${it.categoryName}`);
    let s = 0;
    for (const w of words) {
      const stem = w.length > 5 ? w.slice(0, -1) : w;
      // Long words ("cargo-hose", "bomberjacke") are distinctive on their own.
      if (hay.includes(stem)) s += w.length >= 5 ? 1.5 : 0.6;
    }
    if (it.colors.some((c) => phraseColors.has(c.family as ColorFamilyId))) s += 0.75;
    if (s >= 1.5 && (!best || s > best.s)) best = { id: it.id, s };
  }
  return best?.id ?? null;
}

export function parseStylistMessage(message: string, items: NamedItem[]): ParsedStylistRequest {
  const t = ` ${norm(message)} `;
  const r: ParsedStylistRequest = {
    intent: "outfit",
    styles: [],
    occasion: null,
    colors: [],
    mustInclude: [],
    exclude: [],
    formality: null,
    boldness: null,
    experimental: null,
    temperatureC: null,
    rain: null,
    count: null,
    reply: "",
  };

  // Color question: "Passt Braun zu Schwarz?"
  const q = t.match(/passt\s+(.+?)\s+(?:zu|mit)\s+(.+?)\s*$/);
  if (q) {
    const a = findColors(q[1])[0];
    const b = findColors(q[2])[0];
    if (a && b) {
      r.intent = "frage";
      const h = familiesHarmony(a, b);
      const verdict =
        h.score >= 0.85 ? "passt sehr gut" : h.score >= 0.7 ? "passt gut" : h.score >= 0.55 ? "funktioniert mit etwas Mut" : "ist eine schwierige Kombination";
      r.reply = `${colorLabel(a)} und ${colorLabel(b)}: ${verdict}. ${harmonyHint(h.kind)}`;
      return r;
    }
  }

  for (const [w, id] of STYLE_WORDS) if (t.includes(` ${w}`) && !r.styles.includes(id)) r.styles.push(id);
  if (r.styles.includes("smart_casual")) r.styles = r.styles.filter((s) => s !== "casual");
  for (const [w, id] of OCCASION_WORDS) {
    if (t.includes(` ${w}`)) {
      r.occasion = id;
      break;
    }
  }

  // Item mentions: "mit meiner weißen Jeans", "ohne den Hoodie". Clauses end at punctuation.
  const segments = message
    .split(/[,.;:!?]/)
    .map((clause) => ` ${norm(clause)} `)
    .flatMap((clause) => clause.split(/\b(mit|ohne)\b/).map((s, i) => (i === 0 ? null : s)))
    .filter((s): s is string => s !== null);
  for (let i = 0; i < segments.length; i += 2) {
    const kind = segments[i];
    const phrase = segments[i + 1]?.split(/\b(und|aber|fuer|zum|zur|bei|heute|morgen|es|weil|denn)\b/)[0]?.trim() ?? "";
    const id = matchItem(phrase, items);
    if (!id) continue;
    if (kind === "mit" && !r.mustInclude.includes(id)) r.mustInclude.push(id);
    if (kind === "ohne" && !r.exclude.includes(id)) r.exclude.push(id);
  }
  // Colors that did not resolve to an item count as wished colors.
  const colorsOutsideItems = findColors(t.replace(/\bmit\b.*$/, ""));
  r.colors = r.mustInclude.length ? colorsOutsideItems : findColors(t);

  const deg = t.match(/(-?\d{1,2})\s*(°|grad)/);
  if (deg) r.temperatureC = Number(deg[1]);
  else if (/\b(eisig|frostig|eiskalt|schnee)\b/.test(t)) r.temperatureC = 0;
  else if (/\b(kalt)\b/.test(t)) r.temperatureC = 4;
  else if (/\b(kuehl|frisch)\b/.test(t)) r.temperatureC = 11;
  else if (/\b(mild)\b/.test(t)) r.temperatureC = 17;
  else if (/\b(heiss|hitze|sommerlich)\b/.test(t)) r.temperatureC = 30;
  else if (/\b(warm)\b/.test(t)) r.temperatureC = 23;
  if (/\b(regen|regnet|regnerisch|nass)\b/.test(t)) r.rain = true;

  if (/\b(schlicht|dezent|unauffaellig|ruhig)\b/.test(t)) r.boldness = 0.15;
  if (/\b(auffaellig|bunt|statement|laut)\b/.test(t)) r.boldness = 0.85;
  if (/\b(klassisch|zeitlos|sicher)\b/.test(t)) r.experimental = 0.1;
  if (/\b(experimentell|ausgefallen|mutig|ungewoehnlich)\b/.test(t)) r.experimental = 0.85;
  if (/\b(bequem|gemuetlich|entspannt|chillig)\b/.test(t)) r.formality = 1.5;
  if (/\b(schick)\b/.test(t)) r.formality = 3.8;

  // "zwei Looks", "3 elegante Outfits", "drei Streetwear Looks"
  const cnt = t.match(/\b(\d|ein|eins|einen|zwei|drei|vier|fuenf|sechs)\s+(?:[a-z-]+\s+){0,2}?(outfits?|vorschlaege?|looks?|kombinationen?|ideen)\b/);
  if (cnt) r.count = Math.min(8, Number(cnt[1]) || NUMBER_WORDS[cnt[1]] || 3);

  const understood: string[] = [];
  if (r.styles.length) understood.push(`Stil ${r.styles.map(labelOf.style).join(" + ")}`);
  if (r.occasion) understood.push(`Anlass „${labelOf.occasion(r.occasion)}“`);
  if (r.colors.length) understood.push(`Farben ${r.colors.map(colorLabel).join(", ")}`);
  if (r.mustInclude.length) understood.push(`${r.mustInclude.length} Wunschteil${r.mustInclude.length > 1 ? "e" : ""}`);
  if (r.exclude.length) understood.push(`${r.exclude.length} ausgeschlossene${r.exclude.length > 1 ? "" : "s"} Teil${r.exclude.length > 1 ? "e" : ""}`);
  if (r.temperatureC !== null) understood.push(`ca. ${r.temperatureC} °C`);
  if (r.rain) understood.push("Regen");
  r.reply = understood.length
    ? `Verstanden: ${understood.join(", ")}. Hier sind meine Vorschläge aus deinem Kleiderschrank.`
    : "Ich habe keine speziellen Wünsche erkannt und schlage dir ausgewogene Outfits aus deinem Kleiderschrank vor. Tipp: Nenne Anlass, Stil, Farben oder ein bestimmtes Teil.";
  return r;
}

function harmonyHint(kind: string): string {
  switch (kind) {
    case "neutral":
      return "Beides sind Neutraltöne – die lassen sich fast immer kombinieren.";
    case "akzent":
      return "Eine neutrale Farbe mit einem Akzent ist eine klassische, sichere Formel.";
    case "analog":
      return "Die Farbtöne liegen nah beieinander und wirken harmonisch.";
    case "komplementaer":
      return "Das ist ein Komplementärkontrast – kräftig, am besten mit neutralen Teilen ausbalancieren.";
    case "ton_in_ton":
      return "Ton-in-Ton wirkt besonders durchdacht.";
    default:
      return "Am besten eine der Farben nur in kleiner Menge (z. B. Accessoire) einsetzen und den Rest neutral halten.";
  }
}

