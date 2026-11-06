export const isoDate = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
};
export const todayIso = () => isoDate(new Date());

export const fromIso = (s: string) => new Date(s + "T12:00:00");

export const formatDate = (s: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("de-DE", opts).format(fromIso(s.slice(0, 10)));

export const formatWeekday = (s: string) => new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(fromIso(s));

export const formatEuro = (cents: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(12, 0, 0, 0);
  return x;
}

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Hallo";
  if (h < 22) return "Guten Abend";
  return "Gute Nacht";
}

export const relativeDays = (iso: string | null) => {
  if (!iso) return "noch nie";
  const days = Math.round((Date.now() - fromIso(iso).getTime()) / 86_400_000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 30) return `vor ${days} Tagen`;
  if (days < 365) return `vor ${Math.round(days / 30)} Monat${Math.round(days / 30) > 1 ? "en" : ""}`;
  return `vor über einem Jahr`;
};
