import { useState } from "react";
import * as H from "@core";
import { url } from "./data";
import { useI18n } from "./i18n";

type Meta = Parameters<typeof H.validationSummary>[0];

/** "How reliable is this?": held-out-year validation numbers (from metrics.json via meta) plus the validation chart. */
export default function ValidationPanel({ meta }: { meta: Meta }) {
  const { t, lang, num, metric } = useI18n();
  const loc = lang === "es" ? "es-PY" : "en-US";
  const dec = (n: number, d: number) => n.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
  const [imgOk, setImgOk] = useState(true);
  const v = H.validationSummary(meta);
  // columns follow what the active measure publishes: counts have class agreement, fire power has the p90 error
  const showClass = v.rows.some((r) => r.classAgreementPct !== null);
  const showP90 = v.rows.some((r) => r.p90Pct !== undefined);
  return (
    <details className="trust">
      <summary>{t.trustTitle}</summary>
      <div className="trust-body">
        <p>{t.trustIntro}</p>
        {meta.experimental === true && <p className="experimental-note"><b>{t.experimentalTag}.</b> {t.experimentalNote}</p>}
        {v.rows.length > 0 && (
          <div className="trust-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.trustArea}</th>
                  <th scope="col">{t.trustError}</th>
                  {showP90 && <th scope="col">{t.trustP90}</th>}
                  {showClass && <th scope="col">{t.trustClass}</th>}
                </tr>
              </thead>
              <tbody>
                {v.rows.map((r) => (
                  <tr key={r.area}>
                    <th scope="row">{t.zones[r.area]}</th>
                    <td>{dec(r.mdapePct, 1)}%</td>
                    {showP90 && <td>{r.p90Pct === undefined ? "—" : `${dec(r.p90Pct, 1)}%`}</td>}
                    {showClass && <td>{r.classAgreementPct === null ? "—" : `${num(r.classAgreementPct)}%`}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {v.spearman !== null && <p>{t.trustSpearman(dec(v.spearman, 3), num(v.nMonths))}</p>}
        <p>{t.trustRecent}</p>
        <p>{t.trustEarly}</p>
        {t.trustExtra && <p>{t.trustExtra}</p>}
        {imgOk && metric === "count" && (
          <a className="trust-fig" href={url("validation.png")} target="_blank" rel="noopener">
            <img src={url("validation.png")} loading="lazy" alt={t.validationAlt} onError={() => setImgOk(false)} />
            <span>{t.trustOpen} <span aria-hidden="true">↗</span><span className="sr-only"> {t.opensNewTab}</span></span>
          </a>
        )}
      </div>
    </details>
  );
}
