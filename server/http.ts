// Shared HTTP plumbing: context typing, errors, body helpers, auth middleware.
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { ZodError, type z } from "zod";
import type { AiService } from "./ai/service";
import { hashToken, secureCookies, sessionCookieName } from "./auth";
import type { AppConfig } from "./config";
import type { DB } from "./db";
import type { ImageStore } from "./images";
import type { OutfitService } from "./outfits";
import { getSessionUser, type UserRow } from "./repo";
import type { WeatherService } from "./weather";

export interface Deps {
  db: DB;
  cfg: AppConfig;
  images: ImageStore;
  ai: AiService;
  outfits: OutfitService;
  weather: WeatherService;
  fetchImpl?: typeof fetch;
}

export type AppEnv = { Variables: { user: UserRow } };

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const errorBody = (code: string, message: string, details?: unknown) => ({ error: { code, message, ...(details ? { details } : {}) } });

export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "BAD_JSON", "Die Anfrage enthält kein gültiges JSON.");
  }
  return schema.parse(raw);
}

export async function readImage(c: Context, field = "image"): Promise<{ buf: Buffer; form: Record<string, unknown> }> {
  let form: Record<string, unknown>;
  try {
    form = (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "BAD_FORM", "Die Anfrage enthält kein gültiges Formular.");
  }
  const file = form[field];
  if (!(file instanceof File)) throw new HttpError(400, "IMAGE_MISSING", "Es wurde kein Bild übermittelt.");
  return { buf: Buffer.from(await file.arrayBuffer()), form };
}

export function zodMessage(e: ZodError): string {
  const i = e.issues[0];
  if (!i) return "Ungültige Eingabe.";
  const where = i.path.length ? ` (${i.path.join(".")})` : "";
  return `${i.message}${where}`;
}

export { ZodError };

export function requireAuth(deps: Deps): MiddlewareHandler<AppEnv> {
  const name = sessionCookieName(secureCookies(deps.cfg));
  return async (c, next) => {
    const token = getCookie(c, name);
    const user = token ? getSessionUser(deps.db, hashToken(token)) : undefined;
    if (!user) {
      if (token) deleteCookie(c, name, { path: "/" });
      return c.json(errorBody("UNAUTHORIZED", "Bitte melde dich an."), 401);
    }
    c.set("user", user);
    await next();
  };
}
