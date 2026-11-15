import { test } from "node:test";
import assert from "node:assert/strict";
import { layerNote, shareLabel, topRows } from "./layerFigures.ts";

const base = { loaded: true, noData: false, pending: false, custom: false, month: 10, throughIdx: 10, stale: false };

test("layerNote: nothing when the layer is missing, the month has no data or the hotspots are still loading", () => {
  assert.equal(layerNote({ ...base, loaded: false, custom: true }), null);
  assert.equal(layerNote({ ...base, noData: true, custom: true }), null);
  assert.equal(layerNote({ ...base, pending: true, stale: true }), null);
});

test("layerNote: custom beats late and stale; late for a month after the last covered; stale only for the last month", () => {
  assert.equal(layerNote({ ...base, custom: true, month: 99 }), "custom");
  assert.equal(layerNote({ ...base, month: 11 }), "late");
  assert.equal(layerNote({ ...base, month: 11, stale: true }), "late");
  assert.equal(layerNote({ ...base, stale: true }), "stale");
  assert.equal(layerNote({ ...base, month: 3 }), null);
});

test("shareLabel: under 1 % is '<1', never '0'; null without a share; the locale formats the number", () => {
  assert.equal(shareLabel(null, "en-US"), null);
  assert.equal(shareLabel(undefined, "en-US"), null);
  assert.equal(shareLabel(0.004, "en-US"), "<1");
  assert.equal(shareLabel(0, "en-US"), "0");
  assert.equal(shareLabel(0.456, "en-US"), "46");
  assert.equal(shareLabel(1.2, "en-US"), "120");
  assert.equal(shareLabel(0.3, "es-PY"), "30");
});

test("topRows: skips rows under the minimum, keeps the order and the limit", () => {
  const rows = [{ value: 9, id: "a" }, { value: 4, id: "b" }, { value: 0.4, id: "c" }, { value: 3, id: "d" }, { value: 2, id: "e" }];
  assert.deepEqual(topRows(rows).map((r) => r.id), ["a", "b", "d"]);
  assert.deepEqual(topRows(rows, 10).map((r) => r.id), ["a", "b", "d", "e"]);
  assert.deepEqual(topRows(undefined), []);
});
