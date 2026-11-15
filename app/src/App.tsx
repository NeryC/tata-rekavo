import { useEffect, useMemo, useRef, useState } from "react";
import * as H from "@core";
import MapView from "./MapView";
import Calendar, { type CalMode } from "./Calendar";
import YearChart from "./YearChart";
import SeasonChart from "./SeasonChart";
import ValidationPanel from "./ValidationPanel";
import DepartmentRanking from "./DepartmentRanking";
import { rangeAnalytics } from "./analytics";
import { downloadReport } from "./report";
import { formatUpdated, isStale } from "./format";
import {
  areaKm2, bboxOfCells, circleRing, download, downloadParts, estimateHistoricalRows, historicalHotspotRows, hotspotIndex,
  HOTSPOT_HEADER, loadData, loadDepartments, loadFrp, loadSeason, regionOfCell, sourceOf, type AppData, type DepartmentsFile,
} from "./data";
import { decodeState, encodeState, validateCoords, type ShareState } from "./urlState";
import { indexToMonth, planRestore } from "./shareRestore";
import type { Grid } from "@core";
import type { SeasonFile } from "./season";
import { I18nContext, initialLang, makeI18n, saveLang, type Lang, type Metric } from "./i18n";

type ZoneKind = "paraguay" | "chaco" | "oriental" | "custom" | "department";
const CLASS_STYLE: Record<string, { icon: string }> = {
  low: { icon: "↓" }, normal: { icon: "≈" }, high: { icon: "↑" }, extreme: { icon: "▲" },
};
const REPO = "https://github.com/NeryC/tata-rekavo";
const GEOBOUNDARIES = "https://www.geoboundaries.org/";
const GEOBOUNDARIES_RETRIEVED = "2026-11-14"; // shown when departments.json did not load
const MAX_ROWS = 1_500_000;
// a typical month under 100 MW is too little fire to rank by ratio (counts use 10 hotspots, MW run about ten times higher)
const FRP_LOW_SIGNAL_MEDIAN = 100;

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
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
  const [zoneKind, setZoneKind] = useState<ZoneKind>("paraguay");
  const [departments, setDepartments] = useState<DepartmentsFile | null>(null); // null until loaded, or when it failed
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [season, setSeason] = useState<SeasonFile | null>(null); // null until loaded, or when it failed: the chart stays hidden
  const [polygon, setPolygon] = useState<number[][] | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number; r: number } | null>(null);
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [coordsForm, setCoordsForm] = useState({ lat: "-22.35", lon: "-60.03", r: "25" });
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
  const [viewNonce, setViewNonce] = useState(0);
  const [mapMoved, setMapMoved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const depsLoad = loadDepartments(); // lazy and optional: starts with the grid, never blocks it
    void depsLoad.then(setDepartments);
    void loadSeason().then(setSeason);
    loadData().then(async (d) => {
      // a shared department link has to wait for departments.json, or it would restore as Paraguay
      const link = decodeState(window.location.search);
      const deps = link.zone === "department" ? await depsLoad : null;
      const last = d.grid.nMonths - 1;
      const { year } = H.monthOf(d.grid.meta, last);
      const defRange: [number, number] = [Math.max(0, H.indexOf(d.grid.meta, year, 1)), last];
      // restore a shared link only here, once the grid is known, so months can be clamped to the data
      const r = planRestore(d.grid.meta.months.first, d.grid.nMonths, link, defRange, deps ? deps.departments.map((x) => x.id) : null);
      setZoneKind(r.zone);
      setDepartmentId(r.dep);
      setCoords(r.coords);
      if (r.coords) {
        setPolygon(circleRing(r.coords.lat, r.coords.lon, r.coords.r));
        setCoordsForm({ lat: String(r.coords.lat), lon: String(r.coords.lon), r: String(r.coords.r) });
      } else setPolygon(r.poly);
      setMonth(r.month);
      setRange(r.range);
      setCalMode(r.cal); setNaive(r.naive); setNewOnly(r.newOnly); setMetric(r.metric);
      setData(d);
    }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { document.documentElement.lang = lang; document.title = `Tata Rekavo · ${t.title}`; saveLang(lang); }, [lang, t]);

  // frp.json is 2.4 MB: only fetched once the reader asks for fire power
  useEffect(() => {
    if (metric !== "frp" || !data || frpRequested.current) return;
    frpRequested.current = true;
    // no cancellation: if the reader goes back to Hotspots before it arrives, the grid is still kept for the next switch
    void loadFrp().then((j) => {
      try {
        if (!j) throw new Error("frp.json unavailable");
        setFrpGrid(H.decodeFrp(j, data.currentJson, data.grid.meta));
      } catch { setFrpFailed(true); setMetric("count"); }
    });
  }, [metric, data]);
  const frpLoading = metric === "frp" && !frpGrid && !frpFailed; // derived: cannot get stuck

  // countGrid fixes the geography (cells, areas, hotspot downloads); grid is the one the active measure reads
  const countGrid = data?.grid;
  const grid = active === "frp" && frpGrid ? frpGrid : countGrid;
  const regionOf = useMemo(() => {
    const r = new Map<number, string>();
    if (countGrid) for (const idx of countGrid.cells.keys()) r.set(idx, regionOfCell(countGrid.meta, idx));
    return r;
  }, [countGrid]);

  const department = useMemo(
    () => (zoneKind === "department" && departmentId ? departments?.departments.find((d) => d.id === departmentId) ?? null : null),
    [zoneKind, departmentId, departments]);

  const zoneCells = useMemo(() => {
    if (!countGrid) return [];
    if (zoneKind === "department" && department) return department.cells;
    if (zoneKind === "custom" && polygon) return H.cellsInPolygon(countGrid, polygon);
    if (zoneKind === "chaco" || zoneKind === "oriental") return [...countGrid.cells.keys()].filter((i) => regionOf.get(i) === zoneKind);
    return [...countGrid.cells.keys()];
  }, [countGrid, zoneKind, department, polygon, regionOf]);
  const zoneSet = useMemo(() => new Set(zoneCells), [zoneCells]);
  const zoneBBox = useMemo(() => (department ? department.bbox : countGrid && zoneCells.length ? bboxOfCells(countGrid.meta, zoneCells) : [-62.8, -27.7, -54.1, -19.1] as [number, number, number, number]), [countGrid, zoneCells, department]);
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
    hotspotIndex().then(() => { // warm the block index while the user decides
      if (!alive) return;
      const hist = estimateHistoricalRows(countGrid, zoneCells, range[0], range[1]);
      const recent = data.hotspots.filter((h) => h.m >= range[0] && h.m <= range[1] && zoneSet.has(h.cell)).length;
      setEstimate(Math.round(hist + recent));
    });
    return () => { alive = false; };
  }, [countGrid, data, zoneCells, zoneSet, range]);

  // the state a shared link carries; null until the initial restore has run
  const shareQs = useMemo(() => {
    if (!data) return null;
    const first = data.grid.meta.months.first;
    const lastI = data.grid.nMonths - 1;
    const defStart = Math.max(0, H.indexOf(data.grid.meta, H.monthOf(data.grid.meta, lastI).year, 1));
    const s: ShareState = { lang, cal: calMode, naive, newOnly };
    if (metric === "frp") s.metric = "frp";
    if (zoneKind === "custom") {
      if (coords) s.c = coords; else if (polygon) s.poly = polygon;
      if (coords || polygon) s.zone = "custom";
    } else if (zoneKind === "department") {
      if (department) { s.zone = "department"; s.dep = department.id; }
    } else s.zone = zoneKind;
    if (month >= 0 && month !== lastI) s.m = indexToMonth(first, month);
    if (range[0] !== defStart || range[1] !== lastI) s.range = [indexToMonth(first, range[0]), indexToMonth(first, range[1])];
    return encodeState(s);
  }, [data, lang, zoneKind, department, polygon, coords, month, range, calMode, naive, newOnly, metric]);

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
    setZoneKind("paraguay"); setDepartmentId(null); setPolygon(null); setCoords(null);
    setMonth(lastM);
    setRange([Math.max(0, H.indexOf(data.grid.meta, H.monthOf(data.grid.meta, lastM).year, 1)), lastM]);
    setCalMode("ratio"); setNaive(false); setNewOnly(false); setMetric("count"); setDlError(null);
    setViewNonce((n) => n + 1);
    setMapMoved(false);
  }

  // "Reset all" only makes sense once something differs from the starting view
  const lastIdx = data ? data.grid.nMonths - 1 : -1;
  const startRange = data ? [Math.max(0, H.indexOf(data.grid.meta, H.monthOf(data.grid.meta, lastIdx).year, 1)), lastIdx] : [0, 0];
  const changed = !!data && (zoneKind !== "paraguay" || drawing || coordsOpen || month !== lastIdx
    || range[0] !== startRange[0] || range[1] !== startRange[1] || calMode !== "ratio" || naive || newOnly || metric !== "count" || mapMoved);

  const generated = data?.current?.generated;
  const stale = !!generated && isStale(generated, new Date());
  const updatedLine = generated ? (
    <p className={stale ? "updated stale" : "updated"}>
      {t.lastUpdated(formatUpdated(generated, lang))}
      {stale && <> · {t.staleData}</>}
    </p>
  ) : null;

  const header = (
    <header className="top">
      <div className="brand">
        <span className="logo" aria-hidden>◉</span>
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
          {updatedLine}
        </div>
      </div>
      <nav>
        <a href={`${REPO}#method`} target="_blank" rel="noreferrer">{t.method}</a>
        <a href={REPO} target="_blank" rel="noreferrer">{t.code}</a>
        <button className="reset-all copy-link" onClick={() => void copyLink()} title={t.copyLinkTitle} aria-label={t.copyLink}>
          <span aria-hidden>🔗</span><span className="lbl">{t.copyLink}</span>
        </button>
        {changed && (
          <button className="reset-all" onClick={() => resetAll()} title={t.resetAllTitle} aria-label={t.resetAllTitle}>
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
  const ml = (m: number) => { const o = H.monthOf(meta, m); return i18n.monthLabel(o.year, o.month); };
  const { year: selYear, month: selMonth } = H.monthOf(meta, month);
  const monthLabel = ml(month);
  const monthLong = i18n.monthLong(selMonth);
  const monthsDesc = Array.from({ length: grid.nMonths }, (_, m) => m).reverse();
  const val = meta.validation?.leave_one_year_out;
  const frpOn = active === "frp";
  const experimental = frpOn && meta.experimental === true; // from the data, never inferred from meta.name
  const lastPartial = coverage(last) < 1;
  const small = zoneCells.length < 40;
  const nNew = zoneMonthHotspots.filter((h) => h.fresh).length;
  const pctNew = zoneMonthHotspots.length ? (100 * nNew) / zoneMonthHotspots.length : 0;
  const zoneLabel = zoneKind === "custom" && coords
    ? t.zoneCoords(coords.lat.toFixed(2), coords.lon.toFixed(2), String(coords.r))
    : zoneKind === "department" ? t.zoneDept(department?.name ?? "") : t.zoneIn[zoneKind];
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
    if (!id) { pickZone("paraguay"); return; }
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
    const ok = validateCoords(lat, lon, r);
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
        ? await historicalHotspotRows(meta, zoneSet, range[0], Math.min(range[1], meta.months.count - 1), (a, b) => setBusy(t.dlPreparing(a, b)))
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
              <div className="seg area" role="group" aria-label={t.areaPresets}>
                {(["paraguay", "chaco", "oriental"] as const).map((k) => (
                  <button key={k} aria-pressed={zoneKind === k && !drawing && !coordsOpen}
                    className={zoneKind === k && !drawing && !coordsOpen ? "on" : ""} onClick={() => pickZone(k)}>{t.zones[k]}</button>
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
                <p className={coordsError ? "dl-error" : "note"}>{coordsError ? t.coordsInvalid : t.coordsHelp}</p>
              </>)}
              <p className="meta">
                {zoneCells.length > 0 ? t.cellsArea(num(zoneCells.length), num(areaKm2(meta, zoneCells))) : <span className="warn">{t.noCells}</span>}
                {(zoneKind !== "paraguay" || drawing || coordsOpen) && (
                  <button className="link" onClick={() => pickZone("paraguay")}>{t.resetArea}</button>
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
              </>)}
              <details>
                <summary>{t.whatIsHotspot}</summary>
                <p>{t.hotspotDef}</p>
              </details>
              </div>
              <ValidationPanel meta={meta} />
            </section>

            {ranking && ranking.length > 0 && (
              <DepartmentRanking rows={ranking} monthLabel={monthLabel} coverage={cov} selectedId={zoneKind === "department" ? departmentId : null}
                onSelect={pickDepartment} />
            )}

            <section className="newplaces">
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
            </section>

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
            {!frpOn && season && data.current?.to && (
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
                <button disabled={!!busy || tooMany || !zoneCells.length} onClick={downloadHotspots}>
                  {busy ?? t.dlHotspotsRange(ml(range[0]), ml(range[1]))}
                  {!busy && estimate !== null && !tooMany && <span className="dl-hint">{t.dlHotspotsEstimate(num(estimate))}</span>}
                </button>
                {tooMany && <p className="dl-error">{t.dlTooMany(num(estimate ?? 0))}</p>}
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
                {val && <p>{t.footValidation((val.country ?? val.paraguay)?.mdape_pct, val.chaco?.mdape_pct, val.oriental?.mdape_pct)}</p>}
                <h3 className="about-h">{t.partnerTitle}</h3>
                <p>{t.footBoundaries(departments?.meta.retrieved ?? GEOBOUNDARIES_RETRIEVED)}{" "}
                  <a href={GEOBOUNDARIES} target="_blank" rel="noreferrer">geoboundaries.org</a>
                </p>
              </details>
              <p>{t.footHotspot}</p>
            </footer>
          </aside>

          <MapView grid={countGrid} metric={active} monthLabel={monthLabel} values={monthValues} zone={zoneSet} zoneBBox={zoneBBox} viewNonce={viewNonce}
            outline={outline} hotspots={monthHotspots} newOnly={newOnly} i18n={i18n} drawing={drawing}
            onDrawn={(ring) => { setPolygon(ring); setCoords(null); setDepartmentId(null); setZoneKind("custom"); setDrawing(false); }}
            onCancelDraw={() => setDrawing(false)}
            onUserMove={() => setMapMoved(true)} onViewReset={() => setMapMoved(false)} />
        </main>
      </div>
    </I18nContext.Provider>
  );
}
