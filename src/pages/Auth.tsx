import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import type { Me } from "../../shared/types";
import { Logo } from "../components/AppShell";
import { Button, Field, Input, Notice } from "../components/ui";
import { BRAND } from "../brand";
import { api, errorMessage } from "../lib/api";
import { LOCAL_EDITION } from "../lib/edition";
import { qk, useCapabilities, useMe } from "../lib/queries";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const caps = useCapabilities();
  const codeRequired = mode === "register" && !!caps.data?.registration.codeRequired;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The browser edition has no accounts: whoever uses this browser owns its data.
  if (me.data || LOCAL_EDITION) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === "login"
          ? await api.post<{ user: Me }>("/api/auth/login", { email, password })
          : await api.post<{ user: Me }>("/api/auth/register", { email, password, displayName: name, ...(codeRequired ? { code } : {}) });
      qc.clear();
      qc.setQueryData(qk.me, r.user);
      nav(mode === "register" ? "/onboarding" : ((loc.state as { from?: string } | null)?.from ?? "/"), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh md:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-ink p-12 text-paper md:flex md:flex-col">
        <Logo className="text-paper" />
        <div className="mt-auto max-w-md">
          <p className="eyebrow !text-paper/60">Digitaler Kleiderschrank · KI-Stylist</p>
          <h1 className="mt-3 font-display text-5xl leading-[1.05]">Mehr Looks aus dem, was du schon hast.</h1>
          <p className="mt-4 text-paper/70">{BRAND.description}</p>
        </div>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-accent/40 blur-3xl" />
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate>
          <div className="md:hidden">
            <Logo />
          </div>
          <div>
            <h2 className="font-display text-3xl">{mode === "login" ? "Willkommen zurück" : "Konto erstellen"}</h2>
            <p className="mt-1 text-sm text-muted">{mode === "login" ? "Melde dich an, um deinen Kleiderschrank zu öffnen." : "Dein Kleiderschrank bleibt privat – nur du siehst deine Fotos."}</p>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          {mode === "register" && (
            <Field label="Name" htmlFor="name">
              <Input id="name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
            </Field>
          )}
          <Field label="E-Mail" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Passwort" htmlFor="password" hint={mode === "register" ? "Mindestens 10 Zeichen." : undefined}>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 10 : 1}
            />
          </Field>
          {codeRequired && (
            <Field label="Einladungscode" htmlFor="code" hint="Diese App ist privat. Den Code bekommst du von der Person, die sie betreibt.">
              <Input id="code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required />
            </Field>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {mode === "login" ? "Anmelden" : "Registrieren"}
          </Button>
          <p className="text-center text-sm text-muted">
            {mode === "login" ? (
              <>
                Neu hier?{" "}
                <Link className="font-medium text-ink underline underline-offset-2" to="/register">
                  Konto erstellen
                </Link>
              </>
            ) : (
              <>
                Schon registriert?{" "}
                <Link className="font-medium text-ink underline underline-offset-2" to="/login">
                  Anmelden
                </Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
