import { useState } from "react";
import type { ProtectedSummary } from "@core";
import { useI18n } from "./i18n";

const TOP = 8;
const CLASS_ICON: Record<string, string> = { low: "↓", normal: "≈", high: "↑", extreme: "▲" };
/** below this a row would print as 0: counted as "practically no fire" instead of listed */
const LISTED_MIN = 0.5;

interface Props {
  /** which statistics layer: protected areas (WDPA) or indigenous territories (LandMark); same block, other wording */
  layer?: "protected" | "indigenous";
  /** null when there are no figures: see `note` */
  summary: ProtectedSummary | null;
  /** why there are no figures: a custom area, or a month later than the data */
  note: "custom" | "late" | "stale" | null;
  /** last month with protected-area data, e.g. "Oct 2026" */
  throughLabel: string;
  /** last day the figures cover, "YYYY-MM-DD" */
  asOf: string;
  zoneLabel: string;
  /** context.json / indigenous.json meta.source */
  source: string;
  coverage: number;
}

/**
 * "Protected areas" / "Indigenous territories": the areas that overlap the selected zone, with the fire inside each for the selected
 * month. Folded by default.
 */
export default function ProtectedAreas({ layer = "protected", summary, note, throughLabel, zoneLabel, source, coverage, asOf }: Props) {
  const { t, num, ratio } = useI18n();
  const ind = layer === "indigenous";
  const L = ind
    ? { title: t.indTitle, custom: t.indCustom, late: t.indLate, stale: t.indStale, intro: t.indIntro, none: t.indNone, showAll: t.indShowAll,
        noRatio: t.indNoRatio, quiet: t.indQuiet, tiny: t.indTiny, source: t.indSource }
    : { title: t.protTitle, custom: t.protCustom, late: t.protLate, stale: t.protStale, intro: t.protIntro, none: t.protNone, showAll: t.protShowAll,
        noRatio: t.protNoRatio, quiet: t.protQuiet, tiny: t.protTiny, source: t.protSource };
  const [expanded, setExpanded] = useState(false);
  const listed = summary ? summary.areas.filter((a) => a.value >= LISTED_MIN) : [];
  const quiet = summary ? summary.areas.length - listed.length : 0;
  const shown = expanded ? listed : listed.slice(0, TOP);
  const anyNoRatio = shown.some((a) => a.lowSignal);

  return (
    <section className={`ranking protected${ind ? " indigenous" : ""}`} aria-labelledby={`${layer}-title`}>
      <details>
        <summary><h2 id={`${layer}-title`}>{L.title}</h2></summary>
        {note === "custom" && <p className="note">{L.custom}</p>}
        {note === "late" && <p className="note">{L.late(throughLabel)}</p>}
        {note === "stale" && <p className="note">{L.stale(asOf)}</p>}
        {summary && (<>
          <p className="note">{L.intro(zoneLabel)}</p>
          {coverage < 1 && <p className="rk-partial">{t.partialTag(Math.round(coverage * 100))}</p>}
          {listed.length === 0 && <p className="note">{L.none}</p>}
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
                    <span className="rk-tag" title={L.noRatio}>{t.lowSignalTag}</span>
                  )}
                  <span className="rk-sub">{t.rankingCountsLow(num(a.value))}{ind && (a.category || a.ethnicity) && <> · {[a.category, a.ethnicity].filter(Boolean).join(" · ")}</>}</span>
                </li>
              );
            })}
          </ul>
          {listed.length > TOP && (
            <p className="meta">
              <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
                {expanded ? t.rankingShowTop(TOP) : L.showAll(listed.length)}
              </button>
            </p>
          )}
          {anyNoRatio && <p className="note rk-foot"><b>{t.lowSignalTag}:</b> {L.noRatio}</p>}
          {quiet > 0 && <p className="note rk-foot">{L.quiet(quiet)}</p>}
          <p className="note rk-foot">{L.tiny}</p>
          <p className="note rk-foot">{L.source(source)}</p>
        </>)}
      </details>
    </section>
  );
}
