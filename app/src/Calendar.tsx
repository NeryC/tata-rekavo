import { useMemo, useState } from "react";
import * as H from "@core";
import type { Grid } from "@core";
import { fmt } from "./data";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// diverging blue <-> red around "normal" (ratio to the median of the same calendar month)
export const BINS: { max: number; color: string; label: string }[] = [
  { max: 0.25, color: "#1c5cab", label: "<¼×" },
  { max: 0.5, color: "#3987e5", label: "¼–½×" },
  { max: 0.67, color: "#86b6ef", label: "½–⅔×" },
  { max: 0.85, color: "#cde2fb", label: "⅔–0.85×" },
  { max: 1.18, color: "#f0efec", label: "≈ normal" },
  { max: 1.5, color: "#f6c9c8", label: "1.2–1.5×" },
  { max: 2, color: "#ee9190", label: "1.5–2×" },
  { max: 3, color: "#e34948", label: "2–3×" },
  { max: Infinity, color: "#a52727", label: ">3×" },
];
export const binOf = (r: number) => BINS.find((b) => r < b.max) ?? BINS[BINS.length - 1];

interface Props {
  grid: Grid;
  series: Float64Array;
  coverage: (m: number) => number;
  selected: number;
  onSelect: (m: number) => void;
}

export default function Calendar({ grid, series, coverage, selected, onSelect }: Props) {
  const cal = useMemo(() => H.calendar(grid, series), [grid, series]);
  const [tip, setTip] = useState<{ x: number; y: number; html: string[] } | null>(null);
  const rows = [...cal.rows].reverse();

  return (
    <div className="calendar" onMouseLeave={() => setTip(null)}>
      <div className="cal-grid" role="grid" aria-label="Burning calendar: months by year, colored by ratio to the usual level">
        <div className="cal-head" role="row">
          <span />
          {MONTHS.map((l, i) => <span key={i} className="cal-mh" role="columnheader" aria-label={MONTH_NAMES[i]}>{l}</span>)}
          <span className="cal-mh total">year</span>
        </div>
        {rows.map((row) => (
          <div className="cal-row" role="row" key={row.year}>
            <span className="cal-year">{row.year}</span>
            {row.cells.map((c, i) => {
              if (!c) return <span key={i} className="cal-cell empty" />;
              const cov = coverage(c.m);
              if (cov === 0) return <span key={i} className="cal-cell empty" />;
              const med = cal.monthlyMedian[i] * cov;
              const ratio = med > 0 ? c.value / med : c.value > 0 ? 9 : 1;
              const b = binOf(ratio);
              const err = c.relativeError;
              const lines = [
                `${MONTH_NAMES[i]} ${row.year}${cov < 1 ? ` (first ${Math.round(cov * 100)}% of month)` : ""}`,
                `${fmt(c.value)} hotspots${err > 0 ? ` ±${Math.round(err * 100)}%` : ""}`,
                `×${ratio.toFixed(2)} vs usual ${MONTH_NAMES[i]} (${fmt(med)})`,
                err > 0 ? "translated from MODIS Aqua" : "observed by VIIRS",
              ];
              return (
                <button key={i} role="gridcell" aria-label={lines.join(", ")} aria-selected={c.m === selected}
                  className={`cal-cell${c.m === selected ? " sel" : ""}${err > 0 ? " translated" : ""}${cov < 1 ? " partial" : ""}`}
                  style={{ background: b.color }}
                  onClick={() => onSelect(c.m)}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, html: lines })} />
              );
            })}
            <span className="cal-total">{row.total >= 1000 ? `${Math.round(row.total / 1000)}k` : fmt(row.total)}</span>
          </div>
        ))}
      </div>
      <div className="cal-legend" aria-label="Calendar legend">
        {BINS.map((b) => <span key={b.label}><i style={{ background: b.color }} />{b.label}</span>)}
      </div>
      <p className="note">Each square compares a month with the median of the same month over 2002–2026. Hatched squares (before Feb 2012) are reconstructed from MODIS.</p>
      {tip && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.html[0]}</b>{tip.html.slice(1).map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
