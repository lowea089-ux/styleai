import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { categoryInputSchema, categoryPatchSchema, loginSchema, preferencesPatchSchema, registerSchema } from "../../shared/schemas";
import { DUMMY_HASH, hashPassword, hashToken, newSessionToken, secureCookies, SESSION_TTL_DAYS, sessionCookieName, verifyPassword } from "../auth";
import { HttpError, readJson, requireAuth, type AppEnv, type Deps } from "../http";
import { RateLimiter } from "../ratelimit";
import * as repo from "../repo";

export function authRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const cookie = sessionCookieName(secureCookies(deps.cfg));
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const registerLimiter = new RateLimiter(10, 60 * 60_000);
  const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  const startSession = (c: Parameters<typeof setCookie>[0], userId: string) => {
    const token = newSessionToken();
    const expires = repo.createSession(deps.db, userId, hashToken(token), SESSION_TTL_DAYS);
    setCookie(c, cookie, token, { httpOnly: true, sameSite: "Lax", secure: secureCookies(deps.cfg), path: "/", expires });
  };

  app.post("/register", async (c) => {
    if (!registerLimiter.hit(ip(c)).ok) throw new HttpError(429, "RATE_LIMIT", "Zu viele Registrierungen. Bitte später erneut versuchen.");
    const input = await readJson(c, registerSchema);
    const required = deps.cfg.registrationCode;
    if (required) {
      if (!input.code) throw new HttpError(403, "INVITE_REQUIRED", "Für die Registrierung ist ein Einladungscode nötig.");
      // Compare digests in constant time, so the code cannot be guessed character by character.
      const digest = (s: string) => createHash("sha256").update(s).digest();
      if (!timingSafeEqual(digest(input.code), digest(required))) throw new HttpError(403, "INVITE_INVALID", "Der Einladungscode ist falsch.");
    }
    if (repo.findUserByEmail(deps.db, input.email)) throw new HttpError(409, "EMAIL_TAKEN", "Für diese E-Mail-Adresse gibt es bereits ein Konto.");
    const user = repo.createUser(deps.db, input.email, await hashPassword(input.password), input.displayName);
    startSession(c, user.id);
    return c.json({ user: repo.toMe(user) }, 201);
  });

  app.post("/login", async (c) => {
    const input = await readJson(c, loginSchema);
    const key = `${ip(c)}|${input.email}`;
    const rl = loginLimiter.hit(key);
    if (!rl.ok) throw new HttpError(429, "RATE_LIMIT", `Zu viele Anmeldeversuche. Bitte in ${Math.ceil(rl.retryAfterSec / 60)} Minuten erneut versuchen.`);
    const user = repo.findUserByEmail(deps.db, input.email);
    const ok = await verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, "INVALID_CREDENTIALS", "E-Mail oder Passwort ist falsch.");
    loginLimiter.reset(key);
    repo.purgeExpiredSessions(deps.db);
    startSession(c, user.id);
    return c.json({ user: repo.toMe(user) });
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, cookie);
    if (token) repo.deleteSession(deps.db, hashToken(token));
    deleteCookie(c, cookie, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/me", requireAuth(deps), (c) => c.json({ user: repo.toMe(c.get("user")) }));
  return app;
}

export function accountRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const cookie = sessionCookieName(secureCookies(deps.cfg));

  app.get("/export", (c) => {
    const data = repo.exportUserData(deps.db, c.get("user").id);
    c.header("Content-Disposition", `attachment; filename="styleai-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(data);
  });

  app.post("/ai-consent", async (c) => {
    const { consent } = await readJson(c, z.object({ consent: z.boolean() }));
    repo.setAiConsent(deps.db, c.get("user").id, consent);
    return c.json({ user: repo.toMe(repo.getUser(deps.db, c.get("user").id)!) });
  });

  app.delete("/", async (c) => {
    const { password } = await readJson(c, z.object({ password: z.string().min(1).max(200) }));
    const user = c.get("user");
    if (!(await verifyPassword(password, user.password_hash))) throw new HttpError(403, "INVALID_PASSWORD", "Das Passwort ist falsch.");
    repo.deleteUser(deps.db, user.id);
    await deps.images.removeUser(user.id);
    deleteCookie(c, cookie, { path: "/" });
    return c.json({ ok: true });
  });

  return app;
}

export function preferencesRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json({ preferences: repo.getPreferences(deps.db, c.get("user").id) }));
  app.patch("/", async (c) => {
    const patch = await readJson(c, preferencesPatchSchema);
    return c.json({ preferences: repo.updatePreferences(deps.db, c.get("user").id, patch) });
  });
  app.get("/learned", (c) => c.json({ learned: deps.outfits.learned(c.get("user").id) }));
  app.delete("/learned", (c) => {
    repo.clearFeedback(deps.db, c.get("user").id);
    return c.json({ ok: true });
  });
  return app;
}

export function categoryRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json({ categories: repo.listCategories(deps.db, c.get("user").id) }));
  app.post("/", async (c) => {
    const input = await readJson(c, categoryInputSchema);
    return c.json({ category: repo.createCategory(deps.db, c.get("user").id, input) }, 201);
  });
  app.patch("/:id", async (c) => {
    const patch = await readJson(c, categoryPatchSchema);
    return c.json({ category: repo.updateCategory(deps.db, c.get("user").id, c.req.param("id"), patch) });
  });
  app.delete("/:id", (c) => {
    repo.deleteCategory(deps.db, c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });
  return app;
}
