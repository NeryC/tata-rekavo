import * as H from "@core";
import type { CurrentMeta, Grid, GridMeta } from "@core";

export interface Hotspot { lon: number; lat: number; date: string; m: number; frp: number; cell: number; raw: string }
export interface AppData { grid: Grid; current: CurrentMeta | null; hotspotsHeader: string; hotspots: Hotspot[] }

const url = (f: string) => `${import.meta.env.BASE_URL}${f}`;

export async function loadData(): Promise<AppData> {
  const [gridJson, currentJson] = await Promise.all([
    fetch(url("grid.json")).then((r) => r.json()),
    fetch(url("current.json")).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const grid = H.decodeGrid(gridJson, currentJson);
  let hotspotsHeader = "";
  let hotspots: Hotspot[] = [];
  try {
    const txt = await fetch(url("current_hotspots.csv")).then((r) => (r.ok ? r.text() : ""));
    const lines = txt.trim().split("\n");
    hotspotsHeader = lines[0];
    const cols = hotspotsHeader.split(",");
    const iLat = cols.indexOf("latitude"), iLon = cols.indexOf("longitude"), iDate = cols.indexOf("acq_date"), iFrp = cols.indexOf("frp");
    hotspots = lines.slice(1).map((line) => {
      const f = line.split(",");
      const lat = +f[iLat], lon = +f[iLon], date = f[iDate];
      const [y, mo] = date.split("-").map(Number);
      return { lat, lon, date, frp: +f[iFrp], m: H.indexOf(grid.meta, y, mo), cell: H.cellAt(grid.meta, lon, lat), raw: line };
    });
  } catch { /* hotspots are optional */ }
  return { grid, current: currentJson ? currentJson.meta : null, hotspotsHeader, hotspots };
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

const PRODUCT_NAMES: Record<string, string> = {
  VIIRS_SNPP_SP: "VIIRS S-NPP", VIIRS_SNPP_NRT: "VIIRS S-NPP (near real-time)",
  VIIRS_NOAA20_SP: "VIIRS NOAA-20", VIIRS_NOAA20_NRT: "VIIRS NOAA-20 (near real-time)",
  VIIRS_NOAA21_SP: "VIIRS NOAA-21", VIIRS_NOAA21_NRT: "VIIRS NOAA-21 (near real-time)",
};

/** Plain-language description of where a month's numbers come from. */
export function sourceOf(meta: GridMeta, current: CurrentMeta | null, m: number): { label: string; translated: boolean } {
  if (m < meta.months.viirs_start_index) return { label: "MODIS Aqua, translated to VIIRS-equivalent", translated: true };
  if (m < meta.months.count) return { label: "VIIRS S-NPP observed (outage days filled with NOAA-20)", translated: false };
  const p = current?.month_products?.[String(m)] ?? {};
  const names = Object.entries(p).sort((a, b) => b[1] - a[1]).map(([k, d]) => `${PRODUCT_NAMES[k] ?? k}${Object.keys(p).length > 1 ? ` (${d} d)` : ""}`);
  return { label: names.length ? names.join(" + ") : "VIIRS", translated: false };
}

export function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
