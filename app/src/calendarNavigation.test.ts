import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { calendarTarget } from './calendarNavigation.ts';

test('arrow keys move between available calendar months and stop at edges', () => {
  const months = [0, 1, 2, 12, 13, 14, 24, 25];
  assert.equal(calendarTarget(months, 1, 'ArrowRight'), 2);
  assert.equal(calendarTarget(months, 13, 'ArrowUp'), 25);
  assert.equal(calendarTarget(months, 13, 'ArrowDown'), 1);
  assert.equal(calendarTarget(months, 0, 'ArrowLeft'), 0);
  assert.equal(calendarTarget(months, 13, 'Escape'), null);
});

