// Pure codec between the shareable app state and a URL query string.
// No React, no @core: clamping to the available data range happens in App.

export type ShareState = {
  lang?: "en" | "es";
  zone?: "paraguay" | "chaco" | "oriental" | "custom" | "department";
  dep?: string;
  poly?: number[][]; // [[lon, lat], ...]
  c?: { lat: number; lon: number; r: number };
  m?: string; // "YYYY-MM"
  range?: [string, string]; // ["YYYY-MM", "YYYY-MM"]
  cal?: "ratio" | "count";
  naive?: boolean;
  newOnly?: boolean;
};

const MAX_VERTICES = 120;
const ZONES = ["paraguay", "chaco", "oriental", "custom", "department"] as const;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validateCoords(lat: number, lon: number, r: number): boolean {
  return lat >= -27.7 && lat <= -19.1 && lon >= -62.8 && lon <= -54.1 && r >= 5 && r <= 300;
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

export function decodeState(search: string): ShareState {
  const p = new URLSearchParams(search);
  const out: ShareState = {};

  const lang = p.get("lang");
  if (lang === "en" || lang === "es") out.lang = lang;

  const z = p.get("z");
  if (z && (ZONES as readonly string[]).includes(z)) out.zone = z as ShareState["zone"];

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
    if (v && validateCoords(v[0], v[1], v[2])) out.c = { lat: v[0], lon: v[1], r: v[2] };
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

  return out;
}
