import * as H from "@core";
import type { Grid, Series } from "@core";
import type { I18n } from "./i18n";
import { BINS, binOf, COUNT_COLORS, countScale, type CalMode } from "./Calendar";
import { C, yearTotals } from "./YearChart";
import type { RangeAnalytics } from "./analytics";

interface ReportInput {
  grid: Grid; series: Series; coverage: (m: number) => number; i18n: I18n;
  zoneLabel: string; range: [number, number]; rangeLabel: string; mode: CalMode;
  analytics: RangeAnalytics; lines: string[];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Draws a shareable PNG report (calendar + yearly chart + range analytics) and downloads it. */
export async function downloadReport(p: ReportInput, filename: string) {
  const { grid, series, coverage, i18n, mode, range } = p;
  const { t, num } = i18n;
  const meta = grid.meta;
  const cal = H.calendar(grid, series.harmonized);
  const scale = countScale([...series.harmonized, ...cal.monthlyMedian]);
  const rows = [...cal.rows].reverse();
  const years = yearTotals(grid, series);

  const W = 1200, pad = 48, cellW = 62, cellH = 17, gap = 3, labelW = 54;
  const calTop = 300, calH = (rows.length + (mode === "count" ? 1 : 0)) * (cellH + gap) + 30;
  const chartTop = calTop + calH + 90, chartH = 230;
  const Hh = chartTop + chartH + 110;
  const cv = document.createElement("canvas");
  const dpr = 2;
  cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  g.fillStyle = "#fcfcfb"; g.fillRect(0, 0, W, Hh);

  // header
  g.fillStyle = "#1d1b19"; g.fillRect(0, 0, W, 96);
  g.fillStyle = "#f9b36e"; g.beginPath(); g.arc(pad + 12, 48, 12, 0, 2 * Math.PI); g.fill();
  g.fillStyle = "#f0efec"; g.font = `700 28px ${FONT}`; g.fillText(t.reportTitle, pad + 38, 46);
  g.fillStyle = "#c3c2b7"; g.font = `15px ${FONT}`; g.fillText(`${p.zoneLabel} · ${p.rangeLabel}`, pad + 38, 72);

  // analytics block
  g.fillStyle = "#0b0b0b"; g.font = `700 34px ${FONT}`;
  g.fillText(`${num(p.analytics.total)} ${t.hotspots}`, pad, 150);
  g.font = `16px ${FONT}`; g.fillStyle = "#52514e";
  p.lines.forEach((l, i) => g.fillText(l, pad, 182 + i * 24));

  // calendar
  g.fillStyle = "#0b0b0b"; g.font = `600 15px ${FONT}`;
  g.fillText(`${t.calendarTitle(p.zoneLabel)} · ${mode === "ratio" ? t.calModeRatio : t.calModeCount}`, pad, calTop - 26);
  g.font = `12px ${FONT}`; g.fillStyle = "#898781";
  for (let i = 0; i < 12; i++) g.fillText(i18n.monthShort(i + 1), pad + labelW + i * (cellW + gap) + 18, calTop - 6);
  let y = calTop;
  const drawRow = (label: string, colors: (string | null)[], dims: boolean[], hatch: boolean[]) => {
    g.fillStyle = "#52514e"; g.font = `12px ${FONT}`; g.fillText(label, pad, y + 13);
    colors.forEach((c, i) => {
      if (!c) return;
      const x = pad + labelW + i * (cellW + gap);
      g.globalAlpha = dims[i] ? 0.45 : 1;
      g.fillStyle = c; g.beginPath(); g.roundRect(x, y, cellW, cellH, 3); g.fill();
      if (hatch[i]) {
        g.save(); g.clip(); g.strokeStyle = "rgba(255,255,255,0.45)"; g.lineWidth = 1.5;
        for (let k = -cellH; k < cellW; k += 5) { g.beginPath(); g.moveTo(x + k, y + cellH); g.lineTo(x + k + cellH, y); g.stroke(); }
        g.restore();
      }
      g.globalAlpha = 1;
    });
    y += cellH + gap;
  };
  if (mode === "count") drawRow(t.typicalRow, cal.monthlyMedian.map((v) => scale.colorOf(v)), Array(12).fill(false), Array(12).fill(false));
  for (const row of rows) {
    const colors: (string | null)[] = [], dims: boolean[] = [], hatch: boolean[] = [];
    row.cells.forEach((c, i) => {
      const cov = c ? coverage(c.m) : 0;
      if (!c || cov === 0 || c.noData) { colors.push(null); dims.push(false); hatch.push(false); return; }
      const med = cal.monthlyMedian[i] * cov;
      const ratio = med > 0 ? c.value / med : c.value > 0 ? 9 : 1;
      colors.push(mode === "ratio" ? binOf(ratio).color : scale.colorOf(c.value));
      dims.push(c.m < range[0] || c.m > range[1]);
      hatch.push(c.relativeError > 0);
    });
    drawRow(String(row.year), colors, dims, hatch);
  }
  // legend
  let lx = pad + labelW; y += 10; g.font = `12px ${FONT}`;
  const legend = mode === "ratio"
    ? BINS.map((b) => [b.color, b.label === "≈ normal" ? t.normalBin : b.label] as const)
    : [0, ...scale.thresholds].map((th, k, arr) => [COUNT_COLORS[Math.min(k, COUNT_COLORS.length - 1)],
        k === arr.length - 1 ? `${num(th)}+` : `${num(k === 0 ? 1 : th)}–${num(arr[k + 1])}`] as const);
  for (const [c, l] of legend) {
    g.fillStyle = c; g.fillRect(lx, y, 12, 12); g.fillStyle = "#52514e"; g.fillText(l, lx + 16, y + 11);
    lx += 22 + g.measureText(l).width;
  }

  // yearly chart (harmonized)
  g.fillStyle = "#0b0b0b"; g.font = `600 15px ${FONT}`; g.fillText(`${t.perYear} · ${t.harmonized}`, pad, chartTop - 18);
  const max = Math.max(...years.map((d) => d.h + d.err)) * 1.08 || 1;
  const bw = (W - 2 * pad - 40) / years.length;
  const yy = (v: number) => chartTop + chartH * (1 - v / max);
  g.strokeStyle = "#e1e0d9"; g.lineWidth = 1;
  const raw = max / 4, p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((s) => s >= raw) ?? 10 * p10;
  for (let v = 0; v <= max; v += step) {
    const py = yy(v);
    g.beginPath(); g.moveTo(pad + 40, py); g.lineTo(W - pad, py); g.stroke();
    g.fillStyle = "#898781"; g.font = `11px ${FONT}`;
    g.fillText(v >= 1000 ? `${Math.round(v / 1000)}k` : num(v), pad, py + 4);
  }
  years.forEach((d, i) => {
    const x = pad + 40 + i * bw;
    g.fillStyle = d.translated ? C.translated : C.observed;
    g.beginPath(); g.roundRect(x + 2, yy(d.h), bw - 4, chartTop + chartH - yy(d.h), [3, 3, 0, 0]); g.fill();
    if (d.err) {
      g.strokeStyle = "#0b0b0b"; g.beginPath(); g.moveTo(x + bw / 2, yy(d.h + d.err)); g.lineTo(x + bw / 2, yy(Math.max(0, d.h - d.err))); g.stroke();
    }
    if (d.year % 4 === 2 || i === years.length - 1) { g.fillStyle = "#898781"; g.font = `11px ${FONT}`; g.fillText(String(d.year), x + bw / 2 - 14, chartTop + chartH + 16); }
  });
  g.font = `12px ${FONT}`;
  [[C.translated, t.legendTranslated], [C.observed, t.legendObserved]].forEach(([c, l], k) => {
    g.fillStyle = c; g.fillRect(pad + 40 + k * 360, chartTop + chartH + 30, 12, 12);
    g.fillStyle = "#52514e"; g.fillText(l, pad + 58 + k * 360, chartTop + chartH + 41);
  });

  // footer
  g.fillStyle = "#898781"; g.font = `12px ${FONT}`;
  g.fillText(t.reportFooter, pad, Hh - 24);
  g.fillText(meta.months.first ? `${new Date().toISOString().slice(0, 10)}` : "", W - pad - 70, Hh - 24);

  const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
