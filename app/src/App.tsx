import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as H from "@core";
import Calendar, { type CalMode } from "./Calendar";
import YearChart from "./YearChart";
import SeasonChart from "./SeasonChart";
import ValidationPanel from "./ValidationPanel";
import DepartmentRanking from "./DepartmentRanking";
import ProtectedAreas from "./ProtectedAreas";
import { isContextStale } from "./contextCheck";
import { rangeAnalytics } from "./analytics";
import { downloadReport } from "./report";
import { formatUpdated, isStale } from "./format";
import {
  areaKm2, bboxOfCells, circleRing, download, downloadParts, estimateHistoricalRows, historicalHotspotRows, hotspotIndex,
  HOTSPOT_HEADER, loadContext, loadCountries, loadData, loadDepartments, loadFrp, loadSeason, PARAGUAY, regionPresets, sourceOf,
  type AppData, type CountryInfo, type DepartmentsFile,
} from "./data";
import { countryOf, decodeState, encodeState, validateCoords, type ShareState } from "./urlState";
import { indexToMonth, planRestore } from "./shareRestore";
import type { ContextFile, Grid } from "@core";
import type { SeasonFile } from "./season";
import { I18nContext, initialLang, makeI18n, saveLang, type Lang, type Metric } from "./i18n";

// the map (MapLibre, most of the JavaScript) is a separate chunk: the panel and its verdict render while it downloads
const MapView = lazy(() => import("./MapView"));

/** the country's own area id ("paraguay", "bolivia"), one of its region presets ("chaco", a biome id), "custom" or "department" */
type ZoneKind = string;
const CLASS_STYLE: Record<string, { icon: string }> = {
  low: { icon: "↓" }, normal: { icon: "≈" }, high: { icon: "↑" }, extreme: { icon: "▲" },
};
const REPO = "https://github.com/NeryC/tata-rekavo";
const GEOBOUNDARIES = "https://www.geoboundaries.org/";
const GEOBOUNDARIES_RETRIEVED = "2026-11-14"; // shown when departments.json did not load
const WDPA_URL = "https://www.protectedplanet.net/country/PRY";
const MAX_ROWS = 1_500_000;
// a typical month under 100 MW is too little fire to rank by ratio (counts use 10 hotspots, MW run about ten times higher)
const FRP_LOW_SIGNAL_MEDIAN = 100;

/**
 * The country comes from the link (`country=BOL`); a link without it is Paraguay, exactly as before. Paraguay starts at once;
 * another country waits for the countries index (countries.json) and falls back to Paraguay when the index is missing or does
 * not list it. Switching country remounts the country view, so every per-country state starts fresh.
 */
export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const wanted = useMemo(() => countryOf(window.location.search), []);
  const [countries, setCountries] = useState<CountryInfo[] | null>(null); // null until loaded, or when it failed: no selector
  const [country, setCountry] = useState<CountryInfo | null>(wanted === PARAGUAY.iso3 ? PARAGUAY : null);
  useEffect(() => {
    void loadCountries().then((idx) => {
      const list = idx?.countries ?? null;
      setCountries(list);
      setCountry((c) => c ?? list?.find((x) => x.iso3 === wanted) ?? PARAGUAY);
    });
  }, [wanted]);
  const switchCountry = (next: CountryInfo, month: string | null) => {
    // the new country starts on its whole area, keeping the language and the month (the view checks it against its data)
    const s: ShareState = { lang, country: next.iso3 };
    if (month) s.m = month;
    try { window.history.replaceState(null, "", `?${encodeState(s)}`); } catch { /* sandboxed */ }
    setCountry(next);
  };
  if (!country) {
    const t = makeI18n(lang).t;
    return <div className="app"><div className="splash">{t.loading}</div></div>;
  }
  return <CountryView key={country.iso3} country={country} countries={countries} lang={lang} setLang={setLang} onCountry={switchCountry} />;
}

interface ViewProps {
  country: CountryInfo;
  /** every country of the index (the selector is shown when there are two or more), null without the index */
  countries: CountryInfo[] | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  /** switch country; month: the selected month as "YYYY-MM", null for the latest */
  onCountry: (c: CountryInfo, month: string | null) => void;
}

function CountryView({ country, countries, lang, setLang, onCountry }: ViewProps) {
  const path = country.path;
  const countryName = country.name[lang];
  // what the numbers mean: hotspot counts or harmonized fire power (MW). `metric` is what was asked for; `active`
  // only switches once frp.json has loaded (it is fetched lazily, on the first switch).
  const [metric, setMetric] = useState<Metric>("count");
  const [frpGrid, setFrpGrid] = useState<Grid | null>(null);
  const frpRequested = useRef(false); // frp.json is requested once; the promise is cached in loadFrp
  const [frpFailed, setFrpFailed] = useState(false);
  const active: Metric = metric === "frp" && frpGrid ? "frp" : "count";
  const i18n = useMemo(() => makeI18n(lang, active), [lang, active]);
  const { t, num } = i18n;
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoneKind, setZoneKind] = useState<ZoneKind>(country.area);
  const [departments, setDepartments] = useState<DepartmentsFile | null>(null); // null until loaded, or when it failed
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [season, setSeason] = useState<SeasonFile | null>(null); // null until loaded, or when it failed: the chart stays hidden
  const [context, setContext] = useState<ContextFile | null>(null); // protected-area statistics; null until loaded, or when it failed: the block stays hidden
  const [polygon, setPolygon] = useState<number[][] | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number; r: number } | null>(null);
  const [coordsOpen, setCoordsOpen] = useState(false);
  const example = country.example ?? [Math.round(((country.bbox[1] + country.bbox[3]) / 2) * 100) / 100, Math.round(((country.bbox[0] + country.bbox[2]) / 2) * 100) / 100];
  const [coordsForm, setCoordsForm] = useState({ lat: String(example[0]), lon: String(example[1]), r: "25" });
  const [coordsError, setCoordsError] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [month, setMonth] = useState<number>(-1);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [naive, setNaive] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [calMode, setCalMode] = useState<CalMode>("ratio");
  const [busy, setBusy] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  // archived hotspot blocks (hotspots/index.json): null while loading; false when the country has none (no full download)
  const [hasArchive, setHasArchive] = useState<boolean | null>(null);
  const [viewNonce, setViewNonce] = useState(0);
  const [mapMoved, setMapMoved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hotspotsReady, setHotspotsReady] = useState(false); // individual hotspots and burn history loaded (second stage)
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const depsLoad = loadDepartments(path); // lazy and optional: starts with the grid, never blocks it
    void depsLoad.then(setDepartments);
    void loadSeason(path).then(setSeason);
    void loadContext(path).then(setContext);
    let alive = true;
    loadData(path, country.iso3).then(async ({ data: d, extras }) => {
      // a shared department link has to wait for departments.json, or it would restore as the whole country
      const link = decodeState(window.location.search, (iso3) => (iso3 === country.iso3 ? country.bbox : undefined));
      const deps = link.zone === "department" ? await depsLoad : null;
      const last = d.grid.nMonths - 1;
      const { year } = H.monthOf(d.grid.meta, last);
      const defRange: [number, number] = [Math.max(0, H.indexOf(d.grid.meta, year, 1)), last];
      // restore a shared link only here, once the grid is known, so months can be clamped to the data
      const regions = regionPresets(d.grid.meta, [], d.regionCells).ids;
      const r = planRestore(d.grid.meta.months.first, d.grid.nMonths, link, defRange, deps ? deps.departments.map((x) => x.id) : null,
        { area: country.area, regions, bbox: country.bbox });
      setZoneKind(r.zone);
      setDepartmentId(r.dep);
      setCoords(r.coords);
      if (r.coords) {
        setPolygon(circleRing(r.coords.lat, r.coords.lon, r.coords.r));
        setCoordsForm({ lat: String(r.coords.lat), lon: String(r.coords.lon), r: String(r.coords.r) });
      } else setPolygon(r.poly);
      setMonth(r.month);
      setRange(r.range);
      setCalMode(r.cal); setNaive(r.naive); setMetric(r.metric);
      if (!alive) return;
      setData(d);
      // second stage: hotspots and burn history arrive after the verdict is on screen
      const x = await extras;
      if (!alive) return;
      setData((cur) => (cur && cur.grid === d.grid ? { ...cur, ...x } : cur));
      setHotspotsReady(true);
      if (r.newOnly && x.hasBurnHistory) setNewOnly(true);
    }).catch((e) => setError(String(e)));
    return () => { alive = false; };
  }, [path, country]);
  useEffect(() => { document.documentElement.lang = lang; document.title = `Tata Rekavo · ${t.title}`; saveLang(lang); }, [lang, t]);

  // frp.json is 2.4 MB: only fetched once the reader asks for fire power
  useEffect(() => {
    if (metric !== "frp" || !data || frpRequested.current) return;
    frpRequested.current = true;
    // no cancellation: if the reader goes back to Hotspots before it arrives, the grid is still kept for the next switch
    void loadFrp(path).then((j) => {
      try {
        if (!j) throw new Error("frp.json unavailable");
        setFrpGrid(H.decodeFrp(j, data.currentJson, data.grid.meta));
      } catch { setFrpFailed(true); setMetric("count"); }
    });
  }, [metric, data, path]);
  const frpLoading = metric === "frp" && !frpGrid && !frpFailed; // derived: cannot get stuck

  // countGrid fixes the geography (cells, areas, hotspot downloads); grid is the one the active measure reads
  const countGrid = data?.grid;
  const grid = active === "frp" && frpGrid ? frpGrid : countGrid;
  // region presets of the country (Paraguay: Chaco / Oriental; biome countries: regions.json) and the region of each cell
  const regions = useMemo(() => (countGrid ? regionPresets(countGrid.meta, countGrid.cells.keys(), data?.regionCells ?? null)
    : { ids: [] as string[], of: new Map<number, string>() }), [countGrid, data]);
  const regionOf = regions.of;
  const presetIds = useMemo(() => [country.area, ...regions.ids], [country.area, regions]);
  // display names: the country, Paraguay's regions and the biomes from i18n; otherwise the label in the data, or the id
  const metaLabels = (countGrid?.meta.regions?.labels ?? {}) as Record<string, string>;
  // a biome can read differently per country ("ISO3:biome-id" keys win over the shared "biome-id" ones)
  const zoneName = (id: string) => (id === country.area ? countryName : i18n.t.zones[`${country.iso3}:${id}`] ?? i18n.t.zones[id] ?? metaLabels[id] ?? id);
  const zoneIn = (id: string) => (id === country.area ? countryName : i18n.t.zoneIn[`${country.iso3}:${id}`] ?? i18n.t.zoneIn[id] ?? zoneName(id));

  const department = useMemo(
    () => (zoneKind === "department" && departmentId ? departments?.departments.find((d) => d.id === departmentId) ?? null : null),
    [zoneKind, departmentId, departments]);

  const zoneCells = useMemo(() => {
    if (!countGrid) return [];
    if (zoneKind === "department" && department) return department.cells;
    if (zoneKind === "custom" && polygon) return H.cellsInPolygon(countGrid, polygon);
    if (regions.ids.includes(zoneKind)) return [...countGrid.cells.keys()].filter((i) => regionOf.get(i) === zoneKind);
    return [...countGrid.cells.keys()];
  }, [countGrid, zoneKind, department, polygon, regionOf, regions]);
  const zoneSet = useMemo(() => new Set(zoneCells), [zoneCells]);
  const zoneBBox = useMemo(() => (department ? department.bbox : countGrid && zoneCells.length ? bboxOfCells(countGrid.meta, zoneCells) : country.bbox), [countGrid, zoneCells, department, country.bbox]);
  // what the map outlines: the department boundary or the hand-made polygon
  const outline = useMemo<GeoJSON.Geometry | null>(() => (department ? department.geometry
    : zoneKind === "custom" && polygon ? { type: "LineString", coordinates: polygon } : null), [department, zoneKind, polygon]);
  const series = useMemo(() => (grid ? H.zoneSeries(grid, zoneCells) : null), [grid, zoneCells]);
  useEffect(() => { setMapMoved(false); }, [zoneBBox]);
  const coverage = useMemo(() => (m: number) => (grid ? H.monthCoverage(grid.meta, m, data?.current ?? null) : 1), [grid, data]);

  const monthValues = useMemo(() => {
    const out = new Map<number, number>();
    if (!grid || month < 0 || grid.noData?.has(month)) return out;
    for (const [idx, c] of grid.cells) {
      const k = c.m.indexOf(month);
      if (k >= 0 && c.h[k] > 0) out.set(idx, c.h[k]);
    }
    return out;
  }, [grid, month]);
  const monthHotspots = useMemo(() => (data ? data.hotspots.filter((h) => h.m === month) : []), [data, month]);
  const zoneMonthHotspots = useMemo(() => monthHotspots.filter((h) => zoneSet.has(h.cell)), [monthHotspots, zoneSet]);
  const ranking = useMemo(
    () => (grid && departments && month >= 0 ? H.departmentRanking(grid, departments.departments, month, coverage(month), active === "frp" ? FRP_LOW_SIGNAL_MEDIAN : undefined) : null),
    [grid, departments, month, coverage, active]);
  const analytics = useMemo(() => (grid && series ? rangeAnalytics(grid, series, coverage, range[0], range[1]) : null), [grid, series, coverage, range]);

  // estimated size of the hotspot download for this area and range
  useEffect(() => {
    if (!countGrid || !data) return;
    let alive = true;
    hotspotIndex(path).then((idx) => { // warm the block index while the user decides
      if (!alive) return;
      setHasArchive(!!idx);
      const hist = estimateHistoricalRows(countGrid, zoneCells, range[0], range[1]);
      const recent = data.hotspots.filter((h) => h.m >= range[0] && h.m <= range[1] && zoneSet.has(h.cell)).length;
      setEstimate(Math.round(hist + recent));
    });
    return () => { alive = false; };
  }, [countGrid, data, zoneCells, zoneSet, range, path]);

  // the state a shared link carries; null until the initial restore has run
  const shareQs = useMemo(() => {
    if (!data) return null;
    const first = data.grid.meta.months.first;
    const lastI = data.grid.nMonths - 1;
    const defStart = Math.max(0, H.indexOf(data.grid.meta, H.monthOf(data.grid.meta, lastI).year, 1));
    const s: ShareState = { lang, country: country.iso3, cal: calMode, naive, newOnly };
    if (metric === "frp") s.metric = "frp";
    if (zoneKind === "custom") {
      if (coords) s.c = coords; else if (polygon) s.poly = polygon;
      if (coords || polygon) s.zone = "custom";
    } else if (zoneKind === "department") {
      if (department) { s.zone = "department"; s.dep = department.id; }
    } else if (zoneKind !== country.area) s.zone = zoneKind;
    if (month >= 0 && month !== lastI) s.m = indexToMonth(first, month);
    if (range[0] !== defStart || range[1] !== lastI) s.range = [indexToMonth(first, range[0]), indexToMonth(first, range[1])];
    return encodeState(s);
  }, [data, lang, country, zoneKind, department, polygon, coords, month, range, calMode, naive, newOnly, metric]);

  useEffect(() => {
    if (shareQs === null) return; // never overwrite the incoming URL before it has been restored
    const id = window.setTimeout(() => {
      try { window.history.replaceState(null, "", shareQs ? `?${shareQs}` : window.location.pathname); } catch { /* sandboxed */ }
    }, 300);
    return () => window.clearTimeout(id);
  }, [shareQs]);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  };
  const copyLink = async () => {
    // build from state, not location.href: the writer is debounced
    const url = `${window.location.origin}${window.location.pathname}${shareQs ? `?${shareQs}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl(null);
      flash(t.linkCopied);
    } catch {
      setManualUrl(url); // http / old iOS: show a selected read-only field to copy by hand
    }
  };

  function resetAll() {
    if (!data) return;
    const lastM = data.grid.nMonths - 1;
    setDrawing(false); setCoordsOpen(false); setCoordsError(false);
    setZoneKind(country.area); setDepartmentId(null); setPolygon(null); setCoords(null);
    setMonth(lastM);
    setRange([Math.max(0, H.indexOf(data.grid.meta, H.monthOf(data.grid.meta, lastM).year, 1)), lastM]);
    setCalMode("ratio"); setNaive(false); setNewOnly(false); setMetric("count"); setDlError(null);
    setViewNonce((n) => n + 1);
    setMapMoved(false);
  }

  // "Reset all" only makes sense once something differs from the starting view
  const lastIdx = data ? data.grid.nMonths - 1 : -1;
  const startRange = data ? [Math.max(0, H.indexOf(data.grid.meta, H.monthOf(data.grid.meta, lastIdx).year, 1)), lastIdx] : [0, 0];
  const changed = !!data && (zoneKind !== country.area || drawing || coordsOpen || month !== lastIdx
    || range[0] !== startRange[0] || range[1] !== startRange[1] || calMode !== "ratio" || naive || newOnly || metric !== "count" || mapMoved);

  const generated = data?.current?.generated;
  const stale = !!generated && isStale(generated, new Date());
  const updatedLine = generated ? (
    <p className={stale ? "updated stale" : "updated"}>
      {t.lastUpdated(formatUpdated(generated, lang, country.tz), country.tzCity ?? "Asunción")}
      {stale && <> · {t.staleData}</>}
    </p>
  ) : null;

  // the country selector: in the nav on wide screens, under the title on phones (where the nav leaves the title no room)
  const countrySelect = (where: "nav" | "brand") => countries && countries.length > 1 && (
    <select className={`country country-${where}`} value={country.iso3} aria-label={t.countryLabel} title={t.countryLabel}
      onChange={(e) => {
        const next = countries.find((c) => c.iso3 === e.target.value);
        if (next && next.iso3 !== country.iso3) onCountry(next, data && month >= 0 && month !== data.grid.nMonths - 1 ? indexToMonth(data.grid.meta.months.first, month) : null);
      }}>
      {countries.map((c) => <option key={c.iso3} value={c.iso3}>{c.pilot ? t.pilotCountry(c.name[lang]) : c.name[lang]}</option>)}
    </select>
  );

  const header = (
    <header className="top">
      <div className="brand">
        <span className="logo" aria-hidden>◉</span>
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle(countryName)}</p>
          {countrySelect("brand")}
          {updatedLine}
        </div>
      </div>
      <nav>
        {countrySelect("nav")}
        <a href={`${REPO}#method`} target="_blank" rel="noreferrer">{t.method}</a>
        <a href={REPO} target="_blank" rel="noreferrer">{t.code}</a>
        <button className="reset-all copy-link" onClick={() => void copyLink()} title={t.copyLinkTitle} aria-label={t.copyLink}>
          <span aria-hidden>🔗</span><span className="lbl">{t.copyLink}</span>
        </button>
        {changed && (
          <button className="reset-all" onClick={() => resetAll()} title={t.resetAllTitle(countryName)} aria-label={t.resetAllTitle(countryName)}>
            <span aria-hidden>↺</span><span className="lbl">{t.resetAll.replace("↺ ", "")}</span>
          </button>
        )}
        <span className="lang" role="group" aria-label={t.langLabel}>
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button>
          <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")} aria-pressed={lang === "es"}>ES</button>
        </span>
      </nav>
      {toast && <div className="toast" role="status">{toast}</div>}
      {manualUrl && (
        <label className="manual-link">{t.linkCopyManual}
          <input readOnly autoFocus value={manualUrl} onFocus={(e) => e.currentTarget.select()} onBlur={() => setManualUrl(null)} />
        </label>
      )}
    </header>
  );

  if (error) return <I18nContext.Provider value={i18n}><div className="app">{header}<div className="splash">{t.loadError} {error}</div></div></I18nContext.Provider>;
  if (!data || !countGrid || !grid || !series || !analytics || month < 0) return <I18nContext.Provider value={i18n}><div className="app">{header}<div className="splash">{t.loading}</div></div></I18nContext.Provider>;

  const meta = grid.meta;
  const last = grid.nMonths - 1;
  const cov = coverage(month);
  const v = H.verdict(grid, series.harmonized, month, cov);
  const cls = CLASS_STYLE[v.class.id];
  // protected areas (context.json, Paraguay only): figures for the country, the regions and the departments, and only up to
  // the month the data reaches
  const protZone = zoneKind === "department" ? department?.id ?? null : zoneKind === "custom" ? null : zoneKind;
  const protThrough = context ? context.meta.through.split("-").map(Number) : null;
  const protThroughIdx = protThrough ? H.indexOf(meta, protThrough[0], protThrough[1]) : -1;
  // the daily workflow refreshes current.json but cannot rebuild context.json: figures of the last month can lag behind the data shown
  const lastHotspotDate = data.hotspots.reduce<string | null>((mx, h) => (mx === null || h.date > mx ? h.date : mx), null);
  const protStale = !!context && month === protThroughIdx && isContextStale(context, lastHotspotDate, data.current?.generated);
  // the last month's figures need the hotspots to tell whether they are stale: wait for the second stage
  const protPending = month === protThroughIdx && !hotspotsReady;
  const protSummary = context && protZone && !v.noData && !protStale && !protPending
    ? H.protectedSummary(context, protZone, month, active, cov, { classes: meta.classes, zoneValue: v.value, lowSignalMedian: active === "frp" ? FRP_LOW_SIGNAL_MEDIAN : 10 }) : null;
  const protNote = !context || v.noData || protPending ? null : zoneKind === "custom" ? "custom" : month > protThroughIdx ? "late" : protStale ? "stale" : null;
  const protTop = protSummary ? protSummary.areas.filter((a) => a.value >= 0.5).slice(0, 3) : [];
  const protPct = protSummary?.share != null ? protSummary.share * 100 : null;
  // a share under 1 % must not round to "0 %" next to a non-zero count
  const protShare = protPct === null ? null : protPct > 0 && protPct < 1 ? "<1" : Math.round(protPct).toLocaleString(lang === "es" ? "es-PY" : "en-US");
  const ml = (m: number) => { const o = H.monthOf(meta, m); return i18n.monthLabel(o.year, o.month); };
  const { year: selYear, month: selMonth } = H.monthOf(meta, month);
  const monthLabel = ml(month);
  const monthLong = i18n.monthLong(selMonth);
  const monthsDesc = Array.from({ length: grid.nMonths }, (_, m) => m).reverse();
  const val = meta.validation?.leave_one_year_out;
  // a country with a single biome has no region rows of its own: that row would repeat the country's
  const valRows = H.validationSummary(meta, country.area).rows.filter((r) => r.area === "country" || regions.ids.includes(r.area));
  const frpOn = active === "frp";
  const experimental = frpOn && meta.experimental === true; // from the data, never inferred from meta.name
  const lastPartial = coverage(last) < 1;
  const small = zoneCells.length < 40;
  const nNew = zoneMonthHotspots.filter((h) => h.fresh).length;
  const pctNew = zoneMonthHotspots.length ? (100 * nNew) / zoneMonthHotspots.length : 0;
  const zoneLabel = zoneKind === "custom" && coords
    ? t.zoneCoords(coords.lat.toFixed(2), coords.lon.toFixed(2), String(coords.r))
    : zoneKind === "department" ? t.zoneDept(department?.name ?? "") : zoneIn(zoneKind);
  const rangeLabel = `${ml(range[0])} – ${ml(range[1])}`;
  const rangeNew = data.hotspots.filter((h) => h.fresh && h.m >= range[0] && h.m <= range[1] && zoneSet.has(h.cell)).length;
  const lastYear = H.monthOf(meta, last).year;
  const seasonYear = H.indexOf(meta, lastYear, 10) <= last ? lastYear : lastYear - 1;
  const presets: Record<string, [number, number]> = {
    year: [Math.max(0, H.indexOf(meta, lastYear, 1)), last],
    last12: [Math.max(0, last - 11), last],
    season: [H.indexOf(meta, seasonYear, 7), H.indexOf(meta, seasonYear, 10)],
    all: [0, last],
  };
  const tooMany = (estimate ?? 0) > MAX_ROWS;
  const tag = (m: number) => { const o = H.monthOf(meta, m); return `${o.year}-${String(o.month).padStart(2, "0")}`; };
  const fileTag = `${zoneKind === "department" && department ? department.id : zoneKind}_${tag(range[0])}_${tag(range[1])}`;
  const metricTag = frpOn ? "frp_" : ""; // the monthly CSV and the report say which measure they hold
  const rangeEmpty = analytics.months === 0 && analytics.noData > 0; // every month in the range lacks data: no total to show
  const analyticsLines = rangeEmpty ? [t.rangeNoData(analytics.noData)] : [
    t.rangeVsTypical(i18n.ratio(analytics.ratio), num(analytics.typical)),
    ...(analytics.peak.m >= 0 ? [t.rangePeak(ml(analytics.peak.m), num(analytics.peak.v))] : []),
    t.rangeMonths(analytics.above, analytics.below, analytics.months),
    ...(rangeNew ? [t.rangeNew(num(rangeNew))] : []),
    ...(analytics.noData ? [t.rangeNoData(analytics.noData)] : []),
  ];

  const pickZone = (k: ZoneKind) => { setDrawing(false); setCoordsOpen(false); setZoneKind(k); setDepartmentId(null); if (k !== "custom") { setPolygon(null); setCoords(null); } };
  const pickDepartment = (id: string | null) => {
    if (!id) { pickZone(country.area); return; }
    setDrawing(false); setCoordsOpen(false); setPolygon(null); setCoords(null);
    setDepartmentId(id); setZoneKind("department");
    // stacked phone layout: the answer sits above the list, so bring it to the top of the screen.
    // desktop: it sits beside the map, so only scroll when its top is outside the viewport, and as little as possible.
    const phone = window.matchMedia("(max-width: 860px)").matches;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    requestAnimationFrame(() => {
      const el = document.querySelector(".verdict");
      if (!el) return;
      if (phone) { el.scrollIntoView({ block: "start", behavior }); return; }
      const top = el.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight) el.scrollIntoView({ block: "nearest", behavior });
    });
  };
  const applyCoords = () => {
    const parse = (s: string) => parseFloat(s.replace(",", ".").replace("−", "-"));
    const lat = parse(coordsForm.lat), lon = parse(coordsForm.lon), r = parse(coordsForm.r);
    const ok = validateCoords(lat, lon, r, country.bbox);
    setCoordsError(!ok);
    if (!ok) return;
    setDrawing(false);
    setCoords({ lat, lon, r });
    setPolygon(circleRing(lat, lon, r));
    setDepartmentId(null);
    setZoneKind("custom");
  };
  const setRangeSafe = (a: number, b: number) => setRange(a <= b ? [a, b] : [b, a]);

  const downloadHotspots = async () => {
    setDlError(null);
    try {
      const hist = range[0] < meta.months.count
        ? await historicalHotspotRows(meta, zoneSet, range[0], Math.min(range[1], meta.months.count - 1), (a, b) => setBusy(t.dlPreparing(a, b)), path)
        : [];
      const recent = data.hotspots.filter((h) => h.m >= range[0] && h.m <= range[1] && zoneSet.has(h.cell)).map((h) => h.csv);
      const rows = [...hist, ...recent];
      const parts: string[] = [HOTSPOT_HEADER + "\n"];
      for (let k = 0; k < rows.length; k += 50000) parts.push(rows.slice(k, k + 50000).join("\n") + "\n");
      downloadParts(`tata-rekavo_hotspots_${fileTag}.csv`, parts);
    } catch (e) {
      setDlError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const CLASS_IDS = ["low", "normal", "high", "extreme"] as const;
  const scalePos = (() => { // marker position across four equal segments, 0-100
    const [c0, c1, c2] = meta.classes.map((c) => c.max ?? 0);
    const r = Number.isFinite(v.ratio) ? v.ratio : c2 * 2;
    const [seg, f] = r < c0 ? [0, r / c0] : r < c1 ? [1, (r - c0) / (c1 - c0)] : r < c2 ? [2, (r - c1) / (c2 - c1)] : [3, Math.min(1, (r - c2) / c2)];
    return Math.min(99, Math.max(1, (seg + f) * 25));
  })();

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        {header}
        <main>
          <aside className="panel">
            <section className="sec-area">
              <h2>{t.step1}</h2>
              <div className={presetIds.length > 3 ? "seg area many" : "seg area"} role="group" aria-label={t.areaPresets}>
                {presetIds.map((k) => (
                  <button key={k} aria-pressed={zoneKind === k && !drawing && !coordsOpen}
                    className={zoneKind === k && !drawing && !coordsOpen ? "on" : ""} onClick={() => pickZone(k)}>{zoneName(k)}</button>
                ))}
              </div>
              {department && <p className="dep-active" role="status"><span aria-hidden>◉</span> {t.depActive(department.name)}</p>}
              <div className="area-tools" role="group" aria-label={t.customArea}>
                <span className="tools-label">{t.customArea}</span>
                <button aria-pressed={drawing || (zoneKind === "custom" && !coords && !coordsOpen)}
                  className={`tool${drawing || (zoneKind === "custom" && !coords && !coordsOpen) ? " on" : ""}`}
                  onClick={() => { setCoordsOpen(false); setDrawing(true); }}><span aria-hidden>✎</span>{t.drawTool}</button>
                <button aria-pressed={coordsOpen || (zoneKind === "custom" && !!coords)} aria-expanded={coordsOpen}
                  className={`tool${coordsOpen || (zoneKind === "custom" && coords) ? " on" : ""}`}
                  onClick={() => { setDrawing(false); setCoordsOpen(!coordsOpen); }}><span aria-hidden>⌖</span>{t.coordsTool}</button>
              </div>
              {coordsOpen && (<>
                <div className="coords">
                  <label>{t.coordsLat}<input inputMode="decimal" value={coordsForm.lat} onChange={(e) => setCoordsForm({ ...coordsForm, lat: e.target.value })} /></label>
                  <label>{t.coordsLon}<input inputMode="decimal" value={coordsForm.lon} onChange={(e) => setCoordsForm({ ...coordsForm, lon: e.target.value })} /></label>
                  <label>{t.coordsRadius}<input inputMode="decimal" value={coordsForm.r} onChange={(e) => setCoordsForm({ ...coordsForm, r: e.target.value })} /></label>
                  <button onClick={applyCoords}>{t.coordsApply}</button>
                </div>
                <p className={coordsError ? "dl-error" : "note"}>{coordsError ? t.coordsInvalid(countryName)
                  : t.coordsHelp(String(example[0]).replace("-", "−"), String(example[1]).replace("-", "−"), countryName)}</p>
              </>)}
              <p className="meta">
                {zoneCells.length > 0 ? t.cellsArea(num(zoneCells.length), num(areaKm2(meta, zoneCells))) : <span className="warn">{t.noCells}</span>}
                {(zoneKind !== country.area || drawing || coordsOpen) && (
                  <button className="link" onClick={() => pickZone(country.area)}>{t.resetArea(countryName)}</button>
                )}
              </p>
              {small && zoneCells.length > 0 && <p className="warn">{t.smallArea}</p>}
            </section>

            <section className="sec-month">
              <h2>{t.step2}</h2>
              <div className="month-row">
                <button aria-label={t.prev} onClick={() => setMonth(Math.max(0, month - 1))} disabled={month === 0}>‹</button>
                <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label={t.monthAria}>
                  {monthsDesc.map((m) => <option key={m} value={m}>{ml(m)}{coverage(m) < 1 ? t.inProgress : ""}</option>)}
                </select>
                <button aria-label={t.next} onClick={() => setMonth(Math.min(last, month + 1))} disabled={month === last}>›</button>
              </div>
              {month !== last && <p className="meta"><button className="link" onClick={() => setMonth(last)}>{t.resetMonth}</button></p>}
              <div className="metric">
                <span className="metric-label" id="metric-label">{t.metricLabel}</span>
                <div className="seg metric-seg" role="group" aria-labelledby="metric-label">
                  <button aria-pressed={metric === "count"} className={metric === "count" ? "on" : ""} onClick={() => setMetric("count")}>{t.metricCount}</button>
                  <button aria-pressed={metric === "frp"} className={metric === "frp" ? "on" : ""} disabled={frpFailed}
                    onClick={() => setMetric("frp")}>{t.metricFrp}</button>
                </div>
                {frpFailed && <p className="note" role="status">{t.metricUnavailable}</p>}
                {frpLoading && <p className="note" role="status">{t.metricLoading}</p>}
                {experimental && <p className="exp-note" role="status"><span className="exp-badge">{t.experimentalTag}</span> {t.experimentalNote}</p>}
                <details>
                  <summary>{t.metricHelpTitle}</summary>
                  <p>{t.metricHelp}</p>
                </details>
              </div>
            </section>

            <section className={`verdict v-${v.noData ? "nodata" : v.class.id}`}>
              <div aria-live="polite">
              <p className="v-when">{t.verdictWhen(i18n.monthLongLabel(selYear, selMonth), zoneLabel)}{experimental && <> <span className="exp-badge">{t.experimentalTag}</span></>}</p>
              {v.noData ? (
                <p className="v-text v-nodata">{t.frpNoData(i18n.monthLongLabel(selYear, selMonth))}</p>
              ) : (<>
              <p className="v-class"><span aria-hidden>{cls.icon}</span> {t.classes[v.class.id]}</p>
              <p className="v-main">
                <span className="v-ratio">{Number.isFinite(v.ratio) ? `×${i18n.ratio(v.ratio)}` : "—"}</span>
                <span className="v-of">{t.ofUsual}</span>
              </p>
              <div className="v-scale" role="img" aria-label={t.scaleAria(Number.isFinite(v.ratio) ? i18n.ratio(v.ratio) : "—")}>
                <div className="v-track">
                  {CLASS_IDS.map((id) => <span key={id} className={id === v.class.id ? "on" : ""} />)}
                  <i style={{ left: `${scalePos}%` }} />
                </div>
                <div className="v-labels">{CLASS_IDS.map((id) => <span key={id} className={id === v.class.id ? "on" : ""}>{t.scale[id]}</span>)}</div>
              </div>
              <p className="v-text">
                <b>{num(v.value)}</b> {t.hotspots}{v.relativeError > 0 && <> (±{Math.round(v.relativeError * 100)}%)</>}. {t.usualIs(monthLong, v.partial)}{" "}
                <b>{num(v.median)}</b> {t.medianOf(v.yearsCompared)}
                {v.rank !== null && v.yearsCompared >= 5 && <> {t.rank(v.rank, monthLong, v.yearsCompared + 1)}</>}
              </p>
              {v.partial && <p className="v-tag">{t.partialTag(Math.round(cov * 100))}</p>}
              <p className="v-src">{t.source} {sourceOf(meta, data.current, month, i18n)}</p>
              {protSummary && protSummary.inside >= 1 && (
                <p className="v-prot">
                  {t.protLine(num(protSummary.inside), protShare)}.
                  {protTop.length > 0 && <> {t.protMost}{" "}{protTop.map((a, i) => (
                    <span key={a.id}>{i > 0 && ", "}{a.name}{!a.lowSignal && (a.classId === "high" || a.classId === "extreme") && a.ratio !== null
                      && <>: {t.classes[a.classId].toLowerCase()} ×{i18n.ratio(a.ratio)}</>}</span>
                  ))}.</>}
                </p>
              )}
              {protNote === "late" && <p className="v-prot">{t.protLate(ml(protThroughIdx))}</p>}
              {protNote === "stale" && context && <p className="v-prot">{t.protStale(context.meta.through_day ?? context.meta.generated.slice(0, 10))}</p>}
              </>)}
              <details>
                <summary>{t.whatIsHotspot}</summary>
                <p>{t.hotspotDef}</p>
              </details>
              </div>
              <ValidationPanel meta={meta} countryArea={country.area} countryName={countryName} path={path} areaName={zoneName} />
            </section>

            {context && (protSummary || protNote) && (
              <ProtectedAreas summary={protSummary} note={protNote} zoneLabel={zoneLabel} source={context.meta.source} coverage={cov}
                throughLabel={ml(protThroughIdx)} asOf={context.meta.through_day ?? context.meta.generated.slice(0, 10)} />
            )}

            {ranking && ranking.length > 0 && (
              <DepartmentRanking rows={ranking} monthLabel={monthLabel} coverage={cov} selectedId={zoneKind === "department" ? departmentId : null}
                onSelect={pickDepartment} />
            )}

            {data.hasBurnHistory && <section className="newplaces">
              <h2><span className="dot-new" aria-hidden />{t.newTitle}</h2>
              {monthHotspots.length > 0 ? (<>
                <p className="stat">{nNew > 0
                  ? <><b>{num(nNew)}</b>{t.newStat("", num(zoneMonthHotspots.length), (Math.round(pctNew * 10) / 10).toLocaleString(lang === "es" ? "es-PY" : "en-US"))}</>
                  : t.newNone(num(zoneMonthHotspots.length))}</p>
                <label className="check">
                  <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
                  {t.newOnly}
                </label>
                <details>
                  <summary>{t.newWhat}</summary>
                  <p>{t.newNote}</p>
                </details>
              </>) : <p className="note">{t.newUnavailable}</p>}
            </section>}

            <section>
              <div className="h2row">
                <h2>{t.calendarTitle(zoneLabel)}</h2>
                <div className="seg small" role="group">
                  <button className={calMode === "ratio" ? "on" : ""} onClick={() => setCalMode("ratio")}>{t.calModeRatio}</button>
                  <button className={calMode === "count" ? "on" : ""} onClick={() => setCalMode("count")}>{t.calModeCount}</button>
                </div>
              </div>
              <Calendar grid={grid} series={series.harmonized} coverage={coverage} selected={month} onSelect={setMonth} mode={calMode} range={range} />
            </section>

            {frpOn && season && data.current?.to && (
              <section>
                <h2>{t.seasonTitle(zoneLabel)}</h2>
                <p className="note">{t.seasonCountsOnly}</p>
              </section>
            )}
            {!frpOn && season && data.current?.to && hotspotsReady && (
              <section>
                <h2>{t.seasonTitle(zoneLabel)}</h2>
                <SeasonChart season={season} zoneKind={zoneKind} departmentId={departmentId} hotspots={data.hotspots} zone={zoneSet}
                  to={data.current.to} daysWithoutData={data.current.days_without_data} />
              </section>
            )}

            <section>
              <div className="h2row">
                <h2>{t.perYear}</h2>
                {!frpOn && ( // raw sensor counts have no fire power counterpart in frp.json
                  <div className="seg small" role="group" aria-label={t.perYear}>
                    <button className={!naive ? "on" : ""} onClick={() => setNaive(false)}>{t.harmonized}</button>
                    <button className={naive ? "on" : ""} onClick={() => setNaive(true)}>{t.rawSensors}</button>
                  </div>
                )}
              </div>
              <YearChart grid={grid} series={series} naive={naive && !frpOn} selectedYear={selYear} lastPartial={lastPartial} unit={frpOn ? "MW" : undefined} />
              <p className="note">{naive && !frpOn ? t.noteNaive : t.noteHarmonized}</p>
            </section>

            <section className="period">
              <h2>{t.step3}</h2>
              <div className="range-row">
                <label>{t.rangeFrom}
                  <select value={range[0]} onChange={(e) => setRangeSafe(+e.target.value, range[1])}>
                    {monthsDesc.map((m) => <option key={m} value={m}>{ml(m)}</option>)}
                  </select>
                </label>
                <label>{t.rangeTo}
                  <select value={range[1]} onChange={(e) => setRangeSafe(range[0], +e.target.value)}>
                    {monthsDesc.map((m) => <option key={m} value={m}>{ml(m)}</option>)}
                  </select>
                </label>
              </div>
              <div className="chips">
                {Object.entries(presets).map(([k, r]) => (
                  <button key={k} className={range[0] === r[0] && range[1] === r[1] ? "on" : ""} onClick={() => setRange(r)}>{t.presets[k]}</button>
                ))}
                {(range[0] !== presets.year[0] || range[1] !== presets.year[1]) && (
                  <button className="reset" onClick={() => setRange(presets.year)}>{t.resetRange}</button>
                )}
              </div>

              <div className="analytics" aria-live="polite">
                <h3>{t.rangeTitle(ml(range[0]), ml(range[1]), zoneLabel)}</h3>
                {!rangeEmpty && <p className="big">{t.rangeTotal(num(analytics.total), analytics.err > 0 ? ` ±${num(analytics.err)}` : "")}</p>}
                <ul>{analyticsLines.map((l) => <li key={l}>{l}</li>)}</ul>
                {analytics.partial && <p className="tag">{t.rangePartial}</p>}
              </div>

              <h3>{t.download}</h3>
              <div className="downloads">
                <button onClick={() => {
                  const lines = H.seriesToCSV(grid, series, { metric: active }).trimEnd().split("\n");
                  download(`tata-rekavo_monthly_${metricTag}${fileTag}.csv`, [lines[0], ...lines.slice(range[0] + 1, range[1] + 2)].join("\n") + "\n");
                }}>{t.dlSeriesRange(ml(range[0]), ml(range[1]))}</button>
                {hasArchive !== false && (<>
                  <button disabled={!!busy || tooMany || !zoneCells.length || !hotspotsReady} onClick={downloadHotspots}>
                    {busy ?? t.dlHotspotsRange(ml(range[0]), ml(range[1]))}
                    {!busy && estimate !== null && !tooMany && <span className="dl-hint">{t.dlHotspotsEstimate(num(estimate))}</span>}
                  </button>
                  {tooMany && <p className="dl-error">{t.dlTooMany(num(estimate ?? 0))}</p>}
                </>)}
                <button onClick={() => downloadReport({ grid, series, coverage, i18n, zoneLabel, range, rangeLabel, mode: calMode, analytics,
                  lines: analyticsLines }, `tata-rekavo_report_${metricTag}${fileTag}.png`)}>{t.dlReport}</button>
                {dlError && <p className="dl-error">{t.dlFailed} {dlError}</p>}
              </div>
            </section>

            <footer className="about">
              <details>
                <summary>{t.aboutData}</summary>
                <p>{t.footData(meta.months.last, data.current?.to ?? null)}</p>
                {updatedLine}
                {val && valRows.length > 0 && <p>{t.footValidation(valRows.map((r) => [r.mdapePct, r.area === "country" ? countryName : zoneIn(r.area)]))}</p>}
                <h3 className="about-h">{t.partnerTitle}</h3>
                <p>{t.footBoundaries(departments?.meta.retrieved ?? (country.iso3 === "PRY" ? GEOBOUNDARIES_RETRIEVED : null),
                  country.iso3 === "PRY" ? t.admPry : `${countryName} ADM1`)}{" "}
                  <a href={GEOBOUNDARIES} target="_blank" rel="noreferrer">geoboundaries.org</a>
                </p>
                {countGrid.meta.regions?.kind === "biome" && (
                  <p>{t.footBiomes}{" "}
                    <a href="https://ecoregions.appspot.com/" target="_blank" rel="noreferrer">RESOLVE Ecoregions 2017</a>
                  </p>
                )}
                {context && (
                  <p>{t.footWdpa(context.meta.citation, context.meta.retrieved)}{" "}
                    <a href={WDPA_URL} target="_blank" rel="noreferrer">{WDPA_URL}</a>. {t.footWdpaTerms}
                  </p>
                )}
                <p>{t.footIndigenous}</p>
              </details>
              <p>{t.footHotspot}</p>
            </footer>
          </aside>

          <Suspense fallback={<div className="map-wrap" aria-busy="true" />}>
          <MapView grid={countGrid} metric={active} monthLabel={monthLabel} values={monthValues} zone={zoneSet} zoneBBox={zoneBBox} viewNonce={viewNonce}
            countryBBox={country.bbox} showNew={data.hasBurnHistory}
            outline={outline} hotspots={monthHotspots} newOnly={newOnly} i18n={i18n} drawing={drawing}
            onDrawn={(ring) => { setPolygon(ring); setCoords(null); setDepartmentId(null); setZoneKind("custom"); setDrawing(false); }}
            onCancelDraw={() => setDrawing(false)}
            onUserMove={() => setMapMoved(true)} onViewReset={() => setMapMoved(false)} />
          </Suspense>
        </main>
      </div>
    </I18nContext.Provider>
  );
}
