import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { shareRef, refInstant, findShared, formatInstant } from './hotspotTime.ts';

const h = (lat: number, lon: number, date: string, at: string | null) => ({ lat, lon, date, at });

test('a shared hotspot carries its UTC acquisition time and a location rounded to ~1 km', () => {
  assert.deepEqual(shareRef(h(-24.48034, -54.64669, '2026-11-13', '2026-11-13T04:31:00.000Z')), { lat: -24.48, lon: -54.65, t: '202611130431' });
  // without a known time only the date is kept: never an invented midnight
  assert.deepEqual(shareRef(h(-24.48534, -54.6, '2026-11-13', null)), { lat: -24.49, lon: -54.6, t: '20261113' });
});

test('the reference gives back the instant or, without a time, only the date', () => {
  assert.deepEqual(refInstant('202611130431'), { date: '2026-11-13', at: '2026-11-13T04:31:00.000Z' });
  assert.deepEqual(refInstant('20261113'), { date: '2026-11-13', at: null });
  assert.equal(refInstant('202611132460'), null);
  assert.equal(refInstant('20261332'), null);
  assert.equal(refInstant('2026111304'), null);
});

test('a link finds the hotspots of that pass within the rounded cell, and nothing else', () => {
  const pts = [
    h(-24.48034, -54.64669, '2026-11-13', '2026-11-13T04:31:00.000Z'),
    h(-24.47632, -54.64579, '2026-11-13', '2026-11-13T04:31:00.000Z'), // same pass, same ~1 km cell
    h(-24.48034, -54.64669, '2026-11-14', '2026-11-14T04:10:00.000Z'), // same place, another pass
    h(-24.60000, -54.64669, '2026-11-13', '2026-11-13T04:31:00.000Z'), // same pass, elsewhere
  ];
  assert.equal(findShared(pts, { lat: -24.48, lon: -54.65, t: '202611130431' }).length, 2);
  assert.equal(findShared(pts, { lat: -24.48, lon: -54.65, t: '202611140410' }).length, 1);
  assert.equal(findShared(pts, { lat: -24.48, lon: -54.65, t: '202611150000' }).length, 0);
  const untimed = [h(-24.48034, -54.64669, '2026-11-13', null)];
  assert.equal(findShared(untimed, { lat: -24.48, lon: -54.65, t: '20261113' }).length, 1);
  assert.equal(findShared(untimed, { lat: -24.48, lon: -54.65, t: '202611130431' }).length, 0);
});

test('the update time names its UTC offset; a non-date is shown as given', () => {
  assert.equal(formatInstant('2026-11-15T18:02:00+00:00', 'es', 'America/Asuncion'), '15 nov 2026, 15:02 (GMT-3)');
  assert.equal(formatInstant('2026-11-15T18:02:00+00:00', 'en', 'America/La_Paz'), 'Nov 15, 2026, 14:02 (GMT-4)');
  assert.equal(formatInstant('unknown', 'es', 'America/Asuncion'), 'unknown');
});
