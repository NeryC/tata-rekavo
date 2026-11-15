import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseWeather, weatherUrl } from './weather.ts';

const sample = { latitude: -25.2, longitude: -57.5, timezone: 'America/Asuncion', timezone_abbreviation: '-03', current: { time:'2026-11-15T12:00', temperature_2m: 31.2, relative_humidity_2m: 45, wind_speed_10m: 12.5, wind_direction_10m: 180 }, daily: {time:['2026-11-14','2026-11-15'], precipitation_sum:[3.5, 7]} };

test('parses model conditions and distinguishes yesterday from today', () => {
  const result = parseWeather(sample);
  assert.equal(result.current.temperature, 31.2);
  assert.equal(result.yesterday.precipitation, 3.5);
  assert.equal(result.today.precipitation, 7);
  assert.equal(result.current.time, '2026-11-15T12:00');
});

test('rejects missing or invalid data instead of displaying a false zero', () => {
  assert.throws(() => parseWeather({ ...sample, current: { ...sample.current, relative_humidity_2m: null } }));
  assert.throws(() => parseWeather({ ...sample, daily: {time:['2026-11-15'], precipitation_sum:[7]} }));
});

test('uses a rounded reference point and requests current and daily forecast', () => {
  const u = new URL(weatherUrl(-25.23456, -57.45678));
  assert.equal(u.searchParams.get('latitude'), '-25.235');
  assert.equal(u.searchParams.get('longitude'), '-57.457');
  assert.equal(u.searchParams.get('past_days'), '1');
  assert.equal(u.searchParams.get('timezone'), 'auto');
});

