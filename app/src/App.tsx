import { useEffect, useMemo, useState } from "react";
import * as H from "@core";
import MapView from "./MapView";
import Calendar from "./Calendar";
import YearChart from "./YearChart";
import { areaKm2, bboxOfCells, download, loadData, regionOfCell, sourceOf, type AppData } from "./data";
import { I18nContext, initialLang, makeI18n, saveLang, type Lang } from "./i18n";

type ZoneKind = "paraguay" | "chaco" | "oriental" | "custom";
const CLASS_STYLE: Record<string, { icon: string; color: string }> = {
  low: { icon: "↓", color: "#2a78d6" }, normal: { icon: "≈", color: "#52514e" },
  high: { icon: "↑", color: "#c9461a" }, extreme: { icon: "▲", color: "#d03b3b" },
};
const REPO = "https://github.com/NeryC/tata-rekavo";

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const { t, num } = i18n;
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoneKind, setZoneKind] = useState<ZoneKind>("paraguay");
  const [polygon, setPolygon] = useState<number[][] | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [month, setMonth] = useState<number>(-1);
  const [naive, setNaive] = useState(false);
  const [newOnly, setNewOnly] = useState(false);

  useEffect(() => {
    loadData().then((d) => { setData(d); setMonth(d.grid.nMonths - 1); }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { document.documentElement.lang = lang; document.title = `Tata Rekavo · ${t.title}`; saveLang(lang); }, [lang, t]);

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
  const zoneMonthHotspots = useMemo(() => monthHotspots.filter((h) => zoneSet.has(h.cell)), [monthHotspots, zoneSet]);

  const header = (
    <header className="top">
      <div className="brand">
        <span className="logo" aria-hidden>◉</span>
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <nav>
        <a href={`${REPO}#method`} target="_blank" rel="noreferrer">{t.method}</a>
        <a href={REPO} target="_blank" rel="noreferrer">{t.code}</a>
        <span className="lang" role="group" aria-label={t.langLabel}>
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button>
          <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")} aria-pressed={lang === "es"}>ES</button>
        </span>
      </nav>
    </header>
  );

  if (error) return <I18nContext.Provider value={i18n}><div className="app">{header}<div className="splash">{t.loadError} {error}</div></div></I18nContext.Provider>;
  if (!data || !grid || !series || month < 0) return <I18nContext.Provider value={i18n}><div className="app">{header}<div className="splash">{t.loading}</div></div></I18nContext.Provider>;

  const meta = grid.meta;
  const cov = coverage(month);
  const v = H.verdict(grid, series.harmonized, month, cov);
  const cls = CLASS_STYLE[v.class.id];
  const { year: selYear, month: selMonth } = H.monthOf(meta, month);
  const monthLabel = i18n.monthLabel(selYear, selMonth);
  const monthLong = i18n.monthLong(selMonth);
  const months = Array.from({ length: grid.nMonths }, (_, m) => m).reverse();
  const val = meta.validation?.leave_one_year_out;
  const lastPartial = coverage(grid.nMonths - 1) < 1;
  const zoneHotspots = data.hotspots.filter((h) => zoneSet.has(h.cell));
  const small = zoneCells.length < 40;
  const nNew = zoneMonthHotspots.filter((h) => h.fresh).length;
  const pctNew = zoneMonthHotspots.length ? (100 * nNew) / zoneMonthHotspots.length : 0;
  const lastYear = H.monthOf(meta, grid.nMonths - 1).year;

  const pickZone = (k: ZoneKind) => { setDrawing(false); setZoneKind(k); if (k !== "custom") setPolygon(null); };

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        {header}
        <main>
          <aside className="panel">
            <section>
              <h2>{t.step1}</h2>
              <div className="seg" role="group" aria-label={t.step1}>
                {(["paraguay", "chaco", "oriental"] as const).map((k) => (
                  <button key={k} className={zoneKind === k && !drawing ? "on" : ""} onClick={() => pickZone(k)}>{t.zones[k]}</button>
                ))}
                <button className={drawing || zoneKind === "custom" ? "on" : ""} onClick={() => setDrawing(true)}>{t.zones.draw}</button>
              </div>
              <p className="meta">{t.cellsArea(num(zoneCells.length), num(areaKm2(meta, zoneCells)))}
                {small && zoneCells.length > 0 && <span className="warn">{t.smallArea}</span>}
                {zoneCells.length === 0 && <span className="warn">{t.noCells}</span>}
              </p>
            </section>

            <section>
              <h2>{t.step2}</h2>
              <div className="month-row">
                <button aria-label={t.prev} onClick={() => setMonth(Math.max(0, month - 1))} disabled={month === 0}>‹</button>
                <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label={t.monthAria}>
                  {months.map((m) => {
                    const { year, month: mo } = H.monthOf(meta, m);
                    return <option key={m} value={m}>{i18n.monthLabel(year, mo)}{coverage(m) < 1 ? t.inProgress : ""}</option>;
                  })}
                </select>
                <button aria-label={t.next} onClick={() => setMonth(Math.min(grid.nMonths - 1, month + 1))} disabled={month === grid.nMonths - 1}>›</button>
              </div>
            </section>

            <section className="verdict" style={{ borderColor: cls.color }} aria-live="polite">
              <div className="v-when">{t.verdictWhen(monthLabel, t.zoneIn[zoneKind], v.partial ? Math.round(cov * 100) : null)}</div>
              <div className="v-main">
                <span className="v-badge" style={{ background: cls.color }}>{cls.icon} {t.classes[v.class.id]}</span>
                <span className="v-ratio">{Number.isFinite(v.ratio) ? `×${i18n.ratio(v.ratio)}` : "—"}<small>{t.ofUsual}</small></span>
              </div>
              <p className="v-text">
                <b>{num(v.value)}</b> {t.hotspots}{v.relativeError > 0 && <> (±{Math.round(v.relativeError * 100)}%)</>} {t.vsUsual}{" "}
                <b>{num(v.median)}</b> {t.forPart(monthLong, v.partial)} — {t.medianOf(v.yearsCompared)}
                {v.rank !== null && v.yearsCompared >= 5 && <> {t.rank(v.rank, monthLong, v.yearsCompared + 1)}</>}
              </p>
              <p className="v-src">{t.source} {sourceOf(meta, data.current, month, i18n)}</p>
            </section>

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
                <p className="note">{t.newNote}</p>
              </>) : <p className="note">{t.newUnavailable}</p>}
            </section>

            <section>
              <h2>{t.calendarTitle(t.zoneIn[zoneKind])}</h2>
              <Calendar grid={grid} series={series.harmonized} coverage={coverage} selected={month} onSelect={setMonth} />
            </section>

            <section>
              <div className="h2row">
                <h2>{t.perYear}</h2>
                <div className="seg small" role="group" aria-label={t.perYear}>
                  <button className={!naive ? "on" : ""} onClick={() => setNaive(false)}>{t.harmonized}</button>
                  <button className={naive ? "on" : ""} onClick={() => setNaive(true)}>{t.rawSensors}</button>
                </div>
              </div>
              <YearChart grid={grid} series={series} naive={naive} selectedYear={selYear} lastPartial={lastPartial} />
              <p className="note">{naive ? t.noteNaive : t.noteHarmonized}</p>
            </section>

            <section>
              <h2>{t.download}</h2>
              <div className="downloads">
                <button onClick={() => download(`tata-rekavo_${zoneKind}_monthly.csv`, H.seriesToCSV(grid, series))}>{t.dlSeries}</button>
                <button disabled={!zoneHotspots.length}
                  onClick={() => download(`tata-rekavo_${zoneKind}_hotspots_${data.current?.from ?? ""}_${data.current?.to ?? ""}.csv`,
                    [data.hotspotsHeader, ...zoneHotspots.map((h) => h.raw)].join("\n") + "\n")}>
                  {t.dlHotspots(num(zoneHotspots.length), String(lastYear))}
                </button>
              </div>
            </section>

            <footer className="about">
              <p>{t.footData(meta.months.last, data.current?.to ?? null)}</p>
              {val && <p>{t.footValidation(val.country?.mdape_pct, val.chaco?.mdape_pct, val.oriental?.mdape_pct)}</p>}
              <p>{t.footHotspot}</p>
            </footer>
          </aside>

          <MapView grid={grid} monthLabel={monthLabel} values={monthValues} zone={zoneSet} zoneBBox={zoneBBox}
            polygon={zoneKind === "custom" ? polygon : null} hotspots={monthHotspots} newOnly={newOnly} i18n={i18n} drawing={drawing}
            onDrawn={(ring) => { setPolygon(ring); setZoneKind("custom"); setDrawing(false); }}
            onCancelDraw={() => setDrawing(false)} />
        </main>
      </div>
    </I18nContext.Provider>
  );
}
