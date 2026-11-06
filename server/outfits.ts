// Connects stored data, the deterministic engine and the optional AI layer.
import { colorLabel } from "../shared/color";
import { buildContext, toEngineItems, type EngineItem } from "../shared/engine/context";
import { generateOutfits, rescore, swapAlternatives } from "../shared/engine/generate";
import { computeAffinities, summarizeAffinities, type ItemTraits } from "../shared/engine/personalization";
import { parseStylistMessage } from "../shared/nlp";
import { generateRequestSchema, type GenerateRequest } from "../shared/schemas";
import { labelOf } from "../shared/taxonomy";
import { getTrend, TRENDS, TRENDS_META, trendItemScore, trendsAreStale } from "../shared/trends";
import type { GeneratedOutfit, OutfitItemRef, WeatherContext } from "../shared/types";
import { AiError } from "./ai/provider";
import type { AiService } from "./ai/service";
import type { DB } from "./db";
import { getPreferences, listCategories, listFeedback, listItems, recentOutfitWear, type UserRow } from "./repo";

export interface GenerateResponse {
  outfits: GeneratedOutfit[];
  diagnostics: string[];
  aiUsed: boolean;
  aiNotice: string | null;
}

const LETTERS = "ABCDEFGHIJKL";

export function weatherText(w: WeatherContext | null): string | null {
  if (!w) return null;
  const parts = [`${Math.round(w.tempC)} °C`];
  if (w.feelsLikeC != null) parts.push(`gefühlt ${Math.round(w.feelsLikeC)} °C`);
  if (w.tempMinC != null && w.tempMaxC != null) parts.push(`Tagesspanne ${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)} °C`);
  if (w.precipitationProbability != null) parts.push(`Regenwahrscheinlichkeit ${w.precipitationProbability} %`);
  if (w.windKmh != null) parts.push(`Wind ${Math.round(w.windKmh)} km/h`);
  if (w.description) parts.unshift(w.description);
  return parts.join(", ");
}

export class OutfitService {
  constructor(
    private db: DB,
    private ai: AiService,
  ) {}

  state(userId: string, request: GenerateRequest) {
    const prefs = getPreferences(this.db, userId);
    const items = listItems(this.db, userId);
    const engineItems = toEngineItems(items, listCategories(this.db, userId));
    const events = prefs.personalizationEnabled ? listFeedback(this.db, userId) : [];
    const traits = new Map<string, ItemTraits>(items.map((i) => [i.id, { colors: i.colors, styles: i.styles }]));
    const ctx = buildContext({
      request,
      profile: prefs,
      affinities: computeAffinities(events, traits),
      recentOutfits: recentOutfitWear(this.db, userId, Math.max(14, prefs.avoidRepeatDays * 2)),
      trend: getTrend(request.trendId),
    });
    return { prefs, items, engineItems, ctx, eventCount: events.length };
  }

  private aiAllowed(user: UserRow, request: GenerateRequest) {
    return request.useAi && this.ai.availableFor(user.id) && !!user.ai_image_consent_at;
  }

  async generate(user: UserRow, request: GenerateRequest): Promise<GenerateResponse> {
    const wantAi = this.aiAllowed(user, request);
    const poolCount = wantAi ? Math.min(8, Math.max(request.count + 3, 6)) : request.count;
    const { engineItems, ctx } = this.state(user.id, { ...request, count: poolCount });
    const res = generateOutfits(engineItems, ctx);
    const base: GenerateResponse = {
      outfits: res.outfits.slice(0, request.count),
      diagnostics: res.diagnostics,
      aiUsed: false,
      aiNotice:
        request.useAi && this.ai.availableFor(user.id) && !user.ai_image_consent_at
          ? "Regelbasierte Erklärungen. Für KI-Begründungen kannst du unter „Mein Stil“ der KI-Nutzung zustimmen."
          : null,
    };
    if (!wantAi || !res.outfits.length) return base;

    const byId = new Map(engineItems.map((i) => [i.id, i]));
    const describe = (ref: OutfitItemRef) => {
      const it = byId.get(ref.itemId)!;
      return {
        role: ref.role,
        name: it.name,
        category: it.categoryName,
        colors: it.colors.map((c) => colorLabel(c.family)),
        pattern: labelOf.pattern(it.pattern),
        material: it.material,
        styles: it.styles.map(labelOf.style),
        fit: it.fit ? labelOf.fit(it.fit) : null,
      };
    };
    const candidates = res.outfits.map((o, i) => ({ id: LETTERS[i], ruleScore: o.score, items: o.items.map(describe) }));
    try {
      const out = await this.ai.run(user.id, "text", "explain_outfits", (p) =>
        p.explainOutfits({
          styles: ctx.styles.map(labelOf.style),
          customStyle: request.customStyle,
          occasion: request.occasion ? labelOf.occasion(request.occasion) : null,
          customOccasion: request.customOccasion,
          weather: weatherText(request.weather),
          boldness: ctx.boldness,
          experimental: ctx.experimental,
          count: request.count,
          candidates,
        }),
      );
      const chosen: GeneratedOutfit[] = [];
      const used = new Set<number>();
      for (const o of out.outfits) {
        const idx = LETTERS.indexOf(o.candidateId.trim().toUpperCase());
        // Only candidates we built from the real wardrobe are accepted.
        if (idx < 0 || idx >= res.outfits.length || used.has(idx)) continue;
        used.add(idx);
        const g = res.outfits[idx];
        chosen.push({
          ...g,
          explanation: {
            title: o.title.slice(0, 160),
            summary: o.summary.slice(0, 1200),
            colorNotes: o.colorNotes.slice(0, 800),
            layeringNotes: o.layeringNotes.slice(0, 800),
            accessoryNotes: o.accessoryNotes.slice(0, 800),
            weatherNotes: o.weatherNotes.slice(0, 800),
            occasionNotes: o.occasionNotes.slice(0, 800),
            source: "ki",
          },
        });
        if (chosen.length >= request.count) break;
      }
      for (let i = 0; i < res.outfits.length && chosen.length < request.count; i++) if (!used.has(i)) chosen.push(res.outfits[i]);
      return { ...base, outfits: chosen, aiUsed: true, aiNotice: null };
    } catch (e) {
      return { ...base, aiNotice: `KI-Begründung gerade nicht verfügbar (${e instanceof AiError ? e.message : "Fehler"}). Die Vorschläge sind regelbasiert erklärt.` };
    }
  }

  swap(userId: string, items: OutfitItemRef[], replaceItemId: string, request: GenerateRequest) {
    const { engineItems, ctx } = this.state(userId, request);
    return swapAlternatives(engineItems, items, replaceItemId, ctx);
  }

  rescore(userId: string, items: OutfitItemRef[], request: GenerateRequest) {
    const { engineItems, ctx } = this.state(userId, request);
    return rescore(engineItems, items, ctx);
  }

  async stylist(user: UserRow, message: string, weather: WeatherContext | null, useAi: boolean) {
    const items = listItems(this.db, user.id);
    const cats = new Map(listCategories(this.db, user.id).map((c) => [c.id, c.name]));
    const prefs = getPreferences(this.db, user.id);
    const owned = new Set(items.map((i) => i.id));
    let mode: "ki" | "lokal" = "lokal";
    let notice: string | null = null;
    let parsed = parseStylistMessage(
      message,
      items.map((i) => ({ id: i.id, name: i.name, categoryName: cats.get(i.categoryId) ?? "", colors: i.colors })),
    );
    let customStyle: string | null = null;
    let customOccasion: string | null = null;

    if (useAi && this.ai.availableFor(user.id) && user.ai_image_consent_at) {
      try {
        const out = await this.ai.run(user.id, "text", "stylist", (p) =>
          p.interpretStylistMessage({
            message,
            wardrobe: items.slice(0, 400).map((i) => ({
              id: i.id,
              name: i.name,
              category: cats.get(i.categoryId) ?? "",
              colors: i.colors.map((c) => colorLabel(c.family)),
              status: i.status,
            })),
            preferredStyles: prefs.preferredStyles.map(labelOf.style),
            weather: weatherText(weather),
            today: new Date().toISOString().slice(0, 10),
          }),
        );
        mode = "ki";
        const clamp = (v: number | null, lo: number, hi: number) => (v == null || !Number.isFinite(v) ? null : Math.max(lo, Math.min(hi, v)));
        parsed = {
          intent: out.intent,
          reply: out.reply.slice(0, 1500),
          styles: [...new Set(out.styles)].slice(0, 5),
          occasion: out.occasion,
          colors: [...new Set(out.colors)].slice(0, 8),
          // IDs the model invents are dropped here.
          mustInclude: out.mustIncludeItemIds.filter((id) => owned.has(id)).slice(0, 6),
          exclude: out.excludeItemIds.filter((id) => owned.has(id)),
          formality: clamp(out.formality, 1, 5),
          boldness: clamp(out.boldness, 0, 1),
          experimental: clamp(out.experimental, 0, 1),
          temperatureC: clamp(out.temperatureC, -40, 50),
          rain: out.rain,
          count: out.count == null ? null : Math.round(clamp(out.count, 1, 8)!),
        };
        customStyle = out.customStyle?.slice(0, 200) ?? null;
        customOccasion = out.customOccasion?.slice(0, 200) ?? null;
      } catch (e) {
        notice = `KI gerade nicht verfügbar (${e instanceof AiError ? e.message : "Fehler"}) – einfacher Modus.`;
      }
    } else if (useAi && this.ai.availableFor(user.id)) {
      notice = "Einfacher Modus. Für den KI-Stylisten kannst du unter „Mein Stil“ der KI-Nutzung zustimmen.";
    }

    if (parsed.intent === "frage") return { mode, notice, reply: parsed.reply, intent: parsed.intent, request: null, result: null };

    let w = weather;
    if (parsed.temperatureC != null) {
      w = { tempC: parsed.temperatureC, precipitationProbability: parsed.rain ? 80 : null, source: "manuell", description: parsed.rain ? "Regen" : null };
    } else if (parsed.rain && w) w = { ...w, precipitationProbability: Math.max(w.precipitationProbability ?? 0, 80) };
    const request = generateRequestSchema.parse({
      styles: parsed.styles,
      customStyle,
      occasion: parsed.occasion,
      customOccasion,
      colors: parsed.colors,
      mustInclude: parsed.mustInclude,
      exclude: parsed.exclude,
      formality: parsed.formality,
      boldness: parsed.boldness,
      experimental: parsed.experimental,
      count: parsed.count ?? 3,
      weather: w,
      useAi,
      seed: Math.floor(Math.random() * 1e9),
    });
    const result = await this.generate(user, request);
    return { mode, notice, reply: parsed.reply, intent: parsed.intent, request, result };
  }

  trends(userId: string) {
    const { engineItems } = this.state(userId, generateRequestSchema.parse({}));
    return {
      meta: { ...TRENDS_META, stale: trendsAreStale() },
      trends: TRENDS.map((t) => ({
        ...t,
        matches: engineItems
          .map((i) => ({ itemId: i.id, score: trendItemScore(t, i), available: i.status === "available" }))
          .filter((m) => m.score >= t.threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12),
      })),
    };
  }

  async trendOutfits(user: UserRow, trendId: string, weather: WeatherContext | null) {
    const trend = getTrend(trendId);
    if (!trend) return null;
    const { engineItems } = this.state(user.id, generateRequestSchema.parse({}));
    const best = engineItems
      .filter((i: EngineItem) => i.status === "available")
      .map((i) => ({ i, s: trendItemScore(trend, i) }))
      .filter((x) => x.s >= trend.threshold)
      .sort((a, b) => b.s - a.s)[0];
    const request = generateRequestSchema.parse({
      trendId,
      mustInclude: best ? [best.i.id] : [],
      count: 2,
      weather,
      useAi: false,
      seed: Math.floor(Math.random() * 1e9),
    });
    const result = await this.generate(user, request);
    return {
      trend,
      anchorItemId: best?.i.id ?? null,
      note: best ? null : "In deinem Kleiderschrank gibt es (noch) kein Teil, das diesen Trend direkt verkörpert. Die Vorschläge greifen ihn nur über Farben und Stil auf.",
      ...result,
    };
  }

  learned(userId: string) {
    const { ctx, eventCount } = this.state(userId, generateRequestSchema.parse({}));
    return summarizeAffinities(ctx.affinities, eventCount);
  }
}
