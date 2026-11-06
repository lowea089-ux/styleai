// Curated, dated trend snapshot. Every trend links its sources; nothing here is generated.
// To update: research new sources, edit the entries, bump TRENDS_META.researchedAt.
import type { ColorFamilyId } from "./color";
import type { PatternId, StyleId } from "./taxonomy";

export interface TrendSource {
  title: string;
  publisher: string;
  url: string;
  /** Publication date of the source (ISO), if stated. */
  published: string | null;
}

export interface TrendDef {
  id: string;
  name: string;
  summary: string;
  howTo: string;
  season: string;
  sources: TrendSource[];
  match: {
    colors?: ColorFamilyId[];
    categories?: string[];
    keywords?: string[];
    patterns?: PatternId[];
    materials?: string[];
    styles?: StyleId[];
  };
  /** Minimum match score for an item to count as "fits the trend". */
  threshold: number;
}

export const TRENDS_META = {
  researchedAt: "2026-10-27",
  season: "Herbst/Winter 2026",
  staleAfterDays: 120,
  note: "Redaktionell kuratierter Stand aus öffentlich zugänglichen Trendberichten. Keine Live-Daten.",
};

const JOOR: TrendSource = {
  title: "On Trend: Women's Fall 2026 Fashion Trend Report",
  publisher: "JOOR",
  url: "https://www.joor.com/insights/womens-fall-fashion-trend-report",
  published: "2026-03-17",
};
const STYLE_ARCADE: TrendSource = {
  title: "Top Trends from Paris Fashion Week Fall Winter 2026",
  publisher: "Style Arcade",
  url: "https://www.stylearcade.com/blog/top-trends-from-paris-fashion-week-fall-winter-2026",
  published: "2026-03-12",
};
const TRENDALYTICS: TrendSource = {
  title: "The Top 10 Menswear Runway Trends Fall/Winter 2026",
  publisher: "Trendalytics",
  url: "https://trendalytics.co/insights/the-top-10-menswear-runway-trends-fall-winter-2026",
  published: null,
};
const PANTONE: TrendSource = {
  title: "Pantone names 2026 Color of the Year: Cloud Dancer",
  publisher: "NBC News",
  url: "https://www.nbcnews.com/pop-culture/pop-culture-news/pantone-names-2026-color-year-rcna247366",
  published: "2025-12-04",
};

export const TRENDS: TrendDef[] = [
  {
    id: "moody-maroon",
    name: "Moody Maroon",
    summary: "Tiefes Bordeaux, Oxblood und Maroon – als Einzelteil oder komplett Ton-in-Ton.",
    howTo:
      "Ein bordeauxfarbenes Teil auf neutraler Basis (Schwarz, Grau, Camel, Creme) ist der einfachste Einstieg. Mutiger: zwei Teile in Rot-Nuancen kombinieren.",
    season: "Herbst/Winter 2026",
    sources: [JOOR, STYLE_ARCADE],
    match: { colors: ["bordeaux"] },
    threshold: 0.5,
  },
  {
    id: "cloud-dancer",
    name: "Cloud Dancer – gebrochenes Weiß",
    summary: "Pantones Farbe des Jahres 2026 ist ein ruhiges, leicht gräuliches Weiß.",
    howTo:
      "Weiße oder cremefarbene Teile als ruhige Fläche nutzen – etwa Creme mit Camel oder Hellgrau, oder ein heller Ton-in-Ton-Look mit unterschiedlichen Materialien.",
    season: "2026",
    sources: [PANTONE],
    match: { colors: ["weiss", "creme"] },
    threshold: 0.5,
  },
  {
    id: "bomber",
    name: "Bomberjacken – auch aus Leder",
    summary: "Bomber- und Fliegerjacken, gern aus (Kunst-)Leder in Braun, Espresso oder Oliv.",
    howTo:
      "Zur Bomberjacke passen gerade Hosen und schlichte Strickteile. In Braun oder Oliv wirkt sie mit Creme, Denim oder Schwarz besonders aktuell.",
    season: "Herbst/Winter 2026",
    sources: [JOOR, STYLE_ARCADE, TRENDALYTICS],
    match: { keywords: ["bomber", "flieger", "flight", "aviator", "college", "varsity"], materials: ["leder"], categories: ["jacket"], colors: ["braun", "oliv"] },
    threshold: 0.6,
  },
  {
    id: "tailoring",
    name: "Schmale Schneiderei & klassische Anzüge",
    summary: "Strukturierte Sakkos, schmale Hosen und klassische, teils zweireihige Anzüge.",
    howTo:
      "Blazer oder Anzug mit einem einfachen Oberteil (Shirt, Rollkragen, Hemd) kombinieren. Für Smart Casual den Blazer zu Jeans und Lederschuhen oder sauberen Sneakern tragen.",
    season: "Herbst/Winter 2026",
    sources: [JOOR, TRENDALYTICS, STYLE_ARCADE],
    match: { categories: ["blazer", "suit", "trousers"], keywords: ["zweireih", "double", "sakko", "anzug"], styles: ["business", "elegant", "old_money"] },
    threshold: 0.5,
  },
  {
    id: "intarsia-knits",
    name: "Intarsia- & Musterstrick",
    summary: "Bunte Pullover und Strickjacken mit Argyle-, Jacquard- und geometrischen Mustern.",
    howTo:
      "Ein gemusterter Strickpullover braucht ruhige Begleiter: unifarbene Hose, schlichte Schuhe. Eine Farbe aus dem Muster bei Hose oder Schuhen aufgreifen.",
    season: "Herbst/Winter 2026",
    sources: [JOOR, TRENDALYTICS],
    match: { categories: ["sweater", "cardigan"], patterns: ["argyle", "colorblock", "grafik", "sonstiges"], keywords: ["jacquard", "intarsia", "norweger", "fair isle", "argyle"] },
    threshold: 0.8,
  },
  {
    id: "super-base-layer",
    name: "Polo & Rollkragen als Basis",
    summary: "Polo- und Rollkragenteile als Basisschicht unter grobem Strick, Hemden oder Blazern.",
    howTo:
      "Ein dünner Rollkragen oder ein Polo unter Pullover, Strickjacke oder Sakko – der Kragen bleibt sichtbar und macht das Layering zum Detail.",
    season: "Herbst/Winter 2026",
    sources: [STYLE_ARCADE],
    match: { categories: ["polo"], keywords: ["rollkragen", "turtleneck", "polo", "troyer"] },
    threshold: 0.6,
  },
  {
    id: "military",
    name: "At attention – Military & Trench",
    summary: "Militärisch inspirierte Details, lange Trenchcoats und Utility-Jacken.",
    howTo:
      "Trench oder Utility-Jacke in Oliv, Khaki oder Navy über schlichter Basis tragen; dazu Boots. Gürtel am Mantel betont die Silhouette.",
    season: "Herbst/Winter 2026",
    sources: [STYLE_ARCADE, TRENDALYTICS],
    match: { keywords: ["trench", "military", "utility", "field", "parka", "uniform"], categories: ["coat", "jacket"], colors: ["oliv", "khaki", "navy"] },
    threshold: 0.6,
  },
  {
    id: "all-wrapped-up",
    name: "Gut eingepackt – Schals & Capes",
    summary: "Große, geknotete Schals, Capes und hohe Kragen.",
    howTo: "Einen großen Schal locker über den Mantel legen oder knoten – am besten in einer Farbe, die im Outfit schon vorkommt.",
    season: "Herbst/Winter 2026",
    sources: [STYLE_ARCADE],
    match: { categories: ["scarf"], keywords: ["cape", "stola", "poncho", "schal"] },
    threshold: 0.5,
  },
  {
    id: "animal-print",
    name: "Animal Prints",
    summary: "Leo-, Zebra-, Kroko- und Schlangenmuster an Jacken, Schuhen und Taschen.",
    howTo: "Ein Teil mit Animal Print reicht. Mit Schwarz, Braun oder Creme kombinieren, damit es edel und nicht laut wirkt.",
    season: "Herbst/Winter 2026",
    sources: [STYLE_ARCADE],
    match: { patterns: ["animal"], keywords: ["leo", "zebra", "kroko", "snake", "schlange"] },
    threshold: 0.6,
  },
  {
    id: "sports-prep",
    name: "Sports Prep",
    summary: "Sportliche Elemente treffen auf Preppy-Klassiker.",
    howTo: "Ein Polo oder Sweatshirt mit Chino oder Stoffhose, dazu saubere Sneaker – sportlich, aber gepflegt.",
    season: "Herbst/Winter 2026",
    sources: [TRENDALYTICS],
    match: { categories: ["polo", "sweatshirt", "chinos"], styles: ["preppy", "sporty"] },
    threshold: 0.5,
  },
  {
    id: "fw26-palette",
    name: "Farbpalette Navy, Camel, Lila & Burgunder",
    summary: "Die Farben der Pariser Schauen: Navy, Camelbraun, Lila und Burgunderrot.",
    howTo: "Navy mit Camel ist der klassische Einstieg. Lila oder Burgunder als einzelner Akzent hält den Look aktuell.",
    season: "Herbst/Winter 2026",
    sources: [STYLE_ARCADE],
    match: { colors: ["navy", "camel", "lila", "bordeaux"] },
    threshold: 0.5,
  },
];

export interface TrendMatchable {
  categoryKey: string | null;
  name: string;
  subtype: string | null;
  tags: string[];
  colors: { family: string }[];
  pattern: string;
  material: string | null;
  styles: string[];
}

/** 0..1 – how strongly an item expresses a trend. */
export function trendItemScore(trend: TrendDef, item: TrendMatchable): number {
  const m = trend.match;
  const text = [item.name, item.subtype ?? "", ...item.tags].join(" ").toLowerCase();
  let s = 0;
  if (m.keywords?.some((k) => text.includes(k))) s += 0.6;
  if (m.patterns?.includes(item.pattern as PatternId)) s += 0.6;
  if (m.colors) {
    const fams = item.colors.map((c) => c.family);
    if (fams[0] && m.colors.includes(fams[0] as ColorFamilyId)) s += 0.5;
    else if (fams.some((f) => m.colors!.includes(f as ColorFamilyId))) s += 0.25;
  }
  if (m.materials && item.material && m.materials.some((x) => item.material!.toLowerCase().includes(x))) s += 0.4;
  if (m.categories && item.categoryKey && m.categories.includes(item.categoryKey)) s += 0.3;
  if (m.styles?.some((x) => item.styles.includes(x))) s += 0.2;
  return Math.min(1, s);
}

export const getTrend = (id: string | null | undefined) => (id ? (TRENDS.find((t) => t.id === id) ?? null) : null);

export function trendsAreStale(now = new Date()): boolean {
  const age = (now.getTime() - Date.parse(TRENDS_META.researchedAt)) / 86_400_000;
  return age > TRENDS_META.staleAfterDays;
}
