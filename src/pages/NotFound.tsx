import { ButtonLink, EmptyState } from "../components/ui";

export function NotFoundPage() {
  return (
    <EmptyState title="Seite nicht gefunden" action={<ButtonLink to="/">Zur Startseite</ButtonLink>}>
      Diese Adresse gibt es nicht (mehr).
    </EmptyState>
  );
}
