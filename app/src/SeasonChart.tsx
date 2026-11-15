import { useMemo, useRef, useState } from "react";
import * as H from "@core";
import { useI18n } from "./i18n";
import {
  climatologyFor, doyOf, MONTH_START_DOY, missingDoys, monthDayOf, summarizeSeason, SEASON_DAYS,
  type SeasonFile,
} from "./season";

interface Props {
  season: SeasonFile;
  zoneKind: string;
  departmentId: string | null;
  /** this year's hotspots (any area); the chart keeps the ones inside `zone` */
  hotspots: { date: string; cell: number }[];
  zone: Set<number>;
  /** last data day, "YYYY-MM-DD" (current.json meta.to) */
  to: string;
  daysWithoutData?: string[];
}

const COLORS = { now: "#eb6834", median: "#46514a", band: "#6250d6" };
const W = 440, Hh = 200, L = 44, R = 6, B = 24, T = 12;

export default function SeasonChart({ season, zoneKind, departmentId, hotspots, zone, to, daysWithoutData }: Props) {
  const { t, num, monthShort } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ doy: number; x: number; y: number } | null>(null);

  const year = +to.slice(0, 4);
  const today = doyOf(to);
  const clim = useMemo(() => climatologyFor(season, zoneKind, departmentId), [season, zoneKind, departmentId]);
  const cum = useMemo(
    () => H.currentCumulative(hotspots.filter((h) => zone.has(h.cell)), year),
    [hotspots, zone, year]);
  const missing = useMemo(() => missingDoys(year, daysWithoutData), [year, daysWithoutData]);
  const status = useMemo(() => {
    if (!clim || today === null) return null;
    return summarizeSeason(H.seasonStatus(cum, clim, today), cum[today - 1], clim.p50[today - 1]);
  }, [clim, cum, today]);

  if (today === null) return null;

  const max = Math.max(1, cum[today - 1], ...(clim ? clim.p90 : [0])) * 1.05;
  const x = (doy: number) => L + ((doy - 1) / (SEASON_DAYS - 1)) * (W - L - R);
  const y = (v: number) => T + (Hh - T - B) * (1 - v / max);
  const step = (() => {
    const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
  })();
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const fmtTick = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${v}`);

  const line = (arr: ArrayLike<number>, to_: number) => {
    let d = "";
    for (let i = 0; i < to_; i++) d += `${i ? "L" : "M"}${x(i + 1).toFixed(1)} ${y(arr[i]).toFixed(1)}`;
    return d;
  };
  const band = clim ? (() => {
    let d = "";
    for (let i = 0; i < SEASON_DAYS; i++) d += `${i ? "L" : "M"}${x(i + 1).toFixed(1)} ${y(clim.p90[i]).toFixed(1)}`;
    for (let i = SEASON_DAYS - 1; i >= 0; i--) d += `L${x(i + 1).toFixed(1)} ${y(clim.p10[i]).toFixed(1)}`;
    return `${d}Z`;
  })() : null;

  const locate = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const doy = Math.round(1 + ((vx - L) / (W - L - R)) * (SEASON_DAYS - 1));
    if (vx < L - 4 || vx > W + 4) { setHover(null); return; }
    setHover({ doy: Math.min(SEASON_DAYS, Math.max(1, doy)), x: e.clientX, y: e.clientY });
  };

  const tipLines = (doy: number) => {
    const { month, day } = monthDayOf(doy);
    const lines = [`${day} ${monthShort(month)}`];
    if (doy <= today) {
      lines.push(`${t.seasonYearCount(year)}: ${num(cum[doy - 1])}${missing.has(doy) ? ` (${t.seasonNoData})` : ""}`);
      if (missing.has(doy)) lines.push(t.seasonNoDataDay);
    }
    if (clim) {
      lines.push(`${t.seasonMedianCount}: ${num(clim.p50[doy - 1])}`);
      lines.push(`${t.seasonRangeCount}: ${num(clim.p10[doy - 1])}–${num(clim.p90[doy - 1])}`);
    }
    return lines;
  };

  const flip = hover !== null && hover.x > window.innerWidth / 2;
  return (
    <div className="seasonchart" onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}>
      <div className="chart-legend">
        <span><i style={{ background: COLORS.now }} />{year}</span>
        {clim && <>
          <span><i style={{ background: COLORS.median }} />{t.seasonLegendMedian}</span>
          <span><i style={{ background: COLORS.band, opacity: 0.3 }} />{t.seasonLegendBand}</span>
        </>}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={t.seasonAria(year)}
        onPointerMove={locate} onPointerDown={locate}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={L} x2={W - R} y1={y(tk)} y2={y(tk)} className="gridline" />
            <text x={L - 6} y={y(tk) + 4} className="axis" textAnchor="end">{fmtTick(tk)}</text>
          </g>
        ))}
        {MONTH_START_DOY.map((d, i) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={y(0)} y2={y(0) + 4} className="baseline" />
            <text x={x(d) + ((x(i < 11 ? MONTH_START_DOY[i + 1] : SEASON_DAYS + 1) - x(d)) / 2)} y={Hh - 7} className="axis" textAnchor="middle">
              {monthShort(i + 1)}
            </text>
          </g>
        ))}
        {band && <path d={band} fill={COLORS.band} opacity={0.22} />}
        {clim && <path d={line(clim.p50, SEASON_DAYS)} fill="none" stroke={COLORS.median} strokeWidth={1.6} strokeDasharray="5 3" />}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="baseline" />
        {[...missing].filter((d) => d <= today).map((d) => (
          <line key={d} x1={x(d)} x2={x(d)} y1={y(0) - 5} y2={y(0)} className="nodata-tick" />
        ))}
        <path d={line(cum, today)} fill="none" stroke={COLORS.now} strokeWidth={2.4} strokeLinejoin="round" />
        <line x1={x(today)} x2={x(today)} y1={T} y2={y(0)} className="marker" />
        <text x={x(today) + (x(today) > W * 0.7 ? -4 : 4)} y={T + 9} className="axis"
          textAnchor={x(today) > W * 0.7 ? "end" : "start"}>{t.seasonToday}</text>
        <circle cx={x(today)} cy={y(cum[today - 1])} r={3.5} fill={COLORS.now} />
        {hover && (
          <g pointerEvents="none">
            <line x1={x(hover.doy)} x2={x(hover.doy)} y1={T} y2={y(0)} className="hoverline" />
            {hover.doy <= today && <circle cx={x(hover.doy)} cy={y(cum[hover.doy - 1])} r={3} fill="#fff" stroke={COLORS.now} strokeWidth={1.8} />}
          </g>
        )}
      </svg>
      {hover && (
        <div className="tooltip" style={flip
          ? { right: window.innerWidth - hover.x + 14, top: hover.y + 14 }
          : { left: hover.x + 14, top: hover.y + 14 }}>
          <b>{tipLines(hover.doy)[0]}</b>{tipLines(hover.doy).slice(1).map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
      {status && <p className="season-status" aria-live="polite">{t.seasonStatus(status)}</p>}
      {!clim && <p className="note">{t.seasonNoClim}</p>}
      <p className="note">{t.seasonCaption}</p>
    </div>
  );
}
