import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, indexOf, monthOf, verdict } from "../harmonized.js";

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
