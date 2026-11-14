import { useEffect, useState } from "react";
import type { DepartmentRow } from "@core";
import { useI18n } from "./i18n";

const TOP = 5;
const CLASS_ICON: Record<string, string> = { low: "↓", normal: "≈", high: "↑", extreme: "▲" };
const WIDE = "(min-width: 700px)";

const isWide = () => (typeof window.matchMedia === "function" ? window.matchMedia(WIDE).matches : true);

interface Props {
  rows: DepartmentRow[];
  monthLabel: string;
  /** share of the selected month's days with data; below 1 the month is in progress */
  coverage: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** "Where is fire abnormal?": every department against its own usual level for the selected month. */
export default function DepartmentRanking({ rows, monthLabel, coverage, selectedId, onSelect }: Props) {
  const { t, num, ratio } = useI18n();
  // open on wide screens, folded below 700 px; the reader can still toggle it
  const [open, setOpen] = useState(isWide);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(WIDE);
    const on = () => setOpen(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const [expanded, setExpanded] = useState(false);
  const selIdx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
  // a selected department further down the list (from a shared link) opens the full list
  useEffect(() => { if (selIdx >= TOP) setExpanded(true); }, [selIdx]);
  const shown = expanded ? rows : rows.slice(0, TOP);
  const anyLow = shown.some((r) => r.lowSignal);
  const partial = coverage < 1 || rows.some((r) => r.partial);

  return (
    <section className="ranking" aria-labelledby="ranking-title">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary><h2 id="ranking-title">{t.rankingTitle(monthLabel)}</h2></summary>
        <p className="note">{t.rankingIntro}</p>
        {partial && <p className="rk-partial">{t.partialTag(Math.round(coverage * 100))}</p>}
        <ol className="rk-list" aria-label={t.rankingAria}>
          {shown.map((r) => {
            const sel = r.id === selectedId;
            const err = r.ratio * r.relativeError;
            return (
              <li key={r.id}>
                <button type="button" className={`rk-row${sel ? " sel" : ""}${r.lowSignal ? " low" : ""}`}
                  aria-pressed={sel} onClick={() => onSelect(sel ? null : r.id)}
                  title={r.lowSignal ? t.lowSignal : undefined}>
                  <span className="rk-name">{r.name}</span>
                  {r.lowSignal ? (
                    <span className="rk-tag">{t.lowSignalTag}</span>
                  ) : (<>
                    <span className="rk-ratio">×{ratio(r.ratio)}{err >= 0.005 && <small> ±{ratio(err)}</small>}</span>
                    <span className={`rk-chip c-${r.classId}`}><span aria-hidden>{CLASS_ICON[r.classId]}</span> {t.classes[r.classId]}</span>
                  </>)}
                  <span className="rk-sub">
                    {r.lowSignal ? t.rankingCountsLow(num(r.value)) : t.rankingCounts(num(r.value), num(r.median))}
                    {r.partial && <> · {t.partialShort}</>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {rows.length > TOP && (
          <p className="meta">
            <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
              {expanded ? t.rankingShowTop(TOP) : t.rankingShowAll(rows.length)}
            </button>
          </p>
        )}
        {anyLow && <p className="note rk-foot"><b>{t.lowSignalTag}:</b> {t.lowSignal}</p>}
      </details>
    </section>
  );
}
