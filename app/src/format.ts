// Pure helpers (no React, no @core) so `node --test` can run them directly.

const LOCALES = { en: "en-US", es: "es" } as const;
const TIME_ZONE = "America/Asuncion";

/** ISO timestamp -> "14 nov 2026, 12:20" style text in Asuncion time. Returns the input if it is not a date. */
export function formatUpdated(iso: string, lang: "en" | "es"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE }).format(d);
}

/** True when `iso` is more than `hours` before `now`. An unparseable timestamp is not flagged. */
export function isStale(iso: string, now: Date, hours = 48): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > hours * 3600e3;
}
