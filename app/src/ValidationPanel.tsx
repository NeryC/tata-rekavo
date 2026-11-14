import { useState } from "react";
import * as H from "@core";
import { url } from "./data";
import { useI18n } from "./i18n";

type Meta = Parameters<typeof H.validationSummary>[0];

/** "How reliable is this?": held-out-year validation numbers (from metrics.json via meta) plus the validation chart. */
export default function ValidationPanel({ meta }: { meta: Meta }) {
  const { t, lang, num } = useI18n();
  const loc = lang === "es" ? "es-PY" : "en-US";
  const dec = (n: number, d: number) => n.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
  const [imgOk, setImgOk] = useState(true);
  const v = H.validationSummary(meta);
  return (
    <details className="trust">
      <summary>{t.trustTitle}</summary>
      <div className="trust-body">
        <p>{t.trustIntro}</p>
        {v.rows.length > 0 && (
          <div className="trust-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.trustArea}</th>
                  <th scope="col">{t.trustError}</th>
                  <th scope="col">{t.trustClass}</th>
                </tr>
              </thead>
              <tbody>
                {v.rows.map((r) => (
                  <tr key={r.area}>
                    <th scope="row">{t.zones[r.area]}</th>
                    <td>{dec(r.mdapePct, 1)}%</td>
                    <td>{r.classAgreementPct === null ? "—" : `${num(r.classAgreementPct)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {v.spearman !== null && <p>{t.trustSpearman(dec(v.spearman, 3), num(v.nMonths))}</p>}
        <p>{t.trustRecent}</p>
        {imgOk && <img src={url("validation.png")} loading="lazy" alt={t.validationAlt} onError={() => setImgOk(false)} />}
      </div>
    </details>
  );
}
