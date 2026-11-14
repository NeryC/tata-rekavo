import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classify, decodeGrid, departmentRanking, indexOf, monthOf, validationSummary, verdict,
} from "../harmonized.js";

const grid = JSON.parse(
  readFileSync(new URL("../data/app/grid.json", import.meta.url), "utf8"),
);
const meta = grid.meta;

test("indexOf maps the first month to 0", () => {
  assert.equal(indexOf(meta, 2002, 7), 0);
});

test("monthOf labels month 115 as Feb 2012", () => {
  assert.equal(monthOf(meta, 115).label, "Feb 2012");
});

test("classify puts ratio 1.6 in the high class", () => {
  assert.equal(classify(meta, 1.6).id, "high");
});

test("verdict is partial on the first day of a month (coverage 1/30)", () => {
  const m = grid.meta.months.count - 1;
  const series = new Float64Array(grid.meta.months.count).fill(10);
  const v = verdict({ meta, nMonths: m + 1 }, series, m, 1 / 30);
  assert.equal(v.partial, true);
  assert.equal(v.rank, null);
});

test("validationSummary reads the real grid.json: paraguay/chaco/oriental rows", () => {
  const s = validationSummary(meta);
  assert.deepEqual(s.rows, [
    { area: "paraguay", mdapePct: 7.0, classAgreementPct: 95 },
    { area: "chaco", mdapePct: 6.7, classAgreementPct: 91 },
    { area: "oriental", mdapePct: 9.8, classAgreementPct: 86 },
  ]);
  assert.equal(s.spearman, 0.978);
  assert.equal(s.nMonths, 167);
});

test("validationSummary rounds mdape to 1 decimal and agreement to an integer", () => {
  const s = validationSummary({
    validation: {
      leave_one_year_out: { country: { mdape_pct: 7.04, n: 10 } },
      anomaly_class_agreement: { country: { spearman: 0.9, same_class_pct: 94.6 } },
    },
  });
  assert.deepEqual(s.rows, [{ area: "paraguay", mdapePct: 7, classAgreementPct: 95 }]);
});

test("validationSummary omits missing areas and nulls missing agreement", () => {
  const s = validationSummary({
    validation: {
      leave_one_year_out: {
        country: { mdape_pct: 7, n: 12 },
        oriental: { mdape_pct: 9.8, n: 12 },
      },
      anomaly_class_agreement: { oriental: { spearman: 0.97, same_class_pct: 86.2, n: 12 } },
    },
  });
  assert.deepEqual(s.rows, [
    { area: "paraguay", mdapePct: 7, classAgreementPct: null },
    { area: "oriental", mdapePct: 9.8, classAgreementPct: 86 },
  ]);
  assert.equal(s.spearman, null);
  assert.equal(s.nMonths, 12);
});

test("validationSummary without meta.validation is empty", () => {
  assert.deepEqual(validationSummary({}), { rows: [], spearman: null, nMonths: 0 });
  assert.deepEqual(validationSummary({ validation: {} }), { rows: [], spearman: null, nMonths: 0 });
});

// --- departmentRanking -------------------------------------------------------

/** Synthetic grid: one cell per department, history in months 0..36 (same calendar month), value at month 48. */
function synthGrid(cellSpecs) {
  const cells = new Map();
  for (const [id, { history, value }] of Object.entries(cellSpecs)) {
    const m = [0, 12, 24, 36, 48], h = [...history, value];
    cells.set(+id, { m, h, modis: h.slice(), viirs: h.slice() });
  }
  return { meta, cells, nMonths: 49 };
}
const dep = (id, cell) => ({ id, name: id.toUpperCase(), cells: [cell] });

test("departmentRanking puts a solid anomaly above a lowSignal one", () => {
  const g = synthGrid({ 1: { history: [10, 10, 10, 10], value: 40 }, 2: { history: [1, 1, 1, 1], value: 10 } });
  const r = departmentRanking(g, [dep("low", 2), dep("hi", 1)], 48);
  assert.deepEqual(r.map((x) => x.id), ["hi", "low"]);
  assert.equal(r[0].lowSignal, false);
  assert.equal(r[0].median, 10);
  assert.equal(r[0].ratio, 4);
  assert.equal(r[0].classId, "extreme");
  assert.equal(r[1].lowSignal, true);
  assert.equal(r[1].partial, false);
  assert.ok(Number.isFinite(r[0].relativeError));
});

test("departmentRanking: a typical month of exactly 10 is solid, 9 is lowSignal", () => {
  const g = synthGrid({ 1: { history: [10, 10, 10, 10], value: 11 }, 2: { history: [9, 9, 9, 9], value: 90 } });
  const r = departmentRanking(g, [dep("edge", 1), dep("below", 2)], 48);
  assert.deepEqual(r.map((x) => [x.id, x.lowSignal]), [["edge", false], ["below", true]]);
});

test("departmentRanking: median 0 and value 0 gives ratio 1", () => {
  const g = synthGrid({ 1: { history: [0, 0, 0, 0], value: 0 } });
  const [r] = departmentRanking(g, [dep("z", 1)], 48);
  assert.equal(r.ratio, 1);
  assert.equal(r.lowSignal, true);
});

test("departmentRanking orders solid by ratio desc, then lowSignal by value desc", () => {
  const g = synthGrid({
    1: { history: [10, 10, 10, 10], value: 12 },   // ratio 1.2, solid
    2: { history: [10, 10, 10, 10], value: 30 },   // ratio 3, solid
    3: { history: [0, 0, 0, 0], value: 5 },        // lowSignal, Infinity ratio, value 5
    4: { history: [2, 2, 2, 2], value: 9 },        // lowSignal, value 9
  });
  const r = departmentRanking(g, [dep("a", 1), dep("b", 2), dep("c", 3), dep("d", 4)], 48);
  assert.deepEqual(r.map((x) => x.id), ["b", "a", "d", "c"]);
  assert.equal(r[3].ratio, Infinity);
});

test("departmentRanking reports Infinity when the scaled median is 0 and value > 0", () => {
  // With coverage 0 the median is 0, so any positive value has Infinity ratio; lowSignal is then true too.
  const g = synthGrid({ 1: { history: [10, 10, 10, 10], value: 7 } });
  const [r] = departmentRanking(g, [dep("x", 1)], 48, 0);
  assert.equal(r.ratio, Infinity);
  assert.equal(r.lowSignal, true);
});

test("departmentRanking breaks ties by value desc then name", () => {
  const g = synthGrid({
    1: { history: [10, 10, 10, 10], value: 20 },
    2: { history: [20, 20, 20, 20], value: 40 },
    3: { history: [10, 10, 10, 10], value: 20 },
    4: { history: [5, 5, 5, 5], value: 10 },
  });
  const r = departmentRanking(g, [dep("c", 3), dep("a", 1), dep("b", 2), dep("d", 4)], 48);
  // all ratio 2: value desc (b=40), then 20s by name (A, C), then d=10
  assert.deepEqual(r.map((x) => x.id), ["b", "a", "c", "d"]);
});

test("departmentRanking passes coverage through (partial month)", () => {
  const g = synthGrid({ 1: { history: [10, 10, 10, 10], value: 5 } });
  const [r] = departmentRanking(g, [dep("p", 1)], 48, 0.5);
  assert.equal(r.partial, true);
  assert.equal(r.median, 5);
  assert.equal(r.ratio, 1);
});

test("departmentRanking on real data: 17 departments with finite medians", () => {
  const departments = JSON.parse(
    readFileSync(new URL("../data/app/departments.json", import.meta.url), "utf8"),
  ).departments;
  const g = decodeGrid(grid);
  const m = g.meta.months.count - 1;
  const r = departmentRanking(g, departments, m);
  assert.equal(r.length, 17);
  assert.ok(r.every((x) => Number.isFinite(x.median) && Number.isFinite(x.value)));
  assert.equal(new Set(r.map((x) => x.id)).size, 17);
});

test("departmentRanking ranks months with no history as lowSignal, not solid", () => {
  // month 0 has no earlier same-calendar-month data: median is NaN
  const g = synthGrid({ 1: { history: [10, 10, 10, 10], value: 40 }, 2: { history: [50, 10, 10, 10], value: 5 } });
  const r = departmentRanking(g, [dep("a", 1), dep("b", 2)], 0);
  assert.ok(r.every((x) => Number.isNaN(x.median) && x.lowSignal));
  assert.deepEqual(r.map((x) => x.id), ["b", "a"]); // by value desc: 50 then 10
  const rr = departmentRanking(g, [dep("a", 1), dep("b", 2)], 3);
  assert.ok(rr.every((x) => x.lowSignal));
});
