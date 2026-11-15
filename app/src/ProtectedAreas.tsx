import { useState } from "react";
import type { ProtectedSummary } from "@core";
import { useI18n } from "./i18n";

const TOP = 8;
const CLASS_ICON: Record<string, string> = { low: "↓", normal: "≈", high: "↑", extreme: "▲" };
/** below this a row would print as 0: counted as "practically no fire" instead of listed */
const LISTED_MIN = 0.5;

interface Props {
  /** null when there are no figures: see `note` */
  summary: ProtectedSummary | null;
  /** why there are no figures: a custom area, or a month later than the data */
  note: "custom" | "late" | "stale" | null;
  /** last month with protected-area data, e.g. "Oct 2026" */
  throughLabel: string;
  /** last day the figures cover, "YYYY-MM-DD" */
  asOf: string;
  zoneLabel: string;
  /** context.json meta.source */
  source: string;
  coverage: number;
}

/** "Protected areas": the areas that overlap the selected zone, with the fire inside each for the selected month. Folded by default. */
export default function ProtectedAreas({ summary, note, throughLabel, zoneLabel, source, coverage, asOf }: Props) {
  const { t, num, ratio } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const listed = summary ? summary.areas.filter((a) => a.value >= LISTED_MIN) : [];
  const quiet = summary ? summary.areas.length - listed.length : 0;
  const shown = expanded ? listed : listed.slice(0, TOP);
  const anyNoRatio = shown.some((a) => a.lowSignal);

  return (
    <section className="ranking protected" aria-labelledby="protected-title">
      <details>
        <summary><h2 id="protected-title">{t.protTitle}</h2></summary>
        {note === "custom" && <p className="note">{t.protCustom}</p>}
        {note === "late" && <p className="note">{t.protLate(throughLabel)}</p>}
        {note === "stale" && <p className="note">{t.protStale(asOf)}</p>}
        {summary && (<>
          <p className="note">{t.protIntro(zoneLabel)}</p>
          {coverage < 1 && <p className="rk-partial">{t.partialTag(Math.round(coverage * 100))}</p>}
          {listed.length === 0 && <p className="note">{t.protNone}</p>}
          <ul className="rk-list pa-list">
            {shown.map((a) => {
              const compared = !a.lowSignal && a.ratio !== null && a.classId !== null;
              return (
                <li key={a.id} className="rk-row pa-row">
                  <span className="rk-name">{a.name}</span>
                  {compared ? (<>
                    <span className="rk-ratio">×{ratio(a.ratio as number)}</span>
                    <span className={`rk-chip c-${a.classId}`}><span aria-hidden>{CLASS_ICON[a.classId as string]}</span> {t.classes[a.classId as string]}</span>
                  </>) : (
                    <span className="rk-tag" title={t.protNoRatio}>{t.lowSignalTag}</span>
                  )}
                  <span className="rk-sub">{t.rankingCountsLow(num(a.value))}</span>
                </li>
              );
            })}
          </ul>
          {listed.length > TOP && (
            <p className="meta">
              <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
                {expanded ? t.rankingShowTop(TOP) : t.protShowAll(listed.length)}
              </button>
            </p>
          )}
          {anyNoRatio && <p className="note rk-foot"><b>{t.lowSignalTag}:</b> {t.protNoRatio}</p>}
          {quiet > 0 && <p className="note rk-foot">{t.protQuiet(quiet)}</p>}
          <p className="note rk-foot">{t.protTiny}</p>
          <p className="note rk-foot">{t.protSource(source)}</p>
        </>)}
      </details>
    </section>
  );
}
