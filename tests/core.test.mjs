import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { doyOf } from "../app/src/season.ts";
import {
  calendar, classify, currentCumulative, decodeFrp, decodeGrid, departmentRanking, indexOf, monthOf, seasonStatus, seriesToCSV,
  validationSummary, verdict, zoneSeries,
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

test("decodeGrid ignores the optional 4th current.json array (FRP sums)", () => {
  const g = {
    meta: { months: { count: 3, first: "2002-07" } },
    cells: [[10, [0, 2], [5, 7], [2, 3], [0, 7]]],
  };
  const cur3 = { cells: [[10, [2, 3], [9, 4]], [11, [3], [1]]] };
  const cur4 = { cells: [[10, [2, 3], [9, 4], [123.4, 55.5]], [11, [3], [1], [0.7]]] };
  const a = decodeGrid(structuredClone(g), cur3);
  const b = decodeGrid(structuredClone(g), cur4);
  assert.deepEqual([...b.cells.entries()], [...a.cells.entries()]);
  assert.equal(b.nMonths, 4);
  assert.deepEqual(b.cells.get(10), { m: [0, 2, 3], h: [5, 9, 4], modis: [2, 3, 0], viirs: [0, 9, 4] });
  assert.deepEqual(b.cells.get(11), { m: [3], h: [1], modis: [0], viirs: [1] });
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

// ---- season status ----
const season = JSON.parse(
  readFileSync(new URL("../data/app/season.json", import.meta.url), "utf8"),
);
const synthClim = () => {
  const p50 = Float64Array.from({ length: 365 }, (_, i) => (i + 1) * 10);
  return { p10: p50.map((v) => v * 0.5), p50, p90: p50.map((v) => v * 2) };
};

test("currentCumulative counts hotspots by UTC date into a cumulative curve", () => {
  const c = currentCumulative([{ date: "2025-01-01" }, { date: "2025-01-01" }, { date: "2025-01-03" }], 2025);
  assert.equal(c.length, 365);
  assert.deepEqual([c[0], c[1], c[2], c[364]], [2, 2, 3, 3]);
});

test("currentCumulative ignores other years", () => {
  const c = currentCumulative([{ date: "2024-06-01" }, { date: "2026-01-01" }, { date: "2025-06-01" }], 2025);
  assert.equal(c[364], 1);
});

test("currentCumulative merges Feb 29 into DOY 59 and keeps Mar 1 at DOY 60 (leap year)", () => {
  const c = currentCumulative([{ date: "2024-02-28" }, { date: "2024-02-29" }, { date: "2024-03-01" }, { date: "2024-12-31" }], 2024);
  assert.equal(c[57], 0);
  assert.equal(c[58], 2); // Feb 28 + Feb 29
  assert.equal(c[59], 3); // Mar 1 is DOY 60
  assert.equal(c[364], 4); // Dec 31 is DOY 365, not 366
});

test("currentCumulative in a common year: Mar 1 is DOY 60", () => {
  const c = currentCumulative([{ date: "2025-03-01" }], 2025);
  assert.equal(c[58], 0);
  assert.equal(c[59], 1);
});

test("seasonStatus: current equal to median is ratio 1, within, lead 0", () => {
  const clim = synthClim();
  const s = seasonStatus(clim.p50, clim, 100);
  assert.deepEqual(s, { ratio: 1, band: "within", leadDays: 0, early: false });
});

test("seasonStatus: median shifted 10 days earlier is 10 days ahead (positive = early)", () => {
  const clim = synthClim();
  const cum = new Float64Array(365);
  for (let i = 0; i < 365; i++) cum[i] = clim.p50[Math.min(364, i + 10)];
  assert.equal(seasonStatus(cum, clim, 100).leadDays, 10);
  const late = new Float64Array(365);
  for (let i = 0; i < 365; i++) late[i] = clim.p50[Math.max(0, i - 10)];
  assert.equal(seasonStatus(late, clim, 100).leadDays, -10);
});

test("seasonStatus: zero cumulative is ratio 0, below, no division by zero", () => {
  const clim = synthClim();
  const s = seasonStatus(new Float64Array(365), clim, 100);
  assert.equal(s.ratio, 0);
  assert.equal(s.band, "below");
  assert.equal(s.leadDays, null);
  const z = { p10: new Float64Array(365), p50: new Float64Array(365), p90: new Float64Array(365) };
  assert.equal(seasonStatus(new Float64Array(365), z, 100).ratio, 0);
});

test("seasonStatus: p50 zero with cum > 0 is Infinity ratio", () => {
  const z = { p10: new Float64Array(365), p50: new Float64Array(365), p90: new Float64Array(365) };
  const cum = new Float64Array(365).fill(5);
  assert.equal(seasonStatus(cum, z, 100).ratio, Infinity);
});

test("seasonStatus: bands below p10 and above p90", () => {
  const clim = synthClim();
  const at = (v) => new Float64Array(365).fill(v);
  assert.equal(seasonStatus(at(clim.p10[99] - 1), clim, 100).band, "below");
  assert.equal(seasonStatus(at(clim.p10[99]), clim, 100).band, "within");
  assert.equal(seasonStatus(at(clim.p90[99]), clim, 100).band, "within");
  assert.equal(seasonStatus(at(clim.p90[99] + 1), clim, 100).band, "above");
});

test("seasonStatus: p50 never reaching the current cumulative gives leadDays null", () => {
  const clim = synthClim();
  const cum = new Float64Array(365).fill(clim.p50[364] + 1);
  assert.equal(seasonStatus(cum, clim, 200).leadDays, null);
});

test("seasonStatus: early flag is true before DOY 15 only", () => {
  const clim = synthClim();
  assert.equal(seasonStatus(clim.p50, clim, 14).early, true);
  assert.equal(seasonStatus(clim.p50, clim, 15).early, false);
});

test("seasonStatus on real data: paraguay doy 200 equal to p50 is ratio 1, within, lead 0", () => {
  const clim = season.areas.paraguay;
  assert.equal(clim.p50.length, 365);
  const cum = Float64Array.from(clim.p50);
  const s = seasonStatus(cum, clim, 200);
  assert.equal(s.ratio, 1);
  assert.equal(s.band, "within");
  assert.equal(s.leadDays, 0);
  assert.equal(s.early, false);
});

test("app doyOf indexes the same day as currentCumulative, leap years included", () => {
  const dates = ["2024-01-01", "2024-02-28", "2024-02-29", "2024-03-01", "2024-12-31", "2025-02-28", "2025-03-01", "2025-12-31"];
  for (const date of dates) {
    const year = +date.slice(0, 4);
    const doy = doyOf(date);
    const c = currentCumulative([{ date }], year);
    // the hotspot first shows up at index doy-1 (and every later index), never earlier
    assert.equal(c[doy - 1], 1, date);
    assert.equal(doy > 1 ? c[doy - 2] : 0, 0, date);
  }
});

// ---------------------------------------------------------------- harmonized FRP (frp.json)
const frpJson = JSON.parse(readFileSync(new URL("../data/app/frp.json", import.meta.url), "utf8"));
const smallFrp = () => ({
  meta: { ...frpJson.meta, months: { first: "2002-07", count: 3, last: "2002-09", viirs_start_index: 115 } },
  cells: [[10, [0, 2], [5.5, 7]]],
});

test("decodeFrp has the decodeGrid shape: h is MW, classes come from grid.json meta, error model from frp.json", () => {
  const g = decodeFrp(smallFrp(), null, meta);
  assert.deepEqual(g.cells.get(10).h, [5.5, 7]);
  assert.equal(g.nMonths, 3);
  assert.equal(g.meta.classes, meta.classes);
  assert.deepEqual(g.meta.error_model, frpJson.meta.error_model);
  assert.deepEqual(g.meta.regions, meta.regions);
  assert.equal(g.meta.experimental, false);
  assert.equal(classify(g.meta, 1.6).id, "high");
  // the shared functions run on it unchanged
  assert.deepEqual([...zoneSeries(g, [10]).harmonized], [5.5, 0, 7]);
});

test("decodeFrp without grid.json meta falls back to the default classes", () => {
  const g = decodeFrp(smallFrp());
  assert.equal(classify(g.meta, 1.6).id, "high");
  assert.equal(classify(g.meta, 0.1).id, "low");
});

test("decodeFrp takes current months from the 4th array and replaces the archive value", () => {
  const cur = { cells: [[10, [2, 3], [9, 4], [123.4, 55.5]], [11, [3], [1], [0.7]]] };
  const g = decodeFrp(smallFrp(), cur, meta);
  assert.equal(g.nMonths, 4);
  assert.deepEqual(g.cells.get(10).m, [0, 2, 3]);
  assert.deepEqual(g.cells.get(10).h, [5.5, 123.4, 55.5]);
  assert.deepEqual(g.cells.get(11).h, [0.7]);
  assert.equal(g.noData.size, 0);
  const s = zoneSeries(g, [10, 11]);
  assert.equal(s.harmonized[3], 56.2);
});

test("a current month without FRP (file from before the 4th array) is no data, not 0 (Review Focus 3)", () => {
  const cur = { cells: [[10, [3, 4], [9, 4]], [11, [4], [1]]] };
  const g = decodeFrp(smallFrp(), cur, meta);
  assert.deepEqual([...g.noData].sort(), [3, 4]);
  assert.equal(g.nMonths, 5);
  const s = zoneSeries(g, [10, 11]);
  assert.ok(Number.isNaN(s.harmonized[3]) && Number.isNaN(s.harmonized[4]));
  assert.equal(s.harmonized[0], 5.5); // earlier months are untouched
  // a zone with no hotspot at all that month is also unknown, not a clean 0
  assert.ok(Number.isNaN(zoneSeries(g, [99]).harmonized[3]));
});

test("a month where only some current cells carry FRP is no data", () => {
  const cur = { cells: [[10, [3], [4], [8]], [11, [3], [1]]] };
  const g = decodeFrp(smallFrp(), cur, meta);
  assert.deepEqual([...g.noData], [3]);
});

test("verdict on a no-data month says noData and does not poison the history median", () => {
  const g = decodeFrp(smallFrp(), { cells: [[10, [3], [4]]] }, meta);
  const m = 3;
  const series = new Float64Array(g.nMonths).fill(10);
  series[m] = NaN;
  const v = verdict(g, series, m);
  assert.equal(v.noData, true);
  assert.ok(Number.isNaN(v.value) && Number.isNaN(v.ratio));
  assert.equal(v.rank, null);
  // a NaN month inside the history is skipped, not propagated
  const hist = new Float64Array(40).fill(10);
  hist[15] = NaN; // the same calendar month one year back is unknown: only month 3 is left to compare
  const v3 = verdict({ meta, cells: new Map(), nMonths: 40 }, hist, 27, 1);
  assert.equal(v3.median, 10);
  assert.equal(v3.yearsCompared, 1);
});

test("calendar marks a no-data month and keeps medians and totals finite", () => {
  const g = decodeFrp(smallFrp(), { cells: [[10, [3], [4]]] }, meta);
  const s = zoneSeries(g, [10]);
  const cal = calendar(g, s.harmonized);
  const cell = cal.rows[0].cells.find((c) => c && c.m === 3);
  assert.equal(cell.noData, true);
  assert.equal(cell.ratio, null);
  assert.equal(cal.monthlyMedian[6], 5.5); // Jul: from data; Oct has no data at all, so its median is NaN
  assert.ok(cal.rows.every((r) => Number.isFinite(r.total)));
});

test("departmentRanking returns nothing for a no-data month", () => {
  const g = decodeFrp(smallFrp(), { cells: [[10, [3], [4]]] }, meta);
  assert.deepEqual(departmentRanking(g, [{ id: "a", name: "A", cells: [10] }], 3), []);
  assert.equal(departmentRanking(g, [{ id: "a", name: "A", cells: [10] }], 2).length, 1);
});

test("seriesToCSV in frp mode labels MW, drops raw sensor columns and leaves no-data months empty", () => {
  const g = decodeFrp(smallFrp(), { cells: [[10, [3], [4]]] }, meta);
  const s = zoneSeries(g, [10]);
  const lines = seriesToCSV(g, s, { metric: "frp" }).trim().split("\n");
  assert.equal(lines[0], "year,month,harmonized_frp_mw_viirs_equivalent,relative_error");
  assert.match(lines[1], /^2002,7,5\.5,/);
  assert.equal(lines[4], "2002,10,,");
  assert.equal(lines.length, 5);
  // default (counts) format is unchanged
  assert.equal(seriesToCSV(g, zoneSeries(decodeGrid({ meta, cells: [] }), []))
    .split("\n")[0], "year,month,harmonized_viirs_equivalent,relative_error,modis_raw_terra_aqua,viirs_snpp_raw");
});

test("validationSummary reads frp.json: `paraguay` key, p90, no class agreement (Review Focus 2 and 5)", () => {
  const s = validationSummary(frpJson.meta);
  assert.deepEqual(s.rows.map((r) => r.area), ["paraguay", "chaco", "oriental"]);
  const lo = frpJson.meta.validation.leave_one_year_out;
  for (const r of s.rows) {
    assert.equal(r.classAgreementPct, null);
    assert.equal(r.mdapePct, Math.round(lo[r.area].mdape_pct * 10) / 10);
    assert.equal(r.p90Pct, Math.round(lo[r.area].p90_pct * 10) / 10);
  }
  assert.equal(s.spearman, null);
  assert.equal(s.nMonths, 0);
  // the count validation still reports its own numbers, without a p90
  assert.equal(validationSummary(meta).rows[0].p90Pct, undefined);
});

test("real frp.json decodes on the grid.json index; FRP series of the country is positive and finite", () => {
  const g = decodeFrp(frpJson, null, meta);
  assert.equal(g.nMonths, meta.months.count);
  const s = zoneSeries(g, [...g.cells.keys()]);
  assert.ok(s.harmonized.every((x) => Number.isFinite(x) && x >= 0));
  assert.ok(s.harmonized.some((x) => x > 1000));
  const v = verdict(g, s.harmonized, indexOf(meta, 2024, 9));
  assert.ok(Number.isFinite(v.ratio) && v.relativeError === 0);
});

test("decodeFrp: a current.json with no FRP at all makes every current month no data, even months with no hotspot cell", () => {
  // months 3 and 4 are current; only month 3 has a hotspot cell, month 4 has none (month_coverage still lists it)
  const cur = { meta: { month_coverage: { 3: 1, 4: 0.5 } }, cells: [[10, [3], [4]]] };
  const g = decodeFrp(smallFrp(), cur, meta);
  assert.deepEqual([...g.noData].sort(), [3, 4]);
  assert.equal(g.nMonths, 5);
  const s = zoneSeries(g, [10, 11]);
  assert.ok(Number.isNaN(s.harmonized[3]) && Number.isNaN(s.harmonized[4]));
});

test("decodeFrp: a month for which frp.json has values is not no data, even if current.json lacks FRP for it", () => {
  const cur = { meta: { month_coverage: { 2: 1, 3: 1 } }, cells: [[10, [2, 3], [9, 4]]] };
  const g = decodeFrp(smallFrp(), cur, meta); // smallFrp has cell 10 with FRP in months 0 and 2
  assert.deepEqual([...g.noData], [3]);
  assert.equal(zoneSeries(g, [10]).harmonized[2], 7);
});

test("departmentRanking: the low-signal threshold is a parameter (default 10, 100 for MW)", () => {
  const g = synthGrid({ 1: { history: [50, 50, 50, 50], value: 100 } });
  const [dflt] = departmentRanking(g, [dep("p", 1)], 48);
  assert.equal(dflt.lowSignal, false); // median 50 >= 10
  const [mw] = departmentRanking(g, [dep("p", 1)], 48, 1, 100);
  assert.equal(mw.lowSignal, true); // median 50 < 100
  const [edge] = departmentRanking(g, [dep("p", 1)], 48, 1, 50);
  assert.equal(edge.lowSignal, false); // exactly the threshold is solid
});
