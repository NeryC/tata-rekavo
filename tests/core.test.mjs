import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, indexOf, monthOf, validationSummary, verdict } from "../harmonized.js";

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
