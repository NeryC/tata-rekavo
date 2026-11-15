// Pure codec between the shareable app state and a URL query string.
// No React, no @core: clamping to the available data range happens in App.

export type BBox = [number, number, number, number]; // [w, s, e, n]

export type ShareState = {
  lang?: "en" | "es";
  /** ISO3 of the country (URL param `country`); "PRY", the default, is not written */
  country?: string;
  /** the country's own area id ("paraguay"), a factor region id ("chaco", a biome slug), "custom" or "department" */
  zone?: string;
  dep?: string;
  poly?: number[][]; // [[lon, lat], ...]
  c?: { lat: number; lon: number; r: number };
  m?: string; // "YYYY-MM"
  range?: [string, string]; // ["YYYY-MM", "YYYY-MM"]
  cal?: "ratio" | "count";
  naive?: boolean;
  newOnly?: boolean;
  metric?: "count" | "frp"; // URL param x; "count" is the default and is not written
  /** map points of a rolling window (URL param w); absent = the selected month, as in older links */
  win?: "24h" | "7d";
};

const MAX_VERTICES = 120;
const ZONE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/; // area ids are slugs; App keeps only the presets the country has
const COUNTRY_RE = /^[A-Z]{3}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const DEFAULT_COUNTRY = "PRY";
export const PRY_BBOX: BBox = [-62.8, -27.7, -54.1, -19.1];
/** bbox of a country, undefined when unknown; without the countries index only Paraguay is known */
export type BBoxOf = (iso3: string) => BBox | undefined;
const pryOnly: BBoxOf = (iso3) => (iso3 === DEFAULT_COUNTRY ? PRY_BBOX : undefined);

/** A point inside the country's bbox (Paraguay by default) and a radius between 5 and 300 km. */
export function validateCoords(lat: number, lon: number, r: number, bbox: BBox = PRY_BBOX): boolean {
  const [w, s, e, n] = bbox;
  return lat >= s && lat <= n && lon >= w && lon <= e && r >= 5 && r <= 300;
}

const num = (n: number): string => String(Number(n.toFixed(3)));

function decimate(poly: number[][]): number[][] {
  if (poly.length <= MAX_VERTICES) return poly;
  const step = poly.length / MAX_VERTICES;
  return Array.from({ length: MAX_VERTICES }, (_, i) => poly[Math.floor(i * step)]);
}

export function encodeState(s: ShareState): string {
  const p = new URLSearchParams();
  if (s.lang) p.set("lang", s.lang);
  if (s.country && s.country !== DEFAULT_COUNTRY) p.set("country", s.country);
  if (s.zone && s.zone !== "paraguay") p.set("z", s.zone);
  if (s.dep) p.set("dep", s.dep);
  if (s.poly && s.poly.length >= 3) {
    p.set("poly", decimate(s.poly).map(([lon, lat]) => `${num(lon)},${num(lat)}`).join(";"));
  }
  if (s.c) p.set("c", `${num(s.c.lat)},${num(s.c.lon)},${num(s.c.r)}`);
  if (s.m) p.set("m", s.m);
  if (s.range) p.set("r", `${s.range[0]}..${s.range[1]}`);
  if (s.cal && s.cal !== "ratio") p.set("cal", s.cal);
  if (s.naive) p.set("naive", "1");
  if (s.newOnly) p.set("new", "1");
  if (s.metric === "frp") p.set("x", "frp");
  if (s.win === "24h" || s.win === "7d") p.set("w", s.win);
  // "," and ";" are legal in a query string; keeping them raw saves ~4 chars per
  // vertex so a 120-vertex polygon stays under 2000 chars. decodeState accepts both.
  return p.toString().replace(/%2C/gi, ",").replace(/%3B/gi, ";");
}

const parseNums = (s: string, n: number): number[] | null => {
  const parts = s.split(",");
  if (parts.length !== n) return null;
  const out = parts.map((x) => (x.trim() === "" ? NaN : Number(x)));
  return out.every(Number.isFinite) ? out : null;
};

/** The country a link asks for: its `country` param (ISO3, any case), or Paraguay when there is none. */
export function countryOf(search: string): string {
  const c = new URLSearchParams(search).get("country")?.toUpperCase();
  return c && COUNTRY_RE.test(c) ? c : DEFAULT_COUNTRY;
}

/**
 * @param bboxOf bbox of a country, for the `c` (point + radius) check; a link for a country without a known bbox loses `c`.
 *   Default: Paraguay only.
 */
export function decodeState(search: string, bboxOf: BBoxOf = pryOnly): ShareState {
  const p = new URLSearchParams(search);
  const out: ShareState = {};

  const lang = p.get("lang");
  if (lang === "en" || lang === "es") out.lang = lang;

  const country = countryOf(search);
  if (p.has("country") && country !== DEFAULT_COUNTRY) out.country = country;

  const z = p.get("z");
  if (z && ZONE_RE.test(z)) out.zone = z;

  const dep = p.get("dep");
  if (dep) out.dep = dep;

  const poly = p.get("poly");
  if (poly) {
    const pts = poly.split(";").map((v) => parseNums(v, 2));
    if (pts.length >= 3 && pts.every((v): v is number[] => v !== null)) out.poly = pts;
  }

  const c = p.get("c");
  if (c) {
    const v = parseNums(c, 3);
    const bbox = bboxOf(country);
    if (v && bbox && validateCoords(v[0], v[1], v[2], bbox)) out.c = { lat: v[0], lon: v[1], r: v[2] };
  }

  const m = p.get("m");
  if (m && MONTH_RE.test(m)) out.m = m;

  const r = p.get("r");
  if (r) {
    const [a, b, ...rest] = r.split("..");
    if (rest.length === 0 && a && b && MONTH_RE.test(a) && MONTH_RE.test(b)) out.range = [a, b];
  }

  const cal = p.get("cal");
  if (cal === "ratio" || cal === "count") out.cal = cal;

  if (p.get("naive") === "1") out.naive = true;
  if (p.get("new") === "1") out.newOnly = true;
  if (p.get("x") === "frp") out.metric = "frp";
  const w = p.get("w");
  if (w === "24h" || w === "7d") out.win = w;

  return out;
}
