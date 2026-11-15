import { test } from "node:test";
import assert from "node:assert/strict";
import {
  climatologyFor, doyOf, MONTH_START_DOY, missingDoys, monthDayOf, summarizeSeason, type SeasonFile,
} from "./season.ts";

test("doyOf follows the pipeline rule", () => {
  assert.equal(doyOf("2026-01-01"), 1);
  assert.equal(doyOf("2026-02-28"), 59);
  assert.equal(doyOf("2026-03-01"), 60);
  assert.equal(doyOf("2026-11-14"), 318);
  assert.equal(doyOf("2026-12-31"), 365);
});

test("doyOf merges the leap day into DOY 59 and keeps Mar 1 at 60", () => {
  assert.equal(doyOf("2024-02-28"), 59);
  assert.equal(doyOf("2024-02-29"), 59);
  assert.equal(doyOf("2024-03-01"), 60);
  assert.equal(doyOf("2024-12-31"), 365); // the 366th day is merged away, so Dec 31 stays 365
  assert.equal(doyOf("2000-02-29"), 59);
  assert.equal(doyOf("1900-03-01"), 60); // 1900 is not a leap year
});

test("doyOf rejects invalid dates", () => {
  assert.equal(doyOf(""), null);
  assert.equal(doyOf("2026-13-01"), null);
  assert.equal(doyOf("2026-02-30"), null);
  assert.equal(doyOf("14/11/2026"), null);
});

test("month starts agree with doyOf", () => {
  for (let m = 1; m <= 12; m++) {
    assert.equal(doyOf(`2026-${String(m).padStart(2, "0")}-01`), MONTH_START_DOY[m - 1]);
    assert.deepEqual(monthDayOf(MONTH_START_DOY[m - 1]), { month: m, day: 1 });
  }
  assert.deepEqual(monthDayOf(365), { month: 12, day: 31 });
  assert.deepEqual(monthDayOf(59), { month: 2, day: 28 });
});

test("missingDoys keeps this year's days only", () => {
  const s = missingDoys(2026, ["2026-11-12", "2026-11-13", "2025-11-13", "bad"]);
  assert.deepEqual([...s].sort(), [316, 317]);
  assert.equal(missingDoys(2026, undefined).size, 0);
});

const flat = (v: number) => Array.from({ length: 365 }, () => v);
const season: SeasonFile = {
  meta: { years: [2003, 2025], doy: 365, unit: "x", generated: "x" },
  areas: {
    paraguay: { p10: flat(1), p50: flat(2), p90: flat(3) },
    boqueron: { p10: flat(1), p50: flat(2), p90: flat(3) },
    short: { p10: [1], p50: [1], p90: [1] },
  },
};

test("climatologyFor maps the zone to its area, custom and unknown to null", () => {
  assert.ok(climatologyFor(season, "paraguay", null));
  assert.equal(climatologyFor(season, "chaco", null), null); // not in this file
  assert.ok(climatologyFor(season, "department", "boqueron"));
  assert.equal(climatologyFor(season, "department", "nueva-dep"), null); // department made after season.json
  assert.equal(climatologyFor(season, "department", null), null);
  assert.equal(climatologyFor(season, "custom", "boqueron"), null);
  assert.equal(climatologyFor(season, "department", "short"), null); // malformed curve
  assert.equal(climatologyFor(season, "department", "toString"), null);
  assert.equal(climatologyFor(null, "paraguay", null), null);
});

test("monthDayOf is the inverse of doyOf over the whole year", () => {
  for (let d = 1; d <= 365; d++) {
    const { month, day } = monthDayOf(d);
    const iso = `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    assert.equal(doyOf(iso), d, iso);
  }
  assert.deepEqual(monthDayOf(60), { month: 3, day: 1 });
  assert.deepEqual(monthDayOf(221), { month: 8, day: 9 });
});

test("early in the year there is no verdict (Jan 1 case)", () => {
  const s = summarizeSeason({ ratio: 0, leadDays: null, early: true }, 0, 5, 1);
  assert.deepEqual(s, { kind: "early" });
});

test("below the median: a typical year reached this total earlier (date in the past)", () => {
  const s = summarizeSeason({ ratio: 0.42, leadDays: -97, early: false }, 55711, 132440, 318);
  assert.deepEqual(s, { kind: "vs", dir: "below", pct: 58, reach: { when: "past", doy: 221 } });
});

test("above the median: a typical year only reaches this total later (date in the future)", () => {
  const s = summarizeSeason({ ratio: 1.28, leadDays: 12, early: false }, 128, 100, 200);
  assert.deepEqual(s, { kind: "vs", dir: "above", pct: 28, reach: { when: "future", doy: 212 } });
});

test("lead under 3 days is in line with a typical year; null lead is omitted", () => {
  assert.deepEqual(summarizeSeason({ ratio: 1.1, leadDays: 2, early: false }, 11, 10, 200),
    { kind: "vs", dir: "above", pct: 10, reach: { when: "onTime" } });
  assert.deepEqual(summarizeSeason({ ratio: 1.1, leadDays: -2, early: false }, 11, 10, 200),
    { kind: "vs", dir: "above", pct: 10, reach: { when: "onTime" } });
  assert.deepEqual((summarizeSeason({ ratio: 0.9, leadDays: -3, early: false }, 9, 10, 200) as { reach: unknown }).reach,
    { when: "past", doy: 197 });
  assert.equal((summarizeSeason({ ratio: 1.5, leadDays: null, early: false }, 15, 10, 200) as { reach: unknown }).reach, null);
});

test("edge ratios: infinite, zero and equal", () => {
  assert.deepEqual(summarizeSeason({ ratio: Infinity, leadDays: null, early: false }, 4, 0, 100),
    { kind: "vs", dir: "above", pct: null, reach: null });
  assert.deepEqual(summarizeSeason({ ratio: 0, leadDays: null, early: false }, 0, 50, 100),
    { kind: "vs", dir: "below", pct: 100, reach: null });
  assert.deepEqual(summarizeSeason({ ratio: 0, leadDays: null, early: false }, 0, 0, 100), { kind: "none" });
  assert.equal((summarizeSeason({ ratio: 1.004, leadDays: 0, early: false }, 100, 100, 100) as { dir: string }).dir, "same");
});
