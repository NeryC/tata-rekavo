import { test } from "node:test";
import assert from "node:assert/strict";
import { closeRing, indexToMonth, monthFromLink, planRestore, polyInBounds, rangeFromLink } from "./shareRestore.ts";

const FIRST = "2012-01";
const N = 150; // 2012-01 .. 2024-06
const DEF: [number, number] = [144, 149];

test("indexToMonth round-trips", () => {
  assert.equal(indexToMonth(FIRST, 0), "2012-01");
  assert.equal(indexToMonth(FIRST, 11), "2012-12");
  assert.equal(indexToMonth(FIRST, 12), "2013-01");
  assert.equal(indexToMonth(FIRST, 149), "2024-06");
});

test("monthFromLink: valid, missing, future and before-first months", () => {
  assert.equal(monthFromLink(FIRST, "2012-01", N), 0);
  assert.equal(monthFromLink(FIRST, "2024-06", N), 149);
  assert.equal(monthFromLink(FIRST, undefined, N), 149);
  assert.equal(monthFromLink(FIRST, "2027-01", N), 149);
  assert.equal(monthFromLink(FIRST, "2011-12", N), 149);
});

test("rangeFromLink: clamps and normalizes an inverted range", () => {
  assert.deepEqual(rangeFromLink(FIRST, ["2013-01", "2013-06"], N, DEF), [12, 17]);
  assert.deepEqual(rangeFromLink(FIRST, ["2025-01", "2024-01"], N, DEF), [144, 149]);
  assert.deepEqual(rangeFromLink(FIRST, ["2010-01", "2030-01"], N, DEF), [0, 149]);
  assert.deepEqual(rangeFromLink(FIRST, undefined, N, DEF), DEF);
});

test("polyInBounds rejects any vertex outside Paraguay", () => {
  assert.equal(polyInBounds([[-57, -25], [-56, -24], [-58, -23]]), true);
  assert.equal(polyInBounds([[-57, -25], [-56, -24], [10, 50]]), false);
  assert.equal(polyInBounds([[-57, -29], [-56, -24], [-58, -23]]), false);
});

test("closeRing closes an open ring and leaves a closed one alone", () => {
  assert.deepEqual(closeRing([[1, 2], [3, 4], [5, 6]]), [[1, 2], [3, 4], [5, 6], [1, 2]]);
  const closed = [[1, 2], [3, 4], [5, 6], [1, 2]];
  assert.equal(closeRing(closed), closed);
});

test("planRestore: empty state gives the defaults", () => {
  const r = planRestore(FIRST, N, {}, DEF);
  assert.deepEqual(r, { zone: "paraguay", dep: null, coords: null, poly: null, month: 149, range: DEF, cal: "ratio", naive: false, newOnly: false, metric: "count" });
});

test("planRestore: bare custom falls back to Paraguay", () => {
  assert.equal(planRestore(FIRST, N, { zone: "custom" }, DEF).zone, "paraguay");
});

const DEPS = ["boqueron", "alto-paraguay", "central"];

test("planRestore: a known department is restored once departments are loaded", () => {
  const r = planRestore(FIRST, N, { zone: "department", dep: "boqueron", m: "2012-03" }, DEF, DEPS);
  assert.deepEqual([r.zone, r.dep, r.month, r.coords, r.poly], ["department", "boqueron", 2, null, null]);
});

test("planRestore: department falls back to Paraguay when departments are missing, unknown or the link is incomplete", () => {
  const link = { zone: "department" as const, dep: "boqueron" };
  for (const ids of [null, [], ["central"]]) {
    const r = planRestore(FIRST, N, link, DEF, ids);
    assert.deepEqual([r.zone, r.dep], ["paraguay", null]);
  }
  assert.equal(planRestore(FIRST, N, { zone: "department" }, DEF, DEPS).zone, "paraguay");
  assert.equal(planRestore(FIRST, N, { dep: "boqueron" }, DEF, DEPS).zone, "paraguay"); // dep alone is not a department link
  assert.equal(planRestore(FIRST, N, { zone: "department", dep: "PY-11" }, DEF).zone, "paraguay");
});

test("planRestore: coords and poly beat a department", () => {
  const c = { lat: -22.35, lon: -60.03, r: 25 };
  const r = planRestore(FIRST, N, { zone: "department", dep: "boqueron", c }, DEF, DEPS);
  assert.deepEqual([r.zone, r.dep], ["custom", null]);
});

test("planRestore: chaco, coords beat poly, poly out of bounds dropped", () => {
  assert.equal(planRestore(FIRST, N, { zone: "chaco" }, DEF).zone, "chaco");
  const c = { lat: -22.35, lon: -60.03, r: 25 };
  const both = planRestore(FIRST, N, { c, poly: [[-57, -25], [-56, -24], [-58, -23]] }, DEF);
  assert.deepEqual([both.zone, both.coords, both.poly], ["custom", c, null]);
  const bad = planRestore(FIRST, N, { poly: [[-57, -25], [-56, -24], [100, 80]] }, DEF);
  assert.deepEqual([bad.zone, bad.poly], ["paraguay", null]);
  const ok = planRestore(FIRST, N, { poly: [[-57, -25], [-56, -24], [-58, -23]] }, DEF);
  assert.equal(ok.zone, "custom");
  assert.equal(ok.poly!.length, 4);
});

test("planRestore: month, cal, flags", () => {
  const r = planRestore(FIRST, N, { m: "2012-03", cal: "count", naive: true, newOnly: true }, DEF);
  assert.deepEqual([r.month, r.cal, r.naive, r.newOnly], [2, "count", true, true]);
});

test("planRestore: x=frp restores the FRP metric and keeps area and month; default is count", () => {
  const r = planRestore(FIRST, N, { zone: "chaco", m: "2012-03", metric: "frp" }, DEF);
  assert.deepEqual([r.metric, r.zone, r.month], ["frp", "chaco", 2]);
  assert.equal(planRestore(FIRST, N, { zone: "chaco" }, DEF).metric, "count");
});

const BOL = {
  area: "bolivia",
  regions: ["tropical-subtropical-moist-broadleaf-forests", "tropical-subtropical-dry-broadleaf-forests"],
  bbox: [-69.7, -22.95, -57.4, -9.6] as [number, number, number, number],
};

test("polyInBounds uses the country bbox widened to whole degrees", () => {
  assert.equal(polyInBounds([[-63, -17], [-62, -16], [-62.5, -15]], BOL.bbox), true);
  assert.equal(polyInBounds([[-63, -17], [-62, -16], [-62.5, -15]]), false); // Bolivia is outside the Paraguay frame
  assert.equal(polyInBounds([[-57, -25], [-56, -24], [-58, -23]], BOL.bbox), false);
});

test("planRestore for another country: its area, its region presets and its departments", () => {
  const deps = ["beni", "santa-cruz"];
  assert.equal(planRestore(FIRST, N, {}, DEF, deps, BOL).zone, "bolivia");
  assert.equal(planRestore(FIRST, N, { zone: "tropical-subtropical-dry-broadleaf-forests" }, DEF, deps, BOL).zone, "tropical-subtropical-dry-broadleaf-forests");
  assert.equal(planRestore(FIRST, N, { zone: "chaco" }, DEF, deps, BOL).zone, "bolivia"); // a Paraguay preset is not a Bolivia one
  assert.equal(planRestore(FIRST, N, { zone: "custom" }, DEF, deps, BOL).zone, "bolivia");
  const d = planRestore(FIRST, N, { zone: "department", dep: "santa-cruz", m: "2024-06" }, DEF, deps, BOL);
  assert.deepEqual([d.zone, d.dep, d.month], ["department", "santa-cruz", 149]);
  assert.equal(planRestore(FIRST, N, { zone: "department", dep: "alto-paraguay" }, DEF, deps, BOL).zone, "bolivia");
  const poly = planRestore(FIRST, N, { poly: [[-63, -17], [-62, -16], [-62.5, -15]] }, DEF, deps, BOL);
  assert.equal(poly.zone, "custom");
  assert.equal(planRestore(FIRST, N, { poly: [[-57, -25], [-56, -24], [-58, -23]] }, DEF, deps, BOL).zone, "bolivia");
});

test("planRestore: Paraguay presets do not include a biome id", () => {
  assert.equal(planRestore(FIRST, N, { zone: "tropical-subtropical-dry-broadleaf-forests" }, DEF).zone, "paraguay");
});
