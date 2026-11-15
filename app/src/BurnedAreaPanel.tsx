import { useI18n } from "./i18n";
import { burnedFigures, type BurnedAreaFile } from "./burnedArea";

interface Props {
  doc: BurnedAreaFile;
  /** "paraguay" or a department id; anything else has no figure */
  zone: string;
  zoneLabel: string;
  year: number;
  month: number;
}

/** Estimated burned surface of the selected area and month, a historical product kept apart from the hotspots. */
export default function BurnedAreaPanel(p: Props) {
  const { t, num, monthLongLabel } = useI18n();
  const f = burnedFigures(p.doc, p.zone, p.year, p.month);
  const series = p.doc.zones[p.zone]?.annual;
  const ha = (v: number) => num(Math.round(v));

  return (
    <section className="burned-area">
      <details>
        <summary><h2>{t.baTitle}</h2></summary>
        {f.status === "no-zone" ? <p className="note">{t.baNoZone}</p>
          : f.status === "after" ? <p className="note">{t.baAfter(p.doc.last_year)}</p>
          : f.status === "before" ? <p className="note">{t.baBefore(p.doc.first_year)}</p>
          : f.year === null ? <p className="note">{t.baNoData(p.zoneLabel, p.year)}</p>
          : (<>
            <p className="stat"><b>{t.baYear(ha(f.year), p.zoneLabel, p.year)}</b></p>
            {f.month !== null && <p>{t.baMonth(monthLongLabel(p.year, p.month), ha(f.month))}</p>}
          </>)}
        <p className="note">{t.baNote}</p>
        {series && (
          <details className="ba-series">
            <summary>{t.baSeries}</summary>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">{t.baYearCol}</th><th scope="col">ha</th></tr></thead>
                <tbody>
                  {Object.entries(series).sort(([a], [b]) => Number(b) - Number(a)).map(([y, v]) => (
                    <tr key={y}><th scope="row">{y}</th><td>{v === null ? "—" : ha(v)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </details>
    </section>
  );
}
