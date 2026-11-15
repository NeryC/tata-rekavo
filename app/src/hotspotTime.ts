// When and with which sensor a hotspot was detected, and the rolling map windows.
// Pure helpers (no React, no @core) so `node --test` can run them directly.

/** what the map shows: the hotspots of the selected month, or a rolling window counted back from now */
export type HotspotWindow = "month" | "24h" | "7d";
export type RecentWindow = Exclude<HotspotWindow, "month">;

const WINDOW_MS: Record<RecentWindow, number> = { "24h": 24 * 3600e3, "7d": 7 * 24 * 3600e3 };
const LOCALES = { en: "en-US", es: "es" } as const;

/** FIRMS acq_date (YYYY-MM-DD, UTC) + acq_time (HHMM UTC, leading zeros often dropped) -> ISO UTC instant,
 *  or null when either is missing or invalid (an unknown time is never taken as midnight). */
export function acquiredAt(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!d || !/^\d{1,4}$/.test(time)) return null;
  const hhmm = time.padStart(4, "0");
  const h = Number(hhmm.slice(0, 2)), mi = Number(hhmm.slice(2));
  if (h > 23 || mi > 59) return null;
  const y = Number(d[1]), mo = Number(d[2]), day = Number(d[3]);
  const t = new Date(Date.UTC(y, mo - 1, day, h, mi));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== day) return null;
  return t.toISOString();
}

function safeZone(timeZone: string): string {
  try { new Intl.DateTimeFormat("en", { timeZone }); return timeZone; } catch { return "America/Asuncion"; }
}

/** Any instant as "15 nov 2026, 15:02 (GMT-3)" in the country's time zone; the input itself when it is not a date. */
export function formatInstant(iso: string, lang: "en" | "es", timeZone: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  const f = formatAcquired(iso.slice(0, 10), new Date(iso).toISOString(), lang, timeZone);
  return `${f.date}, ${f.time} (${f.zone})`;
}

/** Local date, time (24 h) and UTC offset ("GMT-3") of a detection in the country's time zone.
 *  Without a known instant only the acquisition date is given (time and zone null). */
export function formatAcquired(date: string, at: string | null, lang: "en" | "es", timeZone: string):
  { date: string; time: string | null; zone: string | null } {
  if (!at) {
    const [y, m, d] = date.split("-").map(Number);
    const day = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    if (Number.isNaN(day.getTime())) return { date, time: null, zone: null };
    return { date: new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: "medium", timeZone: "UTC" }).format(day), time: null, zone: null };
  }
  const tz = safeZone(timeZone);
  const t = new Date(at);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(t);
  let zone = "";
  try {
    zone = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(t)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch { /* older engines */ }
  return {
    date: new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: "medium", timeZone: tz }).format(t),
    time,
    zone: zone || tz,
  };
}

const SATELLITES: Record<string, string> = {
  N: "Suomi NPP", NPP: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21", "1": "NOAA-20", "2": "NOAA-21",
  T: "Terra", Terra: "Terra", A: "Aqua", Aqua: "Aqua",
};
/** FIRMS satellite code -> name; an unknown code is shown as given, a missing one is null. */
export function satelliteName(code: string): string | null {
  const c = code.trim();
  return c ? SATELLITES[c] ?? c : null;
}

/** VIIRS confidence (l/n/h) or MODIS confidence (0-100) -> "low" | "nominal" | "high" | "85%"; null when missing or unreadable. */
export function confidenceLabel(v: string): "low" | "nominal" | "high" | `${number}%` | null {
  const c = v.trim().toLowerCase();
  if (c === "l" || c === "low") return "low";
  if (c === "n" || c === "nominal") return "nominal";
  if (c === "h" || c === "high") return "high";
  if (/^\d{1,3}$/.test(c) && Number(c) <= 100) return `${Number(c)}%`;
  return null;
}

/** The detection falls in the rolling window that ends now (start included). An unknown instant is never in it. */
export function inWindow(at: string | null, w: RecentWindow, now: Date): boolean {
  if (!at) return false;
  const t = new Date(at).getTime(), n = now.getTime();
  return t <= n && t >= n - WINDOW_MS[w];
}

/** data older than this leave the window short: more than one missed twice-daily update (12 h + 2 h of run time), or the 48 hours
 *  after which the whole page already calls the data out of date */
const BEHIND_MS: Record<RecentWindow, number> = { "24h": 14 * 3600e3, "7d": 48 * 3600e3 };

/** What the map can say about a rolling window: how many points, their time span and whether the data
 *  are too old to cover the window (behind; also when the update time is unknown). */
export function windowCoverage(at: string[], w: RecentWindow, now: Date, generated: string | undefined) {
  const sorted = [...at].sort();
  const g = generated ? new Date(generated).getTime() : NaN;
  const behind = Number.isNaN(g) || now.getTime() - g > BEHIND_MS[w];
  return { count: at.length, first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null, behind };
}


export interface Provenance {
  /** acquisition instant (ISO, UTC); null when the date or time is missing or invalid */
  at: string | null;
  satellite: string | null; instrument: string | null; confidence: string | null; product: string | null;
}
/** Provenance fields of one FIRMS CSV row (cols: header names, f: the row's fields); empty or absent columns are null. */
export function provenance(cols: string[], f: string[]): Provenance {
  const get = (n: string) => { const i = cols.indexOf(n); const v = i >= 0 ? (f[i] ?? "").trim() : ""; return v || null; };
  const date = get("acq_date"), time = get("acq_time");
  return {
    at: date && time ? acquiredAt(date, time) : null,
    satellite: get("satellite"), instrument: get("instrument"), confidence: get("confidence"), product: get("product"),
  };
}

type DetailLabels = { hsTimeUnknown: string; hsUnknown: string; hsConf: { low: string; nominal: string; high: string } };
/** The texts a selected hotspot shows: local date and time with its zone, satellite and instrument, confidence and product. */
export function describeHotspot(h: Provenance & { date: string }, lang: "en" | "es", timeZone: string, t: DetailLabels) {
  const f = formatAcquired(h.date, h.at, lang, timeZone);
  const sat = h.satellite ? satelliteName(h.satellite) : null;
  const c = h.confidence ? confidenceLabel(h.confidence) : null;
  return {
    when: f.time ? `${f.date}, ${f.time} (${f.zone})` : `${f.date}, ${t.hsTimeUnknown}`,
    sensor: [sat, h.instrument].filter(Boolean).join(" · ") || t.hsUnknown,
    confidence: c === null ? t.hsUnknown : c.endsWith("%") ? c : t.hsConf[c as "low" | "nominal" | "high"],
    product: h.product ?? t.hsUnknown,
  };
}

/** URL param `f`: lat and lon rounded to 0.01 degree (~1 km) and the UTC acquisition time as YYYYMMDDHHMM,
 *  or only YYYYMMDD when the time is unknown */
export interface HotspotRef { lat: number; lon: number; t: string }

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The reference of a hotspot. The location is rounded so a link never carries a more precise point than
 *  the ~1 km the satellite pixel already blurs; the exact point stays in the public FIRMS data. */
export function shareRef(h: { lat: number; lon: number; date: string; at: string | null }): HotspotRef {
  const t = h.at ? h.at.slice(0, 16).replace(/[-T:]/g, "") : h.date.replace(/-/g, "");
  return { lat: round2(h.lat), lon: round2(h.lon), t };
}

/** The acquisition date and instant (null without a time) a reference names; null when it is not a valid date or time. */
export function refInstant(t: string): { date: string; at: string | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{4})?$/.exec(t);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const at = acquiredAt(date, m[4] ?? "0000");
  if (!at) return null;
  return { date, at: m[4] ? at : null };
}

/** Hotspots of the referenced pass inside its rounded ~1 km cell (one pass can detect several neighbouring pixels). */
export function findShared<T extends { lat: number; lon: number; date: string; at: string | null }>(hotspots: T[], ref: HotspotRef): T[] {
  const when = refInstant(ref.t);
  if (!when) return [];
  return hotspots.filter((h) => round2(h.lat) === ref.lat && round2(h.lon) === ref.lon
    && (when.at ? h.at === when.at : !h.at && h.date === when.date));
}
