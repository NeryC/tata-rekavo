export interface Weather {
  latitude: number; longitude: number; timezone: string; timezoneAbbreviation: string;
  current: { time: string; temperature: number; humidity: number; wind: number; direction: number };
  yesterday: { date: string; precipitation: number };
  today: { date: string; precipitation: number };
}

const number = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Invalid weather value'); return v; };
const string = (v: unknown): string => { if (typeof v !== 'string' || !v) throw new Error('Invalid weather field'); return v; };

export function parseWeather(value: unknown): Weather {
  if (!value || typeof value !== 'object') throw new Error('Invalid weather response');
  const data = value as Record<string, any>;
  const current = data.current, daily = data.daily;
  if (!current || !daily || !Array.isArray(daily.time) || !Array.isArray(daily.precipitation_sum)) throw new Error('Missing weather data');
  const time = string(current.time), date = time.slice(0, 10);
  const today = daily.time.indexOf(date), yesterday = today - 1;
  if (today < 1 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time)) throw new Error('Missing daily weather');
  return { latitude:number(data.latitude), longitude:number(data.longitude), timezone:string(data.timezone), timezoneAbbreviation:string(data.timezone_abbreviation),
    current: { time, temperature:number(current.temperature_2m), humidity:number(current.relative_humidity_2m), wind:number(current.wind_speed_10m), direction:number(current.wind_direction_10m) },
    yesterday: { date:string(daily.time[yesterday]), precipitation:number(daily.precipitation_sum[yesterday]) },
    today: { date:string(daily.time[today]), precipitation:number(daily.precipitation_sum[today]) } };
}

export function weatherUrl(latitude: number, longitude: number): string {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({latitude:latitude.toFixed(3), longitude:longitude.toFixed(3), current:'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m', daily:'precipitation_sum', past_days:'1', forecast_days:'1', timezone:'auto'}).toString();
  return url.toString();
}

