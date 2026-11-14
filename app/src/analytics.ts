import * as H from "@core";
import type { Grid, Series } from "@core";

export interface RangeAnalytics {
  total: number; typical: number; ratio: number; err: number;
  above: number; below: number; months: number;
  peak: { m: number; v: number };
  partial: boolean;
}

/** Totals and anomalies over a month range for a zone series. */
export function rangeAnalytics(grid: Grid, series: Series, coverage: (m: number) => number, from: number, to: number): RangeAnalytics {
  const meta = grid.meta;
  const med = H.calendar(grid, series.harmonized).monthlyMedian;
  const r: RangeAnalytics = { total: 0, typical: 0, ratio: 0, err: 0, above: 0, below: 0, months: 0, peak: { m: -1, v: -1 }, partial: false };
  let err2 = 0;
  for (let m = Math.max(0, from); m <= Math.min(to, grid.nMonths - 1); m++) {
    const cov = coverage(m);
    if (cov === 0) continue;
    const v = series.harmonized[m];
    const typ = med[H.monthOf(meta, m).month - 1] * cov;
    r.total += v; r.typical += typ; r.months++;
    err2 += (H.relativeError(meta, m, v) * v) ** 2;
    const cls = H.classify(meta, typ > 0 ? v / typ : v > 0 ? 9 : 1).id;
    if (cls === "high" || cls === "extreme") r.above++;
    if (cls === "low") r.below++;
    if (v > r.peak.v) r.peak = { m, v };
    if (cov < 1) r.partial = true;
  }
  r.ratio = r.typical > 0 ? r.total / r.typical : 0;
  r.err = Math.sqrt(err2);
  return r;
}
