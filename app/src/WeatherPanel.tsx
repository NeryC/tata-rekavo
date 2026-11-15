import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { parseWeather, weatherUrl, type Weather } from './weather';

type Result = { key: string; weather?: Weather; error?: true };
const cache = new Map<string, { data: Weather; at: number }>();

export default function WeatherPanel({ point }: { point: [number, number] | null }) {
  const { t, lang } = useI18n();
  const num = (n: number, digits = 1) => n.toLocaleString(lang === 'es' ? 'es-PY' : 'en-US', { maximumFractionDigits: digits });
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const lat = point?.[1], lon = point?.[0];
  const key = lat === undefined || lon === undefined ? null : `${lat.toFixed(3)},${lon.toFixed(3)}`;

  useEffect(() => {
    if (!open || !key || lat === undefined || lon === undefined) return;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 15 * 60_000) { setResult({ key, weather: cached.data }); return; }
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setResult(null);
    fetch(weatherUrl(lat, lon), { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Weather request failed'); return response.json(); })
      .then(data => { const weather = parseWeather(data); cache.set(key, { data: weather, at: Date.now() }); if (active) setResult({ key, weather }); })
      .catch(() => { if (active) setResult({ key, error: true }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [open, key, lat, lon, attempt]);

  const data = result?.key === key ? result.weather : undefined;
  return <section className="weather-section">
    <p className="note">{t.weatherExplanation}</p>
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary><h2>{t.weatherTitle}</h2></summary>
      {!key ? <p role="status">{t.weatherNoArea}</p> : !result || result.key !== key ? <p role="status">{t.weatherLoading}</p> : result.error ?
        <p role="status">{t.weatherError} <button className="link" type="button" onClick={() => setAttempt(n => n + 1)}>{t.weatherRetry}</button></p> : data && <>
          <p className="weather-location">{t.weatherPoint(num(data.latitude, 3), num(data.longitude, 3))}</p>
          <p className="note">{t.weatherTime(data.current.time.replace('T', ' '), data.timezoneAbbreviation)}</p>
          <dl className="weather-values">
            <div><dt>{t.weatherTemperature}</dt><dd>{num(data.current.temperature)} °C</dd></div>
            <div><dt>{t.weatherHumidity}</dt><dd>{num(data.current.humidity)} %</dd></div>
            <div><dt>{t.weatherWind}</dt><dd>{num(data.current.wind)} km/h · {num(data.current.direction)}°</dd></div>
            <div><dt>{t.weatherRainYesterday}</dt><dd>{num(data.yesterday.precipitation)} mm</dd></div>
            <div><dt>{t.weatherRainToday}</dt><dd>{num(data.today.precipitation)} mm</dd></div>
          </dl>
          <p className="note">{t.weatherNotice}</p>
        </>}
      <p className="note">{t.weatherSource} <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></p>
    </details>
  </section>;
}

