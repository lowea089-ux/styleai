import clsx from "clsx";
import { CalendarDays, Home, Layers, Sparkles, Shirt, UserRound } from "lucide-react";
import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { BRAND } from "../brand";
import { LOCAL_EDITION } from "../lib/edition";
import { usePreferences, useMe } from "../lib/queries";
import { applyTheme } from "../lib/theme";
import { StylistSheet, stylistStore } from "./StylistSheet";
import { Button, EmptyState, Spinner } from "./ui";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/wardrobe", label: "Kleiderschrank", icon: Shirt },
  { to: "/outfits", label: "Outfits", icon: Layers },
  { to: "/calendar", label: "Kalender", icon: CalendarDays },
  { to: "/style", label: "Mein Stil", icon: UserRound },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("font-display text-[22px] font-semibold tracking-tight", className)}>
      {BRAND.name.replace(/AI$/, "")}
      <span className="text-accent">{BRAND.name.endsWith("AI") ? "AI" : ""}</span>
    </span>
  );
}

export function AppShell() {
  const me = useMe();
  const prefs = usePreferences();
  const loc = useLocation();

  useEffect(() => {
    if (prefs.data) applyTheme(prefs.data.theme);
  }, [prefs.data]);

  if (me.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState
          title={LOCAL_EDITION ? "Daten nicht lesbar" : "Server nicht erreichbar"}
          action={
            <Button onClick={() => me.refetch()} loading={me.isFetching}>
              Erneut versuchen
            </Button>
          }
        >
          {LOCAL_EDITION ? me.error.message : "Die App kann gerade keine Verbindung zum Server herstellen. Deine Daten sind sicher gespeichert."}
        </EmptyState>
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (prefs.data && !prefs.data.onboardingCompleted && loc.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;

  return (
    <div className="min-h-dvh md:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
        Zum Inhalt springen
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface px-4 py-6 md:flex">
        <Logo className="px-3" />
        <p className="mt-1 px-3 text-xs text-muted">{BRAND.tagline}</p>
        <nav aria-label="Hauptnavigation" className="mt-8 flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => clsx("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors", isActive ? "bg-ink text-paper" : "text-ink-soft hover:bg-surface-2")}
            >
              <n.icon className="size-[18px]" aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => stylistStore.set({ open: true })}
          className="mt-auto flex items-center gap-3 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-hover"
        >
          <Sparkles className="size-[18px]" aria-hidden /> Stylist fragen
        </button>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/60 bg-paper/85 px-4 backdrop-blur md:hidden">
        <Logo />
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-32 pt-5 md:px-8 md:pb-16 md:pt-10">
        <Outlet />
      </main>

      {/* Stylist FAB (mobile) */}
      <button
        type="button"
        onClick={() => stylistStore.set({ open: true })}
        aria-label="Stylist fragen"
        className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition active:scale-95 md:hidden"
      >
        <Sparkles className="size-6" />
      </button>

      {/* Mobile bottom navigation */}
      <nav aria-label="Hauptnavigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) => clsx("flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] transition-colors", isActive ? "text-ink" : "text-muted")}
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx("flex h-7 w-12 items-center justify-center rounded-full transition-colors", isActive && "bg-accent-soft text-accent")}>
                      <n.icon className="size-5" aria-hidden />
                    </span>
                    {n.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <StylistSheet />
    </div>
  );
}
