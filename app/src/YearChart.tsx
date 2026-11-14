import { useMemo, useState } from "react";
import * as H from "@core";
import type { Grid, Series } from "@core";
import { useI18n } from "./i18n";

interface Props { grid: Grid; series: Series; naive: boolean; selectedYear: number; lastPartial: boolean }

const C = { translated: "#6250d6", observed: "#eb6834", modisRaw: "#898781" };

export default function YearChart({ grid, series, naive, selectedYear, lastPartial }: Props) {
  const meta = grid.meta;
  const { t, num } = useI18n();
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const years = useMemo(() => {
    const em = meta.error_model;
    const out = new Map<number, { h: number; n: number; rnd2: number; sys: number; preMonths: number }>();
    for (let m = 0; m < grid.nMonths; m++) {
      const { year } = H.monthOf(meta, m);
      const o = out.get(year) ?? { h: 0, n: 0, rnd2: 0, sys: 0, preMonths: 0 };
      const v = series.harmonized[m];
      o.h += v; o.n += series.naive[m];
      if (m < meta.months.viirs_start_index) {
        const rnd = Math.min(1, em.c * Math.pow(Math.max(v, 1), -em.p));
        o.rnd2 += (rnd * v) ** 2; o.sys = em.sys_by_year[String(year)] ?? 0; o.preMonths++;
      }
      out.set(year, o);
    }
    return [...out.entries()].map(([year, o]) => ({
      year, h: o.h, n: o.n, translated: o.preMonths > 6,
      err: o.preMonths ? Math.sqrt(o.rnd2 + (o.sys * o.h) ** 2) : 0,
    }));
  }, [grid, series, meta]);

  const W = 420, Hh = 170, L = 38, B = 20, T = 8;
  const max = Math.max(...years.map((y) => Math.max(y.h + y.err, y.n))) * 1.05 || 1;
  const bw = (W - L) / years.length;
  const y = (v: number) => T + (Hh - T - B) * (1 - v / max);
  const step = (() => {
    const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
  })();
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const first = years[0]?.year, last = years[years.length - 1]?.year;

  return (
    <div className="yearchart" onMouseLeave={() => setTip(null)}>
      <div className="chart-legend">
        {naive ? (<>
          <span><i style={{ background: C.modisRaw }} />{t.legendModisRaw}</span>
          <span><i style={{ background: C.observed }} />{t.legendViirsRaw}</span>
        </>) : (<>
          <span><i className="hatch" style={{ background: C.translated }} />{t.legendTranslated}</span>
          <span><i style={{ background: C.observed }} />{t.legendObserved}</span>
        </>)}
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img"
        aria-label={t.chartAria(first, last, naive)}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={L} x2={W} y1={y(tk)} y2={y(tk)} className="gridline" />
            <text x={L - 5} y={y(tk) + 3} className="axis" textAnchor="end">{tk >= 1000 ? `${tk / 1000}k` : tk}</text>
          </g>
        ))}
        {years.map((d, i) => {
          const v = naive ? d.n : d.h;
          const color = naive ? (d.year < 2012 ? C.modisRaw : C.observed) : (d.translated ? C.translated : C.observed);
          const x = L + i * bw + 1;
          const partial = d.year === first || (d.year === last && lastPartial);
          const lines = [
            `${d.year}${d.year === first ? t.julDec : d.year === last && lastPartial ? t.toDate : ""}`,
            `${naive ? t.rawCount : t.harmonizedCount}: ${num(v)}${!naive && d.err ? ` ± ${num(d.err)}` : ""}`,
            naive ? (d.year < 2012 ? t.modisTA : t.viirsSnpp) : (d.translated ? t.translatedFrom : t.observedBy),
          ];
          return (
            <g key={d.year} onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, lines })}>
              <rect x={L + i * bw} y={T} width={bw} height={Hh - T - B} fill="transparent" />
              <rect x={x} y={y(v)} width={Math.max(1, bw - 2)} height={Math.max(0, y(0) - y(v))} rx={2}
                fill={color} opacity={partial ? 0.55 : 1} className="bar"
                stroke={d.year === selectedYear ? "#0b0b0b" : "none"} strokeWidth={1.5} />
              {!naive && d.err > 0 && (
                <line x1={x + bw / 2 - 1} x2={x + bw / 2 - 1} y1={y(d.h + d.err)} y2={y(Math.max(0, d.h - d.err))} className="errbar" />
              )}
              {(d.year % 4 === 2 || d.year === last) && (
                <text x={x + bw / 2 - 1} y={Hh - 5} className="axis" textAnchor="middle">{`'${String(d.year).slice(2)}`}</text>
              )}
            </g>
          );
        })}
        <line x1={L} x2={W} y1={y(0)} y2={y(0)} className="baseline" />
        {(() => {
          const i = years.findIndex((d) => d.year === 2012);
          if (i < 0) return null;
          const x = L + i * bw;
          return (<g><line x1={x} x2={x} y1={T} y2={y(0)} className="marker" />
            <text x={x + 3} y={T + 9} className="axis">{t.viirsStarts}</text></g>);
        })()}
      </svg>
      {tip && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.lines[0]}</b>{tip.lines.slice(1).map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
