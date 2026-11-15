import { useMemo, useState } from "react";
import * as H from "@core";
import type { Grid } from "@core";
import { useI18n } from "./i18n";
import { calendarTarget } from "./calendarNavigation";

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

// sequential warm ramp for counts (one hue family, light = few, dark = many)
export const COUNT_COLORS = ["#fdf0e0", "#fbd3a6", "#f8b072", "#f08a44", "#dc6223", "#b2401a", "#7f1d0a"];
const nice = (v: number) => {
  if (v < 10) return Math.max(1, Math.round(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
};
/** Count thresholds from the zone's own distribution (quantiles of non-zero months), rounded. */
export function countScale(values: number[]) {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!nz.length) return { thresholds: [1], colorOf: (_v: number) => COUNT_COLORS[0] };
  const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))];
  const thresholds = [...new Set([0.15, 0.3, 0.5, 0.7, 0.85, 0.95].map((p) => nice(q(p))))];
  const colorOf = (v: number) => {
    if (v <= 0) return "#f7f6f2";
    let i = 0;
    while (i < thresholds.length && v >= thresholds[i]) i++;
    return COUNT_COLORS[Math.min(i, COUNT_COLORS.length - 1)];
  };
  return { thresholds, colorOf };
}

export type CalMode = "ratio" | "count";

interface Props {
  grid: Grid;
  series: Float64Array;
  coverage: (m: number) => number;
  selected: number;
  onSelect: (m: number) => void;
  mode: CalMode;
  range: [number, number];
}

export default function Calendar({ grid, series, coverage, selected, onSelect, mode, range }: Props) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const cal = useMemo(() => H.calendar(grid, series), [grid, series]);
  const scale = useMemo(() => countScale([...series, ...cal.monthlyMedian]), [series, cal]);
  const [tip, setTip] = useState<{ x: number; y: number; html: string[] } | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const rows = [...cal.rows].reverse();
  const available = rows.flatMap(row => row.cells.filter(c => c && coverage(c.m) !== 0).map(c => c!.m));
  const tabMonth = focused !== null && available.includes(focused) ? focused : available.includes(selected) ? selected : available[0];
  const binLabel = (l: string) => (l === "≈ normal" ? t.normalBin : i18n.lang === "es" ? l.replace(".", ",") : l);
  const typicalTotal = cal.monthlyMedian.reduce((a, b) => a + b, 0);
  const rangeIsAll = range[0] <= 0 && range[1] >= grid.nMonths - 1;
  const classMax = (id: string) => grid.meta.classes.find((c) => c.id === id)?.max ?? (id === "low" ? 0.5 : 1.5);

  return (
    <div className="calendar" onMouseLeave={() => setTip(null)}>
      <p className="cal-instructions">{t.calendarInstructions}</p>
      <div className="cal-scroll"><div className="cal-grid" role="grid" aria-label={t.calendarAria} onKeyDown={(e) => {
        const current = Number((e.target as HTMLElement).dataset.month);
        if (!Number.isFinite(current)) return;
        const target = calendarTarget(available, current, e.key);
        if (target === null) return;
        e.preventDefault();
        (e.currentTarget.querySelector(`[data-month="${target}"]`) as HTMLButtonElement | null)?.focus();
      }}>
        <div className="cal-head" role="row">
          <span />
          {i18n.initials.map((l, i) => <span key={i} className="cal-mh" role="columnheader" aria-label={i18n.monthShort(i + 1)}>{l}</span>)}
          <span className="cal-mh total">{t.year}</span>
        </div>
        {mode === "count" && (
          <div className="cal-row typical" role="row">
            <span className="cal-year">{t.typicalRow}</span>
            {cal.monthlyMedian.map((v, i) => (
              <span key={i} role="gridcell" className="cal-cell static" style={{ background: scale.colorOf(v) }}
                aria-label={`${t.typicalRow} ${i18n.monthShort(i + 1)}: ${num(v)}`}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, html: [`${i18n.monthShort(i + 1)}, ${t.typicalRow}`, `${num(v)} ${t.hotspots}`] })} />
            ))}
            <span className="cal-total">{typicalTotal >= 1000 ? `${Math.round(typicalTotal / 1000)}k` : num(typicalTotal)}</span>
          </div>
        )}
        {rows.map((row) => (
          <div className="cal-row" role="row" key={row.year}>
            <span className="cal-year">{row.year}</span>
            {row.cells.map((c, i) => {
              if (!c) return <span key={i} className="cal-cell empty" />;
              const cov = coverage(c.m);
              if (cov === 0) return <span key={i} className="cal-cell empty" />;
              if (c.noData) { // a month the active measure has no data for: not zero, and still selectable
                const label = `${i18n.monthLabel(row.year, i + 1)}, ${t.calNoData}`;
                return (
                  <button key={i} role="gridcell" aria-label={label} aria-selected={c.m === selected} data-month={c.m} tabIndex={c.m === tabMonth ? 0 : -1} onFocus={() => setFocused(c.m)}
                    className={`cal-cell nodata${c.m === selected ? " sel" : ""}`} onClick={() => onSelect(c.m)}
                    onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, html: [i18n.monthLabel(row.year, i + 1), t.calNoData] })} />
                );
              }
              const med = cal.monthlyMedian[i] * cov;
              const ratio = med > 0 ? c.value / med : c.value > 0 ? 9 : 1;
              const color = mode === "ratio" ? binOf(ratio).color : scale.colorOf(c.value);
              const err = c.relativeError;
              const out = c.m < range[0] || c.m > range[1];
              // "Modo Catador": turns the model uncertainty into a field-validation hint.
              // An anomaly is "robust" when it keeps its class across the whole error band.
              const cat = t.catador;
              const hiMin = classMax("normal"), loMax = classMax("low");
              const lo = ratio * (1 - err), hi = ratio * (1 + err);
              const r2 = (x: number) => i18n.ratio(x);
              const catadorInsight = cov < 1 ? cat.partial(Math.round(cov * 100))
                : ratio >= hiMin ? (err === 0 ? cat.highObserved : lo >= hiMin ? cat.highRobust(r2(lo)) : cat.highUncertain(r2(lo), r2(hi)))
                : ratio < loMax ? (err === 0 || hi < loMax ? cat.lowRobust : cat.lowUncertain(r2(lo), r2(hi)))
                : cat.normal;
              const lines = [
                `${i18n.monthLabel(row.year, i + 1)}${cov < 1 ? t.calFirstPct(Math.round(cov * 100)) : ""}`,
                `${num(c.value)} ${t.hotspots}${err > 0 ? ` ±${Math.round(err * 100)}%` : ""}`,
                t.calVsUsual(i18n.ratio(ratio), i18n.monthShort(i + 1), num(med)),
                err > 0 ? cat.harmonizedBy : cat.observedDirect,
                ...(out ? [t.outOfRange] : []),
                "────────────────────",
                `🐺 ${catadorInsight}`,
              ];
              return (
                <button key={i} role="gridcell" aria-label={lines.join(", ")} aria-selected={c.m === selected} data-month={c.m} tabIndex={c.m === tabMonth ? 0 : -1} onFocus={() => setFocused(c.m)}
                  className={`cal-cell${c.m === selected ? " sel" : ""}${err > 0 ? " translated" : ""}${cov < 1 ? " partial" : ""}${!out && !rangeIsAll ? " in" : ""}`}
                  style={{ background: color }}
                  onClick={() => onSelect(c.m)}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, html: lines })} />
              );
            })}
            <span className="cal-total">{row.cells.every((c) => !c || c.noData) ? "—" : row.total >= 1000 ? `${Math.round(row.total / 1000)}k` : num(row.total)}</span>
          </div>
        ))}
      </div></div>
      <div className="cal-legend">
        {mode === "ratio"
          ? BINS.map((b) => <span key={b.label}><i style={{ background: b.color }} />{binLabel(b.label)}</span>)
          : [0, ...scale.thresholds].map((th, k, arr) => (
            <span key={k}><i style={{ background: COUNT_COLORS[Math.min(k, COUNT_COLORS.length - 1)] }} />
              {k === arr.length - 1 ? `${num(th)}+` : `${num(k === 0 ? 1 : th)}–${num(arr[k + 1])}`}</span>
          ))}
      </div>
      {!rangeIsAll && <p className="cal-key"><i className="in-key" />{t.rangeKey}</p>}
      <p className="note">{mode === "ratio" ? t.calNote : t.calNoteCount}</p>
      {tip && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.html[0]}</b>{tip.html.slice(1).map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

