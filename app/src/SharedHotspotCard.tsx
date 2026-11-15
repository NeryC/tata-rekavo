import { useI18n } from "./i18n";
import type { Hotspot } from "./data";
import { describeHotspot, formatInstant, refInstant, type HotspotRef } from "./hotspotTime";

interface Props {
  shared: HotspotRef;
  /** detections of that pass in its ~1 km cell; null while the hotspots are loading */
  matches: Hotspot[] | null;
  timeZone: string;
  generated: string | undefined;
  onClose: () => void;
}

/** A hotspot opened from a shared link: what was detected, when, roughly where, and that nobody has checked it on the ground. */
export default function SharedHotspotCard(p: Props) {
  const { t, num, lang } = useI18n();
  const when = refInstant(p.shared.t);
  const first = p.matches?.[0];
  // from the data when found; otherwise only what the link itself says (date and time, no sensor)
  const d = first ? describeHotspot(first, lang, p.timeZone, t)
    : when ? describeHotspot({ date: when.date, at: when.at, satellite: null, instrument: null, confidence: null, product: null }, lang, p.timeZone, t)
    : null;
  // one pass can detect several pixels in the ~1 km cell: show every confidence they have, not just one
  const confidence = p.matches && d ? [...new Set(p.matches.map((m) => describeHotspot(m, lang, p.timeZone, t).confidence))].join(", ") : "";
  // decimal degrees with a point in every language: a decimal comma would read as the separator between lat and lon
  const coord = (x: number) => x.toFixed(2);

  return (
    <section className="shared-hotspot" aria-labelledby="shared-hotspot-title">
      <div className="h2row">
        <h2 id="shared-hotspot-title">{t.vfTitle}</h2>
        <button type="button" className="ghost" onClick={p.onClose}>{t.vfClose}</button>
      </div>
      <p className="vf-warning"><strong>{t.vfNotVerified}</strong></p>
      {d && <p className="stat">{d.when}</p>}
      <p>{t.vfApprox(coord(p.shared.lat), coord(p.shared.lon))}</p>
      {p.matches === null ? <p className="note" role="status">{t.vfLoading}</p>
        : first && d ? (
          <dl className="vf-facts">
            <dt>{t.hsSensor}</dt><dd>{d.sensor}</dd>
            <dt>{t.hsConfidence}</dt><dd>{confidence}</dd>
            <dt>{t.hsProduct}</dt><dd>NASA FIRMS · {d.product}</dd>
          </dl>
        ) : <p className="note" role="status">{t.vfNotFound}</p>}
      {p.matches && p.matches.length > 1 && <p className="note">{t.vfPixels(num(p.matches.length))}</p>}
      {p.generated && <p className="note">{t.vfUpdated(formatInstant(p.generated, lang, p.timeZone))}</p>}
    </section>
  );
}
