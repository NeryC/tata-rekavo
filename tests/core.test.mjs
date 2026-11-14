import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, indexOf, monthOf } from "../harmonized.js";

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
