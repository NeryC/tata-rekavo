import { test } from "node:test";
import assert from "node:assert/strict";
import { biomePresets } from "./regions.ts";

const cells = (...ids: string[]) => ({ regions: ids.map((id, i) => ({ id, cells: [i * 10, i * 10 + 1] })) });

test("biomePresets: ids in the order of meta.regions.names, a cell knows its region", () => {
  const r = biomePresets(["b", "a"], cells("a", "b"));
  assert.deepEqual(r.ids, ["b", "a"]);
  assert.equal(r.of.get(0), "a");
  assert.equal(r.of.get(10), "b");
});

test("biomePresets: without names the regions.json order; names missing from regions.json are dropped", () => {
  assert.deepEqual(biomePresets(undefined, cells("x", "y")).ids, ["x", "y"]);
  assert.deepEqual(biomePresets(["y", "gone", "x"], cells("x", "y")).ids, ["y", "x"]);
});

test("biomePresets: a single biome is the country itself, so it offers no preset", () => {
  const r = biomePresets(["only"], cells("only"));
  assert.deepEqual(r.ids, []);
  assert.equal(r.of.get(1), "only");
});
