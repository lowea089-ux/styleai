import type { ColorFamilyId, ItemColor } from "./color";
import type {
  AccessoryKind,
  FitId,
  GroupId,
  ItemStatus,
  Layer,
  LegCoverage,
  OccasionId,
  PatternId,
  SeasonId,
  Slot,
  StyleId,
} from "./taxonomy";

export interface Category {
  id: string;
  key: string | null;
  name: string;
  group: GroupId;
  slot: Slot;
  layer: Layer;
  warmth: number;
  formality: number;
  accessoryKind: AccessoryKind | null;
  standalone: boolean;
  beltLoops: boolean;
  legCoverage: LegCoverage;
  sortOrder: number;
  isDefault: boolean;
  itemCount?: number;
}

export type Confidence = "hoch" | "mittel" | "niedrig";

export interface ClothingItem {
  id: string;
  categoryId: string;
  subtype: string | null;
  name: string;
  imageUrl: string;
  thumbUrl: string;
  colors: ItemColor[];
  pattern: PatternId;
  material: string | null;
  fit: FitId | null;
  styles: StyleId[];
  seasons: SeasonId[];
  occasions: OccasionId[];
  formality: number;
  warmth: number;
  slotOverride: Slot | null;
  description: string;
  brand: string | null;
  purchaseDate: string | null;
  priceCents: number | null;
  status: ItemStatus;
  favorite: boolean;
  tags: string[];
  aiAnalyzed: boolean;
  aiConfidence: Record<string, Confidence> | null;
  createdAt: string;
  updatedAt: string;
  wearCount: number;
  lastWornOn: string | null;
}

/** Role of an item inside an outfit. Accessories are `acc:<kind>`. */
export type OutfitRole =
  | "top"
  | "base"
  | "mid"
  | "bottom"
  | "onepiece"
  | "suit"
  | "outer"
  | "shoes"
  | `acc:${AccessoryKind}`;

export interface OutfitItemRef {
  itemId: string;
  role: OutfitRole;
}

export interface WeatherContext {
  /** Current or expected temperature in °C. */
  tempC: number;
  feelsLikeC?: number | null;
  tempMinC?: number | null;
  tempMaxC?: number | null;
  /** Probability of precipitation in percent. */
  precipitationProbability?: number | null;
  precipitationMm?: number | null;
  windKmh?: number | null;
  weatherCode?: number | null;
  description?: string | null;
  locationName?: string | null;
  source: "open-meteo" | "manuell";
}

export interface Explanation {
  title: string;
  summary: string;
  colorNotes: string;
  layeringNotes: string;
  accessoryNotes: string;
  weatherNotes: string;
  occasionNotes: string;
  source: "regelbasiert" | "ki";
}

export type ScoreComponent =
  | "style"
  | "cohesion"
  | "color"
  | "pattern"
  | "proportion"
  | "formality"
  | "weather"
  | "season"
  | "personal"
  | "variety";

export interface GeneratedOutfit {
  key: string;
  items: OutfitItemRef[];
  /** 0..100 */
  score: number;
  breakdown: Record<ScoreComponent, number>;
  colorKind: string;
  explanation: Explanation;
  warnings: string[];
  styles: StyleId[];
  occasion: OccasionId | null;
}

export interface Outfit {
  id: string;
  name: string;
  items: OutfitItemRef[];
  styles: StyleId[];
  occasion: OccasionId | null;
  weather: WeatherContext | null;
  explanation: Explanation | null;
  score: number | null;
  breakdown: Partial<Record<ScoreComponent, number>> | null;
  source: "generiert" | "manuell" | "ki";
  saved: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  missingItems: number;
}

export interface StylePreferences {
  preferredStyles: StyleId[];
  customStyle: string | null;
  favoriteColors: ColorFamilyId[];
  avoidedColors: ColorFamilyId[];
  typicalOccasions: OccasionId[];
  experimental: number;
  boldness: number;
  personalizationEnabled: boolean;
  avoidRepeatDays: number;
  onboardingCompleted: boolean;
  locationName: string | null;
  locationLat: number | null;
  locationLon: number | null;
  theme: "system" | "light" | "dark";
}

export interface CalendarEntry {
  id: string;
  date: string;
  outfitId: string;
  status: "planned" | "worn";
  note: string | null;
  outfit: Outfit | null;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  aiImageConsent: boolean;
  createdAt: string;
}

export type AiProviderId = "anthropic" | "groq" | "gemini" | "openai_compatible";

/** Per-user view of the AI setup (GET /api/ai/settings). API keys are never returned, only a hint. */
export interface AiStatus {
  providers: {
    id: AiProviderId;
    label: string;
    defaultVisionModel: string | null;
    defaultTextModel: string | null;
    keyUrl: string | null;
    note: string;
    requiresBaseUrl: boolean;
  }[];
  server: { providerId: AiProviderId; provider: string; visionModel: string; textModel: string } | null;
  own: { providerId: AiProviderId; keyHint: string; baseUrl: string | null; visionModel: string | null; textModel: string | null; updatedAt: string } | null;
  active: { source: "user" | "server"; providerId: AiProviderId; provider: string; visionModel: string; textModel: string } | null;
  activeError: string | null;
  consent: boolean;
}

/** Realistic live try-on via Decart Lucy VTON (GET /api/tryon/status). The key is never returned. */
export interface TryonStatus {
  /** A Decart key is usable (own key or the operator's). */
  available: boolean;
  source: "user" | "server" | null;
  keyHint: string | null;
  /** Consent to stream the camera to Decart during a session. */
  consent: boolean;
  maxSessionSeconds: number;
  model: string;
  /** Sessions left today on the operator key; null with an own key (no app limit). */
  remainingToday: number | null;
}

export interface TryonToken {
  /** Short-lived client token for the browser (not the API key). */
  apiKey: string;
  expiresAt: string;
  maxSessionSeconds: number;
  model: string;
}

export interface Capabilities {
  ai: { serverConfigured: boolean };
  desktop: boolean;
  backgroundRemoval: { server: string | null };
  weather: { provider: string; attribution: string; attributionUrl: string };
  limits: { maxUploadMb: number };
  /** Registration needs an invite code (REGISTRATION_CODE). */
  registration: { codeRequired: boolean };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
