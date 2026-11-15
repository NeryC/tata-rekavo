import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { historyPeriodLabel } from './historyPeriod.ts';

test('uses the actual period declared by the historical detections file', () => {
  assert.equal(historyPeriodLabel('2002-07..2025-12', (y, m) => `${y}/${m}`), '2002/7 – 2025/12');
  assert.equal(historyPeriodLabel('2010-01..2022-03', (y, m) => `${y}/${m}`), '2010/1 – 2022/3');
});

test('does not invent a period when metadata is missing or invalid', () => {
  for (const value of ['', 'unknown', '2020-13..2021-01', '2024-02..2020-01']) {
    assert.equal(historyPeriodLabel(value, (y, m) => `${y}/${m}`), null);
  }
});
