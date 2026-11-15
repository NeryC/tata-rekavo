import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  acquiredAt, formatAcquired, satelliteName, confidenceLabel, inWindow, windowCoverage,
} from './hotspotTime.ts';

test('FIRMS acq_date and acq_time are read as UTC', () => {
  assert.equal(acquiredAt('2026-01-01', '0030'), '2026-01-01T00:30:00.000Z');
  assert.equal(acquiredAt('2026-01-01', '30'), '2026-01-01T00:30:00.000Z'); // leading zeros dropped by FIRMS
  assert.equal(acquiredAt('2026-11-13', '431'), '2026-11-13T04:31:00.000Z');
  assert.equal(acquiredAt('2026-11-13', '1759'), '2026-11-13T17:59:00.000Z');
});

test('missing or invalid times are unknown, never midnight', () => {
  for (const t of ['', '2460', '1299', 'abc', '12345', '-100']) assert.equal(acquiredAt('2026-01-01', t), null, t);
  assert.equal(acquiredAt('2026-02-30', '0100'), null);
  assert.equal(acquiredAt('', '0100'), null);
});

test('the local date can differ from the UTC date and the time zone is shown', () => {
  // 00:30 UTC on 1 January is 21:30 on 31 December in Asuncion (UTC-3)
  const f = formatAcquired('2026-01-01', '2026-01-01T00:30:00.000Z', 'es', 'America/Asuncion');
  assert.match(f.date, /31/);
  assert.match(f.date, /dic/i);
  assert.equal(f.time, '21:30');
  assert.equal(f.zone, 'GMT-3');
  const lima = formatAcquired('2026-01-01', '2026-01-01T00:30:00.000Z', 'en', 'America/Lima');
  assert.equal(lima.time, '19:30');
  assert.equal(lima.zone, 'GMT-5');
});

test('without a time only the acquisition date is shown', () => {
  const f = formatAcquired('2026-03-05', null, 'es', 'America/Asuncion');
  assert.equal(f.time, null);
  assert.equal(f.zone, null);
  assert.match(f.date, /5/);
  assert.match(f.date, /mar/i);
});

test('satellite codes and confidence values are spelled out, unknown stays unknown', () => {
  assert.equal(satelliteName('N'), 'Suomi NPP');
  assert.equal(satelliteName('N20'), 'NOAA-20');
  assert.equal(satelliteName('N21'), 'NOAA-21');
  assert.equal(satelliteName('Terra'), 'Terra');
  assert.equal(satelliteName('A'), 'Aqua');
  assert.equal(satelliteName('XYZ'), 'XYZ');
  assert.equal(satelliteName(''), null);
  assert.equal(confidenceLabel('h'), 'high');
  assert.equal(confidenceLabel('n'), 'nominal');
  assert.equal(confidenceLabel('l'), 'low');
  assert.equal(confidenceLabel('85'), '85%');
  assert.equal(confidenceLabel(''), null);
  assert.equal(confidenceLabel('zz'), null);
});

const now = new Date('2026-11-15T12:00:00Z');
test('rolling windows count back exactly from now, across midnight and month ends', () => {
  assert.equal(inWindow('2026-11-14T12:00:00.000Z', '24h', now), true); // exactly 24 h before: included
  assert.equal(inWindow('2026-11-14T11:59:00.000Z', '24h', now), false);
  assert.equal(inWindow('2026-11-15T03:00:00.000Z', '24h', now), true);
  assert.equal(inWindow('2026-11-08T12:00:00.000Z', '7d', now), true);
  assert.equal(inWindow('2026-11-08T11:59:00.000Z', '7d', now), false);
  assert.equal(inWindow('2026-10-31T23:00:00.000Z', '24h', new Date('2026-11-01T02:00:00Z')), true);
  assert.equal(inWindow('2026-11-15T12:01:00.000Z', '24h', now), false); // future: not in a window that ends now
  assert.equal(inWindow(null, '24h', now), false); // unknown time cannot be placed in an exact window
});

test('coverage tells the time span, the count and whether the data reach the start of the window', () => {
  const at = ['2026-11-15T04:31:00.000Z', '2026-11-14T17:00:00.000Z'];
  const c = windowCoverage(at, '24h', now, '2026-11-15T10:00:00+00:00');
  assert.deepEqual(c, { count: 2, first: '2026-11-14T17:00:00.000Z', last: '2026-11-15T04:31:00.000Z', behind: false });
  // data generated 30 h ago: the window is not fully covered
  const old = windowCoverage([], '24h', now, '2026-11-14T06:00:00+00:00');
  assert.deepEqual(old, { count: 0, first: null, last: null, behind: true });
  assert.equal(windowCoverage([], '24h', now, undefined).behind, true);
  assert.equal(windowCoverage([], '24h', now, '2026-11-14T23:00:00Z').behind, false); // 13 h: one regular update cycle
  assert.equal(windowCoverage([], '7d', now, '2026-11-14T06:00:00Z').behind, false);
});


test('a FIRMS CSV row gives typed provenance; absent columns are unknown, not zero', async () => {
  const { provenance } = await import('./hotspotTime.ts');
  const cols = 'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,product'.split(',');
  const p = provenance(cols, '-24.4,-54.6,2026-01-01,0030,N20,VIIRS,h,1.9,VIIRS_NOAA20_NRT'.split(','));
  assert.deepEqual(p, { at: '2026-01-01T00:30:00.000Z', satellite: 'N20', instrument: 'VIIRS', confidence: 'h', product: 'VIIRS_NOAA20_NRT' });
  const bare = provenance(['latitude', 'longitude', 'acq_date'], ['-24.4', '-54.6', '2026-01-01']);
  assert.deepEqual(bare, { at: null, satellite: null, instrument: null, confidence: null, product: null });
  const blank = provenance(cols, '-24.4,-54.6,2026-01-01,,,,,,'.split(','));
  assert.deepEqual(blank, { at: null, satellite: null, instrument: null, confidence: null, product: null });
});

test("a selected hotspot is described with local time and zone, or says the time is unknown", async () => {
  const { describeHotspot } = await import("./hotspotTime.ts");
  const t = { hsTimeUnknown: "hora no disponible", hsUnknown: "desconocido", hsConf: { low: "baja", nominal: "nominal", high: "alta" } };
  const d = describeHotspot({ date: "2026-01-01", at: "2026-01-01T00:30:00.000Z", satellite: "N", instrument: "VIIRS", confidence: "h", product: "VIIRS_SNPP_NRT" }, "es", "America/Asuncion", t);
  assert.equal(d.when, "31 dic 2025, 21:30 (GMT-3)");
  assert.equal(d.sensor, "Suomi NPP · VIIRS");
  assert.equal(d.confidence, "alta");
  assert.equal(d.product, "VIIRS_SNPP_NRT");
  const u = describeHotspot({ date: "2026-01-01", at: null, satellite: null, instrument: null, confidence: null, product: null }, "es", "America/Asuncion", t);
  assert.match(u.when, /hora no disponible$/);
  assert.doesNotMatch(u.when, /00:00/);
  assert.equal(u.sensor, "desconocido");
  assert.equal(u.confidence, "desconocido");
});
