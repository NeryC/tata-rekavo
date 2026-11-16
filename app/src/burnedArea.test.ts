import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateBurnedArea, burnedFigures } from './burnedArea.ts';

const doc = () => ({
  schema: 1, source: 'MapBiomas Fuego Paraguay', collection: 'Colección 1', license: 'CC BY 4.0', citation: 'c', url: 'u',
  retrieved: '2026-11-15', spatial_resolution_m: 30, unit: 'ha', method: 'm', first_year: 1999, last_year: 2024,
  zones: {
    paraguay: { annual: { '2023': 1000, '2024': 0 }, monthly: { '2024-09': 0, '2023-09': 600 } },
    boqueron: { annual: { '2023': null, '2024': 5 }, monthly: { '2024-09': 5 } },
  },
});

test('a valid file is accepted; a wrong unit, schema or shape is rejected', () => {
  assert.ok(validateBurnedArea(doc()));
  for (const bad of [{ ...doc(), unit: 'km2' }, { ...doc(), schema: 2 }, { ...doc(), zones: null }, null, 'x']) {
    assert.equal(validateBurnedArea(bad), null);
  }
  const negative = doc(); negative.zones.paraguay.annual['2023'] = -1;
  assert.equal(validateBurnedArea(negative), null);
});

test('figures for a covered year and month; zero stays zero', () => {
  const d = validateBurnedArea(doc())!;
  assert.deepEqual(burnedFigures(d, 'paraguay', 2024, 9), { status: 'ok', year: 0, month: 0 });
  assert.deepEqual(burnedFigures(d, 'paraguay', 2023, 9), { status: 'ok', year: 1000, month: 600 });
});

test('a period without coverage is null, not zero, and after the collection says so', () => {
  const d = validateBurnedArea(doc())!;
  assert.deepEqual(burnedFigures(d, 'boqueron', 2023, 9), { status: 'ok', year: null, month: null });
  assert.deepEqual(burnedFigures(d, 'paraguay', 2025, 1), { status: 'after', year: null, month: null });
  assert.deepEqual(burnedFigures(d, 'paraguay', 1998, 1), { status: 'before', year: null, month: null });
});

test('an area that is not the country or a department has no figure', () => {
  const d = validateBurnedArea(doc())!;
  assert.deepEqual(burnedFigures(d, 'chaco', 2024, 9), { status: 'no-zone', year: null, month: null });
});
