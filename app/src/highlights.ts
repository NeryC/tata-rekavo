// Pure helpers of the "at a glance" strip: the South America summary (summary.json) and the shareable fire alert.

export interface CountrySummary {
  month: string; // "YYYY-MM"
  coverage: number;
  value: number;
  median: number;
  ratio: number | null;
  classId: "low" | "normal" | "high" | "extreme";
  generated: string | null;
}
export interface SummaryFile { generated: string; countries: Record<string, CountrySummary> }

const CLASSES = new Set(["low", "normal", "high", "extreme"]);

/** summary.json when it has the expected shape (malformed country entries are dropped), else null. */
export function validSummary(j: unknown): SummaryFile | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (typeof o.generated !== "string" || !o.countries || typeof o.countries !== "object") return null;
  const countries: Record<string, CountrySummary> = {};
  for (const [iso3, v] of Object.entries(o.countries as Record<string, unknown>)) {
    const c = v as Partial<CountrySummary> | null;
    if (!/^[A-Z]{3}$/.test(iso3) || !c || typeof c.month !== "string" || !/^\d{4}-\d{2}$/.test(c.month)) continue;
    if (typeof c.value !== "number" || typeof c.coverage !== "number" || !CLASSES.has(c.classId as string)) continue;
    if (c.ratio !== null && typeof c.ratio !== "number") continue;
    countries[iso3] = { month: c.month, coverage: c.coverage, value: c.value, median: typeof c.median === "number" ? c.median : 0,
      ratio: c.ratio ?? null, classId: c.classId as CountrySummary["classId"], generated: typeof c.generated === "string" ? c.generated : null };
  }
  return { generated: o.generated, countries };
}

/** The newer of two summaries by `generated` (either may be null). */
export function newerSummary(a: SummaryFile | null, b: SummaryFile | null): SummaryFile | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.generated) > Date.parse(a.generated) ? b : a;
}

export interface AlertRow { name: string; ratio: number; classId: string; lowSignal: boolean }
export interface AlertWords {
  /** e.g. "Abnormal fire in Paraguay, November 2026 (in progress)" */
  head: (country: string, month: string) => string;
  /** e.g. "×1.63 the usual level (high)" */
  row: (ratio: string, className: string) => string;
  none: (country: string, month: string) => string;
  more: (n: number) => string;
  see: string;
  classes: Record<string, string>;
}

/** Departments to put in an alert: high or extreme and with enough fire to rank, highest ratio first, at most `max`. */
export function alertRows<T extends AlertRow>(rows: T[], max = 5): { shown: T[]; more: number } {
  const hot = rows.filter((r) => !r.lowSignal && (r.classId === "high" || r.classId === "extreme"))
    .sort((a, b) => b.ratio - a.ratio);
  return { shown: hot.slice(0, max), more: Math.max(0, hot.length - max) };
}

/** Plain-text alert for WhatsApp and similar: a heading, one line per abnormal department and the link. */
export function alertText(rows: AlertRow[], country: string, month: string, link: string, w: AlertWords, fmt: (x: number) => string): string {
  const { shown, more } = alertRows(rows);
  if (!shown.length) return `✅ ${w.none(country, month)}\n${w.see} ${link}`;
  const lines = shown.map((r) => `• ${r.name}: ${w.row(fmt(r.ratio), w.classes[r.classId] ?? r.classId)}`);
  if (more) lines.push(w.more(more));
  return `🔥 ${w.head(country, month)}\n${lines.join("\n")}\n${w.see} ${link}`;
}
