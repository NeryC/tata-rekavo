// Pure helpers that turn a decoded ShareState into App state. Month indices are
// relative to meta.months.first ("YYYY-MM"); no React, no @core, so node:test can run it.
import type { ShareState } from "./urlState.ts";

export type Coords = { lat: number; lon: number; r: number };

const parseYM = (ym: string): number => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
};

/** "YYYY-MM" -> month index (may be negative or >= n when outside the data). */
export function rawMonthIndex(first: string, ym: string): number {
  return parseYM(ym) - parseYM(first);
}

/** month index -> "YYYY-MM". */
export function indexToMonth(first: string, idx: number): string {
  const t = parseYM(first) + idx;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** A single month from a link: anything outside the available data falls back to the last month. */
export function monthFromLink(first: string, ym: string | undefined, nMonths: number): number {
  const last = nMonths - 1;
  if (!ym) return last;
  const i = rawMonthIndex(first, ym);
  return i < 0 || i > last ? last : i;
}

/** A range from a link: each end is clamped into [0, nMonths-1]; an inverted range is swapped. */
export function rangeFromLink(first: string, range: [string, string] | undefined, nMonths: number, fallback: [number, number]): [number, number] {
  if (!range) return fallback;
  const last = nMonths - 1;
  const cl = (ym: string) => Math.min(last, Math.max(0, rawMonthIndex(first, ym)));
  const a = cl(range[0]), b = cl(range[1]);
  return a <= b ? [a, b] : [b, a];
}

/** Every vertex ([lon, lat]) must lie inside the Paraguay frame (with margin). */
export function polyInBounds(poly: number[][]): boolean {
  return poly.every(([lon, lat]) => lat >= -28 && lat <= -19 && lon >= -63 && lon <= -54);
}

/** Close the ring (the writer decimates and may drop the closing vertex). */
export function closeRing(poly: number[][]): number[][] {
  const f = poly[0], l = poly[poly.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? poly : [...poly, f];
}

export type Restored = {
  zone: "paraguay" | "chaco" | "oriental" | "custom" | "department";
  dep: string | null; // set when zone === "department"
  coords: Coords | null;
  poly: number[][] | null; // set when zone === "custom" and no coords
  month: number;
  range: [number, number];
  cal: "ratio" | "count";
  naive: boolean;
  newOnly: boolean;
};

/**
 * @param departmentIds ids of the loaded departments; null when departments.json is not available
 *   (then a department link falls back to Paraguay, like an unknown id does).
 */
export function planRestore(first: string, nMonths: number, s: ShareState, defaultRange: [number, number],
  departmentIds: readonly string[] | null = null): Restored {
  let zone: Restored["zone"] = "paraguay";
  let dep: string | null = null;
  let coords: Coords | null = null;
  let poly: number[][] | null = null;
  if (s.c) { zone = "custom"; coords = s.c; }
  else if (s.poly && polyInBounds(s.poly)) { zone = "custom"; poly = closeRing(s.poly); }
  else if (s.zone === "chaco" || s.zone === "oriental") zone = s.zone;
  else if (s.zone === "department" && s.dep && departmentIds?.includes(s.dep)) { zone = "department"; dep = s.dep; }
  // custom without geometry has nothing to draw, and a department that is unknown or could not be loaded
  // has no cells: both stay Paraguay
  return {
    zone, dep, coords, poly,
    month: monthFromLink(first, s.m, nMonths),
    range: rangeFromLink(first, s.range, nMonths, defaultRange),
    cal: s.cal ?? "ratio",
    naive: !!s.naive,
    newOnly: !!s.newOnly,
  };
}
