import { useI18n } from "./i18n";
import type { Hotspot } from "./data";
import { describeHotspot, formatAcquired, windowCoverage, type HotspotWindow } from "./hotspotTime";
import { formatUpdated } from "./format";

const LIST_MAX = 50;

interface Props {
  win: HotspotWindow;
  onWin: (w: HotspotWindow) => void;
  /** the points the map shows for this window (whole country) */
  points: Hotspot[];
  /** hotspots of the recent days whose time is unknown: they cannot be placed in an exact window */
  untimed: number;
  now: Date;
  generated: string | undefined;
  timeZone: string;
  zone: Set<number>;
  zoneLabel: string;
  ready: boolean;
}

/** What the map points show (the selected month or a rolling window), their coverage and an accessible list of them. */
export default function HotspotWindowPanel(p: Props) {
  const { t, num, lang } = useI18n();
  const label = (at: string) => { const f = formatAcquired(at.slice(0, 10), at, lang, p.timeZone); return `${f.date}, ${f.time} (${f.zone})`; };
  const cov = p.win === "month" ? null : windowCoverage(p.points.flatMap((h) => (h.at ? [h.at] : [])), p.win, p.now, p.generated);
  const inZone = p.points.filter((h) => p.zone.has(h.cell))
    .sort((a, b) => ((b.at ?? b.date) > (a.at ?? a.date) ? 1 : (b.at ?? b.date) < (a.at ?? a.date) ? -1 : 0));
  const shown = inZone.slice(0, LIST_MAX);
  const options: [HotspotWindow, string][] = [["month", t.winMonth], ["24h", t.win24h], ["7d", t.win7d]];

  return (
    <section className="hs-window">
      <h2>{t.winTitle}</h2>
      <div className="seg area" role="group" aria-label={t.winLabel}>
        {options.map(([w, l]) => (
          <button key={w} type="button" aria-pressed={p.win === w} className={p.win === w ? "on" : ""} onClick={() => p.onWin(w)}>{l}</button>
        ))}
      </div>
      {cov && p.ready && (
        <div role="status">
          <p className="stat">{cov.count > 0 && cov.first && cov.last ? t.winCoverage(num(cov.count), label(cov.first), label(cov.last)) : t.winNone}</p>
          {cov.behind && p.generated && <p className="note">{t.winBehind(formatUpdated(p.generated, lang, p.timeZone))}</p>}
          {p.untimed > 0 && <p className="note">{t.winUntimed(num(p.untimed))}</p>}
          <p className="note">{t.winLatency}</p>
        </div>
      )}
      <p className="note">{t.winNote}</p>
      {p.ready && p.points.length > 0 && (
        <details className="hs-list">
          <summary>{t.hsListTitle(p.zoneLabel)}</summary>
          {shown.length === 0 ? <p className="note">{t.hsListEmpty(p.zoneLabel)}</p> : (<>
            {inZone.length > LIST_MAX && <p className="note">{t.hsListMore(num(LIST_MAX), num(inZone.length))}</p>}
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">{t.hsWhen}</th><th scope="col">{t.hsSensor}</th><th scope="col">{t.hsConfidence}</th><th scope="col">{t.hsProduct}</th></tr></thead>
                <tbody>
                  {shown.map((h, i) => {
                    const d = describeHotspot(h, lang, p.timeZone, t);
                    return <tr key={i}><td>{d.when}</td><td>{d.sensor}</td><td>{d.confidence}</td><td>{d.product}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </>)}
        </details>
      )}
    </section>
  );
}
