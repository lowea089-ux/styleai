import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell";
import { ToastProvider } from "./components/ui";
import { ApiError, setUnauthorizedHandler } from "./lib/api";
import { LOCAL_EDITION, startLocalEdition } from "./lib/edition";
import { qk } from "./lib/queries";
import { applyTheme, initialTheme, watchSystemTheme } from "./lib/theme";
import { AuthPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";
import { NotFoundPage } from "./pages/NotFound";
import { RouteError } from "./pages/RouteError";

// Less frequently opened pages are loaded on demand.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => async () => ({ Component: (await load())[name] });

applyTheme(initialTheme());
watchSystemTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
setUnauthorizedHandler(() => queryClient.setQueryData(qk.me, null));

const routes = [
  { path: "/login", element: <AuthPage mode="login" /> },
  { path: "/register", element: <AuthPage mode="register" /> },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/onboarding", lazy: page(() => import("./pages/Onboarding"), "OnboardingPage") },
      { path: "/wardrobe", lazy: page(() => import("./pages/Wardrobe"), "WardrobePage") },
      { path: "/wardrobe/add", lazy: page(() => import("./pages/AddItems"), "AddItemsPage") },
      { path: "/wardrobe/:id", lazy: page(() => import("./pages/ItemDetail"), "ItemDetailPage") },
      { path: "/outfits", lazy: page(() => import("./pages/Outfits"), "OutfitsPage") },
      { path: "/outfits/:id", lazy: page(() => import("./pages/OutfitDetail"), "OutfitDetailPage") },
      { path: "/calendar", lazy: page(() => import("./pages/Calendar"), "CalendarPage") },
      { path: "/style", lazy: page(() => import("./pages/Style"), "StylePage") },
      { path: "/trends", lazy: page(() => import("./pages/Trends"), "TrendsPage") },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

const root = createRoot(document.getElementById("root")!);

function renderApp() {
  // The browser edition lives in a sub-folder (e.g. /styleai/ on GitHub Pages).
  const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

if (LOCAL_EDITION) {
  root.render(<BootScreen />);
  startLocalEdition().then(renderApp, (e: Error) => root.render(<BootScreen error={e.message} />));
} else {
  renderApp();
}

function BootScreen({ error }: { error?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="font-display text-[26px] font-semibold tracking-tight">
        Style<span className="text-accent">AI</span>
      </span>
      {error ? (
        <>
          <p className="max-w-sm text-sm text-muted">{error}</p>
          <button type="button" onClick={() => window.location.reload()} className="h-10 rounded-full bg-ink px-5 text-sm font-medium text-paper">
            Neu laden
          </button>
        </>
      ) : (
        <p className="text-sm text-muted">Wird gestartet …</p>
      )}
    </div>
  );
}
