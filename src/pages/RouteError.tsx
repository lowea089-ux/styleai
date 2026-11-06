import { useRouteError } from "react-router";
import { Button, EmptyState } from "../components/ui";

/** Shown instead of a blank screen when a page throws while rendering. */
export function RouteError() {
  const err = useRouteError();
  if (import.meta.env.DEV) console.error(err);
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <EmptyState title="Etwas ist schiefgelaufen" action={<Button onClick={() => window.location.reload()}>Seite neu laden</Button>}>
        Diese Ansicht konnte nicht angezeigt werden. Deine Daten sind nicht betroffen.
      </EmptyState>
    </div>
  );
}
