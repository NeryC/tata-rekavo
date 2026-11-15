import type { CountryInfo } from "./data";
import type { SummaryFile } from "./highlights";
import { useI18n } from "./i18n";

const ICON: Record<string, string> = { low: "↓", normal: "≈", high: "↑", extreme: "▲" };

export interface CaseLink { id: string; title: string; text: string; href: string }

interface Props {
  country: CountryInfo;
  countries: CountryInfo[] | null;
  /** "November 2026 (in progress)" */
  monthTitle: string;
  /** the whole country's verdict in the latest month */
  now: { classId: string; ratio: number | null } | null;
  /** the most abnormal department in the latest month (high or extreme with enough fire), if any */
  top: { name: string; ratio: number; classId: string } | null;
  /** departments are known (the "most abnormal" line and the alert need them) */
  hasDepartments: boolean;
  onTop: () => void;
  onShare: () => void;
  onCopy: () => void;
  cases: CaseLink[];
  summary: SummaryFile | null;
  onCountry: (c: CountryInfo) => void;
}

/** First thing on the panel: the answer for right now, where to look, real cases to open, and every country at once. */
export default function Glance({ country, countries, monthTitle, now, top, hasDepartments, onTop, onShare, onCopy, cases, summary, onCountry }: Props) {
  const { t, ratio, lang } = useI18n();
  const name = country.name[lang];
  // the cases start open beside the map and folded on phones, where they would push the rest of the page down
  const wide = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 861px)").matches : true;
  const south = countries && summary ? countries.filter((c) => summary.countries[c.iso3]) : [];
  return (
    <section className="glance" aria-labelledby="glance-title">
      <h2 id="glance-title">{t.glanceTitle(name, monthTitle)}</h2>
      <p className="g-notice">{t.glanceNotice}</p>
      {now && (
        <p className="g-now">
          <span className={`g-chip c-${now.classId}`}><span aria-hidden>{ICON[now.classId]}</span> {t.classes[now.classId]}</span>
          {now.ratio !== null && <b className="g-ratio">×{ratio(now.ratio)}</b>}
          <span className="g-of">{t.ofUsual}</span>
        </p>
      )}
      {hasDepartments && (
        <div className="g-top">
          {top ? (
            <button type="button" className="g-topbtn" onClick={onTop}>
              <span className="g-lbl">{t.glanceMost}</span> <b>{top.name}</b> ×{ratio(top.ratio)}{" "}
              <span className={`g-chip small c-${top.classId}`}><span aria-hidden>{ICON[top.classId]}</span> {t.classes[top.classId]}</span>
            </button>
          ) : <p className="g-none"><span className="g-lbl">{t.glanceMost}</span> {t.glanceNone}</p>}
          <div className="g-share">
            <button type="button" className="g-sharebtn" onClick={onShare} title={t.alertShareTitle}><span aria-hidden>📣</span> {t.alertShare}</button>
            <button type="button" className="link" onClick={onCopy}>{t.alertCopy}</button>
          </div>
        </div>
      )}
      {cases.length > 0 && (
        <details className="g-cases" open={wide}>
          <summary><h3>{t.casesTitle}</h3></summary>
          <ul>
            {cases.map((c) => (
              <li key={c.id}><a href={c.href}><b>{c.title}</b><span>{c.text}</span></a></li>
            ))}
          </ul>
        </details>
      )}
      {south.length > 1 && (
        <div className="g-south">
          <h3>{t.southTitle}</h3>
          <ul>
            {south.map((c) => {
              const s = summary!.countries[c.iso3];
              const here = c.iso3 === country.iso3;
              return (
                <li key={c.iso3}>
                  <button type="button" className={`g-country${here ? " here" : ""}`} aria-current={here ? "true" : undefined}
                    disabled={here} onClick={() => onCountry(c)}>
                    <span className="g-cname">{c.pilot ? t.pilotCountry(c.name[lang]) : c.name[lang]}</span>
                    <span className={`g-chip small c-${s.classId}`}><span aria-hidden>{ICON[s.classId]}</span> {s.ratio !== null ? `×${ratio(s.ratio)}` : "—"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="note">{t.southNote}</p>
        </div>
      )}
    </section>
  );
}

