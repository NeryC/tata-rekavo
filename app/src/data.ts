import * as H from "@core";
import type { CurrentMeta, Grid, GridMeta } from "@core";
import type { I18n } from "./i18n";

export interface Hotspot {
  lon: number; lat: number; date: string; m: number; frp: number; cell: number;
  /** no hotspot from any sensor within ~1 km (same or neighbouring 0.01-degree cell), Jul 2002 - Dec 2025 */
  fresh: boolean;
  raw: string;
}
export interface AppData { grid: Grid; current: CurrentMeta | null; hotspotsHeader: string; hotspots: Hotspot[]; historyPeriod: string }

const url = (f: string) => `${import.meta.env.BASE_URL}${f}`;

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface BurnHistory { deg: number; lat0: number; lon0: number; rows: number; cols: number; period: string; last_year_minus_2000_b64: string }

/** true when no hotspot was ever recorded in the ~1 km cell of (lon, lat) or its 8 neighbours */
function makeFreshTest(bh: BurnHistory) {
  const last = b64ToBytes(bh.last_year_minus_2000_b64);
  return (lon: number, lat: number) => {
    const r = Math.floor((lat - bh.lat0) / bh.deg), c = Math.floor((lon - bh.lon0) / bh.deg);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= bh.rows || cc >= bh.cols) continue;
      if (last[rr * bh.cols + cc]) return false;
    }
    return true;
  };
}

export async function loadData(): Promise<AppData> {
  const [gridJson, currentJson, burnJson] = await Promise.all([
    fetch(url("grid.json")).then((r) => r.json()),
    fetch(url("current.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(url("burn_history.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<BurnHistory | null>,
  ]);
  const grid = H.decodeGrid(gridJson, currentJson);
  const isFresh = burnJson ? makeFreshTest(burnJson) : () => false;
  let hotspotsHeader = "";
  let hotspots: Hotspot[] = [];
  try {
    const txt = await fetch(url("current_hotspots.csv")).then((r) => (r.ok ? r.text() : ""));
    const lines = txt.trim().split("\n");
    hotspotsHeader = lines[0] + ",new_place";
    const cols = lines[0].split(",");
    const iLat = cols.indexOf("latitude"), iLon = cols.indexOf("longitude"), iDate = cols.indexOf("acq_date"), iFrp = cols.indexOf("frp");
    hotspots = lines.slice(1).map((line) => {
      const f = line.split(",");
      const lat = +f[iLat], lon = +f[iLon], date = f[iDate];
      const [y, mo] = date.split("-").map(Number);
      const fresh = isFresh(lon, lat);
      return { lat, lon, date, frp: +f[iFrp], m: H.indexOf(grid.meta, y, mo), cell: H.cellAt(grid.meta, lon, lat), fresh,
               raw: `${line},${fresh ? 1 : 0}` };
    });
  } catch { /* hotspots are optional */ }
  return { grid, current: currentJson ? currentJson.meta : null, hotspotsHeader, hotspots, historyPeriod: burnJson?.period ?? "" };
}

function interp(x: number, xs: number[], ys: number[]) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
  }
  return ys[ys.length - 1];
}

export function regionOfCell(meta: GridMeta, idx: number): "chaco" | "oriental" {
  const [lon, lat] = H.cellCenter(meta, idx);
  const r = meta.regions;
  return lon < interp(lat, r.river_lat, r.river_lon) && lat > r.chaco_south ? "chaco" : "oriental";
}

export function cellPolygon(meta: GridMeta, idx: number): number[][] {
  const g = meta.grid, r = Math.floor(idx / g.cols), c = idx % g.cols;
  const w = g.lon0 + c * g.deg, s = g.lat0 + r * g.deg, e = w + g.deg, n = s + g.deg;
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
}

export function bboxOfCells(meta: GridMeta, ids: number[]): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const id of ids) {
    const [lon, lat] = H.cellCenter(meta, id);
    w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  const d = meta.grid.deg;
  return [w - d, s - d, e + d, n + d];
}

/** Approximate area of a set of 0.1-degree cells in km2. */
export function areaKm2(meta: GridMeta, ids: number[]) {
  const d = meta.grid.deg;
  return ids.reduce((s, id) => s + (d * 111.32) * (d * 111.32 * Math.cos((H.cellCenter(meta, id)[1] * Math.PI) / 180)), 0);
}

const SATS: Record<string, string> = { SNPP: "VIIRS S-NPP", NOAA20: "VIIRS NOAA-20", NOAA21: "VIIRS NOAA-21" };

/** Plain-language description of where a month's numbers come from. */
export function sourceOf(meta: GridMeta, current: CurrentMeta | null, m: number, i: I18n): string {
  if (m < meta.months.viirs_start_index) return i.t.srcTranslated;
  if (m < meta.months.count) return i.t.srcObserved;
  const p = current?.month_products?.[String(m)] ?? {};
  const several = Object.keys(p).length > 1;
  const names = Object.entries(p).sort((a, b) => b[1] - a[1]).map(([k, d]) => {
    const [, sat, kind] = k.split("_");
    return `${SATS[sat] ?? sat}${kind === "NRT" ? ` (${i.t.nrt})` : ""}${several ? ` · ${d} ${i.t.days}` : ""}`;
  });
  return names.length ? names.join(" + ") : "VIIRS";
}

export function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
