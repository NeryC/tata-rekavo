import * as H from "@core";
import type { ContextFile, CurrentMeta, DepartmentDef, Grid, GridMeta } from "@core";
import { validateContext, validateIndigenous } from "./contextCheck";
import { biomePresets } from "./regions";
import type { I18n } from "./i18n";
import type { SeasonFile } from "./season";
import { liveFileUrl, storeBase, validManifest, type LiveManifest } from "./liveData";
import { newerSummary, validSummary, type SummaryFile } from "./highlights";
import { provenance } from "./hotspotTime";

export interface Hotspot {
  lon: number; lat: number; date: string; m: number; frp: number; cell: number;
  /** no hotspot from any sensor within ~1 km (same or neighbouring 0.01-degree cell), Jul 2002 - Dec 2025 */
  fresh: boolean;
  /** row in the unified hotspot CSV format (HOTSPOT_HEADER) */
  csv: string;
  /** acquisition instant (UTC), satellite, instrument, confidence and product; null when unknown */
  at: string | null; satellite: string | null; instrument: string | null; confidence: string | null; product: string | null;
}

export const HOTSPOT_HEADER = "latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,daynight,product,harmonized_weight,new_place";
/** currentJson: the raw current.json, kept so the FRP grid can be decoded later with the same months.
 *  hasBurnHistory: burn_history.json loaded ("fire in new places" is only offered then).
 *  regionCells: cells of each factor region of a biome country (regions.json), null for Paraguay (river split from meta) or when missing. */
export interface AppData {
  grid: Grid; current: CurrentMeta | null; currentJson: unknown; hotspots: Hotspot[]; historyPeriod: string;
  hasBurnHistory: boolean; regionCells: RegionCells | null;
}

/** A file of the site; `path` is the country's folder ("" for Paraguay, the site root; "BOL/" for Bolivia). */
export const url = (f: string, path = "") => `${import.meta.env.BASE_URL}${path}${f}`;

// ---------------------------------------------------------------- countries
export interface CountryInfo {
  iso3: string;
  /** folder of the country's data under the site root: "" (Paraguay) or "BOL/" */
  path: string;
  /** id of the whole-country series / zone ("paraguay", "bolivia") */
  area: string;
  name: { en: string; es: string };
  bbox: [number, number, number, number];
  tz?: string;
  tzCity?: string;
  /** example point [lat, lon] of the coordinates form */
  example?: [number, number];
  /** country median error above the 15 % gate: the selector tags it as a pilot */
  pilot?: boolean;
  /** optional files the country ships (from the index); a missing entry means "unknown: try it" */
  files?: { burnHistory: boolean; hotspotArchive: boolean; context: boolean; indigenous: boolean };
}
export interface CountriesIndex { default: string; countries: CountryInfo[] }

/** Paraguay as the app knew it before the countries index: used when countries.json is missing or broken. */
export const PARAGUAY: CountryInfo = {
  iso3: "PRY", path: "", area: "paraguay", name: { en: "Paraguay", es: "Paraguay" }, bbox: [-62.8, -27.7, -54.1, -19.1],
  tz: "America/Asuncion", tzCity: "Asunción", example: [-22.35, -60.03],
};

const isBBox = (b: unknown): b is [number, number, number, number] =>
  Array.isArray(b) && b.length === 4 && b.every((x) => typeof x === "number" && Number.isFinite(x)) && b[0] < b[2] && b[1] < b[3];
const isCountry = (c: CountryInfo) => !!c && typeof c.iso3 === "string" && /^[A-Z]{3}$/.test(c.iso3) && typeof c.path === "string"
  && /^([A-Z]{3}\/)?$/.test(c.path) && typeof c.area === "string" && !!c.area && typeof c.name?.en === "string"
  && typeof c.name?.es === "string" && isBBox(c.bbox);

let countriesPromise: Promise<CountriesIndex | null> | null = null;
/** countries.json (the index of the countries the site has), fetched once. Null when missing or malformed: Paraguay only. */
export function loadCountries(): Promise<CountriesIndex | null> {
  countriesPromise ??= fetch(url("countries.json"))
    .then((r) => (r.ok ? r.json() : null))
    .then((j): CountriesIndex | null => {
      if (!j || !Array.isArray(j.countries)) return null;
      const countries = (j.countries as CountryInfo[]).filter(isCountry);
      return countries.some((c) => c.iso3 === "PRY") ? { default: typeof j.default === "string" ? j.default : "PRY", countries } : null;
    })
    .catch(() => null);
  return countriesPromise;
}

/** One promise per key: each file is fetched once per country. */
function once<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) { p = make(); cache.set(key, p); }
  return p;
}
const getJson = (f: string, path: string) => fetch(url(f, path)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const getUrlJson = (u: string, init?: RequestInit) => fetch(u, init).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// ---------------------------------------------------------------- live data store (see liveData.ts)
let liveStore: Promise<{ base: string; manifest: LiveManifest } | null> | null = null;
/** live.json + the store's latest.json, fetched once per page; null when there is no store or it does not answer. */
function loadLiveStore() {
  return (liveStore ??= getJson("live.json", "").then(async (cfg) => {
    const base = storeBase(cfg);
    if (!base) return null;
    const manifest = validManifest(await getUrlJson(base + "latest.json", { cache: "no-cache" }));
    return manifest ? { base, manifest } : null;
  }));
}

let summaryCache: Promise<SummaryFile | null> | null = null;
/** Every country's latest verdict (summary.json, ~1 kB): the live store's run when it is newer than the site's own file. */
export function loadSummary(): Promise<SummaryFile | null> {
  return (summaryCache ??= Promise.all([
    getJson("summary.json", "").then(validSummary),
    loadLiveStore().then((live) => (live ? getUrlJson(`${live.base}${live.manifest.prefix}summary.json`).then(validSummary) : null)),
  ]).then(([own, live]) => newerSummary(own, live)));
}

const generatedOf = (j: unknown) => {
  const g = (j as { meta?: { generated?: unknown } } | null)?.meta?.generated;
  const t = typeof g === "string" ? Date.parse(g) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/** current.json and the hotspot CSV URL of a country, from the live store when it has a newer run than the site's
 *  own files, else from the site. Both files always come from the same source, so they describe the same days. */
async function currentSource(path: string, iso3: string | undefined): Promise<{ currentJson: unknown; hotspotsUrl: string }> {
  const bundled = { hotspotsUrl: url("current_hotspots.csv", path) };
  const [own, live] = await Promise.all([getJson("current.json", path), iso3 ? loadLiveStore() : Promise.resolve(null)]);
  const liveUrl = live ? liveFileUrl(live.base, live.manifest, iso3!, "current.json") : null;
  const liveJson = liveUrl ? await getUrlJson(liveUrl) : null;
  if (liveJson && (liveJson as { meta?: unknown }).meta && generatedOf(liveJson) > generatedOf(own)) {
    return { currentJson: liveJson, hotspotsUrl: liveFileUrl(live!.base, live!.manifest, iso3!, "current_hotspots.csv")! };
  }
  return { currentJson: own, ...bundled };
}

// ---------------------------------------------------------------- factor regions
export interface RegionCells { meta?: { kind?: string; source?: string; note?: string }; regions: { id: string; label?: string; cells: number[] }[] }

function validRegionCells(j: unknown): RegionCells | null {
  const r = j as RegionCells | null;
  return r && Array.isArray(r.regions) && r.regions.length > 0
    && r.regions.every((x) => x && typeof x.id === "string" && Array.isArray(x.cells)) ? r : null;
}

/**
 * The region presets of a country and the region of each cell. Paraguay: Chaco / Oriental from the river polyline in
 * meta.regions. Biome countries: from regions.json, in the order of meta.regions.names. No regions when neither is available.
 */
export function regionPresets(meta: GridMeta, cellIds: Iterable<number>, regionCells: RegionCells | null): { ids: string[]; of: Map<number, string> } {
  const of = new Map<number, string>();
  const r = meta.regions;
  if (r && Array.isArray(r.river_lat) && Array.isArray(r.river_lon)) {
    for (const idx of cellIds) of.set(idx, regionOfCell(meta, idx));
    return { ids: ["chaco", "oriental"], of };
  }
  if (!regionCells) return { ids: [], of };
  return biomePresets(Array.isArray(r?.names) ? r.names : undefined, regionCells);
}

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

export interface Department extends DepartmentDef {
  bbox: [number, number, number, number]; // [w, s, e, n]
  geometry: GeoJSON.MultiPolygon;
}
export interface DepartmentsFile {
  meta: { source: string; license: string; url: string; retrieved: string; note: string };
  departments: Department[];
}

const departmentsCache = new Map<string, Promise<DepartmentsFile | null>>();
/** departments.json of a country, fetched once. Resolves to null when it is missing or malformed: the app works without it. */
export function loadDepartments(path = ""): Promise<DepartmentsFile | null> {
  return once(departmentsCache, path, () => fetch(url("departments.json", path))
    .then((r) => (r.ok ? r.json() : null))
    .then((j): DepartmentsFile | null => {
      const ok = j && Array.isArray(j.departments) && j.departments.length > 0
        && j.departments.every((d: Department) => d && typeof d.id === "string" && Array.isArray(d.cells) && Array.isArray(d.bbox) && d.geometry);
      return ok ? (j as DepartmentsFile) : null;
    })
    .catch(() => null));
}

const seasonCache = new Map<string, Promise<SeasonFile | null>>();
/** season.json (daily cumulative climatology), fetched once. Resolves to null when it is missing or malformed: the season chart is hidden. */
export function loadSeason(path = ""): Promise<SeasonFile | null> {
  return once(seasonCache, path, () => fetch(url("season.json", path))
    .then((r) => (r.ok ? r.json() : null))
    .then((j): SeasonFile | null => (j && typeof j.areas === "object" && j.areas !== null && !Array.isArray(j.areas) ? (j as SeasonFile) : null))
    .catch(() => null));
}

const contextCache = new Map<string, Promise<ContextFile | null>>();
/**
 * context.json (fire statistics per protected area, WDPA; no geometry), fetched once.
 * Resolves to null when it is missing or malformed: the protected-areas block is then hidden and the rest of the app is unaffected.
 */
export function loadContext(path = ""): Promise<ContextFile | null> {
  return once(contextCache, path, () => fetch(url("context.json", path))
    .then((r) => (r.ok ? r.json() : null))
    .then(validateContext)
    .catch(() => null));
}

const indigenousCache = new Map<string, Promise<ContextFile | null>>();
/**
 * indigenous.json (fire statistics per indigenous territory, LandMark, CC BY-SA 4.0; no geometry), fetched once.
 * Resolves to null when it is missing or malformed: the indigenous-territories block is then hidden and the rest of the app is unaffected.
 */
export function loadIndigenous(path = ""): Promise<ContextFile | null> {
  return once(indigenousCache, path, () => fetch(url("indigenous.json", path))
    .then((r) => (r.ok ? r.json() : null))
    .then(validateIndigenous)
    .catch(() => null));
}

const frpCache = new Map<string, Promise<unknown | null>>();
/**
 * frp.json (harmonized fire power, 2.4 MB), fetched once and only when the user switches to FRP.
 * Resolves to null when it is missing or malformed: the FRP option is then disabled and the app keeps working.
 * The result, including a failure, is cached: after a failure the app disables the option until the page is reloaded.
 */
export function loadFrp(path = ""): Promise<unknown | null> {
  return once(frpCache, path, () => fetch(url("frp.json", path))
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.meta && j.meta.months && Array.isArray(j.cells) && j.meta.error_model ? j : null))
    .catch(() => null));
}

/** The hotspots of the daily files and what the burn history adds to them: loaded after the first screen. */
export interface HotspotExtras { hotspots: Hotspot[]; historyPeriod: string; hasBurnHistory: boolean }

/**
 * What the first screen of a country needs (grid.json, current.json and, for biome countries, regions.json), and a
 * second stage with the individual hotspots and the burn history. The verdict can show as soon as `data` resolves;
 * the map points, "fire in new places" and the season curve fill in when `extras` resolves (`data` has none until then).
 * Only grid.json is required; the other files are optional.
 */
export async function loadData(path = "", iso3?: string, files?: CountryInfo["files"]): Promise<{ data: AppData; extras: Promise<HotspotExtras> }> {
  // starts now, awaited in stage 2; never asked for when the index says the country has none
  const burnLoad = (files?.burnHistory === false ? Promise.resolve(null) : getJson("burn_history.json", path)) as Promise<BurnHistory | null>;
  const [gridJson, { currentJson, hotspotsUrl }] = await Promise.all([
    fetch(url("grid.json", path)).then((r) => r.json()),
    currentSource(path, iso3),
  ]);
  const grid = H.decodeGrid(gridJson, currentJson);
  // biome countries: which grid cells make each region preset (Paraguay's river split needs no file)
  const regionCells = grid.meta.regions?.kind === "biome" ? validRegionCells(await getJson("regions.json", path)) : null;
  const data: AppData = { grid, current: currentJson ? (currentJson as { meta: CurrentMeta }).meta : null, currentJson, hotspots: [],
    historyPeriod: "", hasBurnHistory: false, regionCells };
  return { data, extras: loadHotspots(grid, hotspotsUrl, burnLoad) };
}

async function loadHotspots(grid: Grid, hotspotsUrl: string, burnLoad: Promise<BurnHistory | null>): Promise<HotspotExtras> {
  const [burnJson, txt] = await Promise.all([burnLoad, fetch(hotspotsUrl).then((r) => (r.ok ? r.text() : "")).catch(() => "")]);
  const hasBurnHistory = !!burnJson && typeof burnJson.last_year_minus_2000_b64 === "string";
  const isFresh = burnJson && hasBurnHistory ? makeFreshTest(burnJson) : () => false;
  let hotspots: Hotspot[] = [];
  try {
    const lines = txt.trim().split("\n");
    const cols = lines[0].split(",");
    const col = (n: string) => cols.indexOf(n);
    const iLat = col("latitude"), iLon = col("longitude"), iDate = col("acq_date"), iFrp = col("frp");
    const keep = ["acq_time", "satellite", "instrument", "confidence", "frp", "daynight", "product"].map(col);
    if (iLat >= 0 && iLon >= 0 && iDate >= 0) hotspots = lines.slice(1).map((line) => {
      const f = line.split(",");
      const lat = +f[iLat], lon = +f[iLon], date = f[iDate];
      const [y, mo] = date.split("-").map(Number);
      const fresh = isFresh(lon, lat);
      const [time, ...rest] = keep.map((k) => (k >= 0 ? f[k] ?? "" : ""));
      const csv = [f[iLat], f[iLon], date, time.padStart(4, "0"), ...rest, "1", fresh ? "1" : "0"].join(",");
      return { lat, lon, date, frp: +f[iFrp], m: H.indexOf(grid.meta, y, mo), cell: H.cellAt(grid.meta, lon, lat), fresh, csv, ...provenance(cols, f) };
    });
  } catch { /* hotspots are optional */ }
  return { hotspots, historyPeriod: burnJson?.period ?? "", hasBurnHistory };
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

/** Approximate area of a set of grid cells in km2. */
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
    const extra = [kind === "NRT" ? i.t.nrt : "", several ? `${d} ${i.t.days}` : ""].filter(Boolean).join(", ");
    return `${SATS[sat] ?? sat}${extra ? ` (${extra})` : ""}`;
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

// ---------------------------------------------------------------- historical hotspots (1-degree gzip blocks)
interface HotspotIndex { blocks: Record<string, { rows: number; first: string; last: string }> }
const indexCache = new Map<string, Promise<HotspotIndex | null>>();
/** hotspots/index.json of a country; null when it has no archived hotspot blocks (the download is then not offered). */
export function hotspotIndex(path = ""): Promise<HotspotIndex | null> {
  return once(indexCache, path, () => fetch(url("hotspots/index.json", path)).then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && typeof j.blocks === "object" && j.blocks !== null ? (j as HotspotIndex) : null)).catch(() => null));
}

const blockOfCell = (meta: GridMeta, idx: number) => {
  const [lon, lat] = H.cellCenter(meta, idx);
  return `${Math.floor(lat)}_${Math.floor(lon)}`;
};

/** Archived hotspots a search would return: MODIS (Terra+Aqua) + S-NPP counts per cell-month from the grid,
 *  plus NOAA-20 (about as many as S-NPP) from April 2018. */
export function estimateHistoricalRows(grid: Grid, zone: number[], from: number, to: number) {
  const meta = grid.meta;
  const end = Math.min(to, meta.months.count - 1), n20 = H.indexOf(meta, 2018, 4);
  let rows = 0;
  for (const idx of zone) {
    const c = grid.cells.get(idx);
    if (!c) continue;
    for (let k = 0; k < c.m.length; k++) {
      const m = c.m[k];
      if (m < from || m > end) continue;
      rows += c.modis[k] + c.viirs[k] * (m >= n20 ? 2 : 1);
    }
  }
  return rows;
}

async function gunzipText(res: Response) {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) { // still gzipped (served as a plain file)
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(buf); // the server already decompressed it
}

/** Archived hotspots (Jul 2002 - Dec 2025) inside the zone cells and month range, as unified CSV rows. */
export async function historicalHotspotRows(meta: GridMeta, zone: Set<number>, from: number, to: number,
  onProgress: (done: number, total: number) => void, path = ""): Promise<string[]> {
  const index = await hotspotIndex(path);
  if (!index) return [];
  const blocks = [...new Set([...zone].map((i) => blockOfCell(meta, i)))].filter((b) => index.blocks[b]);
  const out: string[] = [];
  let done = 0;
  onProgress(0, blocks.length);
  for (const b of blocks) {
    const res = await fetch(url(`hotspots/${b}.csv.gz`, path));
    if (!res.ok) throw new Error(`${b}: HTTP ${res.status}`);
    const lines = (await gunzipText(res)).split("\n");
    for (let k = 1; k < lines.length; k++) {
      const line = lines[k];
      if (!line) continue;
      const c1 = line.indexOf(","), c2 = line.indexOf(",", c1 + 1);
      const lat = +line.slice(0, c1), lon = +line.slice(c1 + 1, c2);
      const y = +line.slice(c2 + 1, c2 + 5), mo = +line.slice(c2 + 6, c2 + 8);
      const m = H.indexOf(meta, y, mo);
      if (m < from || m > to || !zone.has(H.cellAt(meta, lon, lat))) continue;
      out.push(line + ",");
    }
    onProgress(++done, blocks.length);
  }
  return out;
}

/** Circle polygon (lon/lat ring) around a point, radius in km. */
export function circleRing(lat: number, lon: number, km: number, n = 48): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push([lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 111.32) * Math.sin(a)]);
  }
  return ring;
}

export function downloadParts(name: string, parts: string[]) {
  const blob = new Blob(parts, { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
