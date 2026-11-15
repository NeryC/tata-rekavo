// Pure helpers for the "season so far" chart. No imports from the app or @core, so node:test can load it.

export const SEASON_DAYS = 365;
/** A lead of fewer days than this reads as "on schedule". */
export const ON_SCHEDULE_DAYS = 3;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Day of year of "YYYY-MM-DD" by the pipeline rule: DOY 1..365, Feb 29 merged into DOY 59, Mar 1 is DOY 60 in every
 *  year. Returns null for anything that is not a calendar date. */
export function doyOf(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const chk = new Date(t);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  const doy = Math.round((t - Date.UTC(y, 0, 1)) / 86400000) + 1;
  const merged = isLeap(y) && doy >= 60 ? doy - 1 : doy;
  return Math.min(SEASON_DAYS, Math.max(1, merged));
}

/** DOY (1..365) of the first day of each month, Jan..Dec. Same in every year thanks to the merged leap day. */
export const MONTH_START_DOY = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

/** Month (1..12) and day of month of a DOY (1..365) in a non-leap calendar. */
export function monthDayOf(doy: number): { month: number; day: number } {
  let mo = 11;
  while (mo > 0 && MONTH_START_DOY[mo] > doy) mo--;
  return { month: mo + 1, day: doy - MONTH_START_DOY[mo] + 1 };
}

/** Set of DOYs (1-based) listed as days without data, for the given year only. */
export function missingDoys(year: number, dates: readonly string[] | null | undefined): Set<number> {
  const out = new Set<number>();
  for (const d of dates ?? []) {
    if (typeof d !== "string" || !d.startsWith(`${year}-`)) continue;
    const doy = doyOf(d);
    if (doy !== null) out.add(doy);
  }
  return out;
}

export interface SeasonFile {
  meta: { years: [number, number]; doy: number; unit: string; generated: string };
  areas: Record<string, { p10: number[]; p50: number[]; p90: number[] }>;
}
export type SeasonClim = SeasonFile["areas"][string];

/** The climatology that belongs to the selected area, or null (custom areas, or an area season.json does not have). */
export function climatologyFor(
  season: SeasonFile | null, zoneKind: string, departmentId: string | null,
): SeasonClim | null {
  if (!season) return null;
  // the country and its region presets use their area id as zone ("paraguay", "chaco", a biome id), as season.json does
  const id = zoneKind === "department" ? departmentId : zoneKind === "custom" ? null : zoneKind;
  if (!id || !Object.hasOwn(season.areas, id)) return null;
  const a = season.areas[id];
  const ok = (v: unknown) => Array.isArray(v) && v.length === SEASON_DAYS;
  return a && ok(a.p10) && ok(a.p50) && ok(a.p90) ? a : null;
}

export interface StatusInput { ratio: number; leadDays: number | null; early: boolean }
/** How today's total compares with the year the median reaches it: a typical year reached this total on `doy` (past),
 *  only reaches it on `doy` (future), or is within ON_SCHEDULE_DAYS of it (onTime). */
export type SeasonReach = { when: "past" | "future"; doy: number } | { when: "onTime" };
export type SeasonSummary =
  | { kind: "early" }
  | { kind: "none" }
  | { kind: "vs"; dir: "above" | "below" | "same"; pct: number | null; reach: SeasonReach | null };

/** What the status sentence has to say. `cum` and `p50` are today's cumulative count and the median at the same day;
 *  `doy` is today's day of year. */
export function summarizeSeason(s: StatusInput, cum: number, p50: number, doy: number): SeasonSummary {
  if (s.early) return { kind: "early" };
  if (cum === 0 && p50 === 0) return { kind: "none" };
  let dir: "above" | "below" | "same" = "same", pct: number | null = null;
  if (!Number.isFinite(s.ratio)) { dir = "above"; }
  else {
    pct = Math.round(Math.abs(s.ratio - 1) * 100);
    dir = pct === 0 ? "same" : s.ratio > 1 ? "above" : "below";
  }
  let reach: SeasonReach | null = null;
  if (s.leadDays !== null && Number.isFinite(s.leadDays)) {
    const at = Math.min(SEASON_DAYS, Math.max(1, doy + s.leadDays)); // first DOY where the median >= today's total
    reach = Math.abs(s.leadDays) < ON_SCHEDULE_DAYS ? { when: "onTime" } : { when: s.leadDays > 0 ? "future" : "past", doy: at };
  }
  return { kind: "vs", dir, pct, reach };
}
