import { useEffect, useMemo, useState } from "react";
import * as H from "@core";
import MapView from "./MapView";
import Calendar from "./Calendar";
import YearChart from "./YearChart";
import { areaKm2, bboxOfCells, download, fmt, loadData, regionOfCell, sourceOf, type AppData } from "./data";

type ZoneKind = "paraguay" | "chaco" | "oriental" | "custom";
const ZONE_NAMES: Record<ZoneKind, string> = { paraguay: "Paraguay", chaco: "the Chaco", oriental: "the Oriental region", custom: "your zone" };
const CLASS_STYLE: Record<string, { icon: string; color: string }> = {
  low: { icon: "↓", color: "#2a78d6" }, normal: { icon: "≈", color: "#52514e" },
  high: { icon: "↑", color: "#c9461a" }, extreme: { icon: "▲", color: "#d03b3b" },
};
const REPO = "https://github.com/NeryC/tata-rekavo";
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoneKind, setZoneKind] = useState<ZoneKind>("paraguay");
  const [polygon, setPolygon] = useState<number[][] | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [month, setMonth] = useState<number>(-1);
  const [naive, setNaive] = useState(false);

  useEffect(() => {
    loadData().then((d) => { setData(d); setMonth(d.grid.nMonths - 1); }).catch((e) => setError(String(e)));
  }, []);

  const grid = data?.grid;
  const regionOf = useMemo(() => {
    const r = new Map<number, string>();
    if (grid) for (const idx of grid.cells.keys()) r.set(idx, regionOfCell(grid.meta, idx));
    return r;
  }, [grid]);

  const zoneCells = useMemo(() => {
    if (!grid) return [];
    if (zoneKind === "custom" && polygon) return H.cellsInPolygon(grid, polygon);
    if (zoneKind === "chaco" || zoneKind === "oriental") return [...grid.cells.keys()].filter((i) => regionOf.get(i) === zoneKind);
    return [...grid.cells.keys()];
  }, [grid, zoneKind, polygon, regionOf]);
  const zoneSet = useMemo(() => new Set(zoneCells), [zoneCells]);
  const zoneBBox = useMemo(() => (grid && zoneCells.length ? bboxOfCells(grid.meta, zoneCells) : [-62.8, -27.7, -54.1, -19.1] as [number, number, number, number]), [grid, zoneCells]);
  const series = useMemo(() => (grid ? H.zoneSeries(grid, zoneCells) : null), [grid, zoneCells]);
  const coverage = useMemo(() => (m: number) => (grid ? H.monthCoverage(grid.meta, m, data?.current ?? null) : 1), [grid, data]);

  const monthValues = useMemo(() => {
    const out = new Map<number, number>();
    if (!grid || month < 0) return out;
    for (const [idx, c] of grid.cells) {
      const k = c.m.indexOf(month);
      if (k >= 0 && c.h[k] > 0) out.set(idx, c.h[k]);
    }
    return out;
  }, [grid, month]);
  const monthHotspots = useMemo(() => (data ? data.hotspots.filter((h) => h.m === month) : []), [data, month]);

  if (error) return <div className="splash">Could not load the data: {error}</div>;
  if (!data || !grid || !series || month < 0) return <div className="splash">Loading 24 years of fire hotspots…</div>;

  const meta = grid.meta;
  const cov = coverage(month);
  const v = H.verdict(grid, series.harmonized, month, cov);
  const src = sourceOf(meta, data.current, month);
  const cls = CLASS_STYLE[v.class.id];
  const { label: monthLabel, year: selYear } = H.monthOf(meta, month);
  const monthName = monthLabel.split(" ")[0];
  const months = Array.from({ length: grid.nMonths }, (_, m) => m).reverse();
  const val = meta.validation?.leave_one_year_out;
  const lastPartial = coverage(grid.nMonths - 1) < 1;
  const zoneHotspots = data.hotspots.filter((h) => zoneSet.has(h.cell));
  const small = zoneCells.length < 40;

  const pickZone = (k: ZoneKind) => { setDrawing(false); setZoneKind(k); if (k !== "custom") setPolygon(null); };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>◉</span>
          <div>
            <h1>Is this fire normal?</h1>
            <p>Tata Rekavo · 24 years of NASA MODIS + VIIRS fire hotspots over Paraguay, harmonized into one record</p>
          </div>
        </div>
        <nav><a href={`${REPO}#method`} target="_blank" rel="noreferrer">Method & validation</a><a href={REPO} target="_blank" rel="noreferrer">Code</a></nav>
      </header>

      <main>
        <aside className="panel">
          <section>
            <h2>1 · Choose an area</h2>
            <div className="seg" role="group" aria-label="Area">
              {(["paraguay", "chaco", "oriental"] as ZoneKind[]).map((k) => (
                <button key={k} className={zoneKind === k && !drawing ? "on" : ""} onClick={() => pickZone(k)}>
                  {k === "paraguay" ? "Paraguay" : k === "chaco" ? "Chaco" : "Oriental"}
                </button>
              ))}
              <button className={drawing || zoneKind === "custom" ? "on" : ""} onClick={() => setDrawing(true)}>✎ Draw</button>
            </div>
            <p className="meta">{fmt(zoneCells.length)} grid cells · ~{fmt(areaKm2(meta, zoneCells))} km²
              {small && zoneCells.length > 0 && <span className="warn"> · small area: months before 2012 carry a larger error</span>}
              {zoneCells.length === 0 && <span className="warn"> · no cells inside, draw a larger area</span>}
            </p>
          </section>

          <section>
            <h2>2 · Choose a month</h2>
            <div className="month-row">
              <button aria-label="Previous month" onClick={() => setMonth(Math.max(0, month - 1))} disabled={month === 0}>‹</button>
              <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label="Month">
                {months.map((m) => <option key={m} value={m}>{H.monthOf(meta, m).label}{coverage(m) < 1 ? " (in progress)" : ""}</option>)}
              </select>
              <button aria-label="Next month" onClick={() => setMonth(Math.min(grid.nMonths - 1, month + 1))} disabled={month === grid.nMonths - 1}>›</button>
            </div>
          </section>

          <section className="verdict" style={{ borderColor: cls.color }} aria-live="polite">
            <div className="v-when">{monthLabel} in {ZONE_NAMES[zoneKind]}{v.partial ? ` · first ${Math.round(cov * 100)}% of the month` : ""}</div>
            <div className="v-main">
              <span className="v-badge" style={{ background: cls.color }}>{cls.icon} {v.class.label}</span>
              <span className="v-ratio">{Number.isFinite(v.ratio) ? `×${v.ratio.toFixed(2)}` : "—"}<small> of the usual level</small></span>
            </div>
            <p className="v-text">
              <b>{fmt(v.value)}</b> hotspots{v.relativeError > 0 && <> (±{Math.round(v.relativeError * 100)}%)</>} vs a usual{" "}
              <b>{fmt(v.median)}</b> for {v.partial ? `this part of ${monthName}` : monthName} — median of {v.yearsCompared} previous years.
              {v.rank !== null && v.yearsCompared >= 5 && <> {v.rank === 1 ? "Highest" : `${ordinal(v.rank)} highest`} {monthName} out of {v.yearsCompared + 1} on record.</>}
            </p>
            <p className="v-src">Source: {src.label}</p>
          </section>

          <section>
            <h2>Burning calendar · {ZONE_NAMES[zoneKind]}</h2>
            <Calendar grid={grid} series={series.harmonized} coverage={coverage} selected={month} onSelect={setMonth} />
          </section>

          <section>
            <div className="h2row">
              <h2>Hotspots per year</h2>
              <div className="seg small" role="group" aria-label="Record">
                <button className={!naive ? "on" : ""} onClick={() => setNaive(false)}>Harmonized</button>
                <button className={naive ? "on" : ""} onClick={() => setNaive(true)}>Raw sensors</button>
              </div>
            </div>
            <YearChart grid={grid} series={series} naive={naive} selectedYear={selYear} lastPartial={lastPartial} />
            <p className="note">{naive
              ? "Stitching the raw sensors together makes fire look ~3× higher after 2012 — but that jump is the switch to the more sensitive VIIRS sensor, not more fire."
              : "One unit for 24 years: MODIS counts before 2012 are translated to what VIIRS would have detected, with a factor per region and calendar month."}</p>
          </section>

          <section>
            <h2>Download</h2>
            <div className="downloads">
              <button onClick={() => download(`tata-rekavo_${zoneKind}_monthly.csv`, H.seriesToCSV(grid, series))}>Monthly series for this area (CSV)</button>
              <button disabled={!zoneHotspots.length}
                onClick={() => download(`tata-rekavo_${zoneKind}_hotspots_${data.current?.from ?? ""}_${data.current?.to ?? ""}.csv`,
                  [data.hotspotsHeader, ...zoneHotspots.map((h) => h.raw)].join("\n") + "\n")}>
                {fmt(zoneHotspots.length)} hotspots of {data.current?.from.slice(0, 4) ?? "this year"} in this area (CSV)
              </button>
            </div>
          </section>

          <footer className="about">
            <p>Data: NASA FIRMS — MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20), vegetation fires only.
              Months up to {meta.months.last} from the standard-processing archives; later months from the FIRMS API{data.current ? ` (to ${data.current.to})` : ""}.</p>
            {val && <p>Harmonization tested on held-out years: median monthly error {val.country?.mdape_pct}% for Paraguay,
              {" "}{val.chaco?.mdape_pct}% for the Chaco and {val.oriental?.mdape_pct}% for the Oriental region.</p>}
            <p>A hotspot is a ~375 m–1 km pixel with active fire at the satellite's overpass, not a fire count. AI-assisted application. NASA Space Apps Challenge 2026 · Asunción.</p>
          </footer>
        </aside>

        <MapView grid={grid} monthLabel={monthLabel} values={monthValues} zone={zoneSet} zoneBBox={zoneBBox}
          polygon={zoneKind === "custom" ? polygon : null} hotspots={monthHotspots} drawing={drawing}
          onDrawn={(ring) => { setPolygon(ring); setZoneKind("custom"); setDrawing(false); }}
          onCancelDraw={() => setDrawing(false)} />
      </main>
    </div>
  );
}
