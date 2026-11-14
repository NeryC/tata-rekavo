import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUpdated, isStale } from "./format.ts";

const ISO = "2026-11-14T15:20:52+00:00";

test("formatUpdated renders Asuncion time in Spanish", () => {
  const s = formatUpdated(ISO, "es");
  assert.match(s, /14 nov 2026/);
  assert.match(s, /12:20/);
});

test("formatUpdated renders Asuncion time in English", () => {
  const s = formatUpdated(ISO, "en");
  assert.match(s, /Nov 14, 2026/);
  assert.match(s, /12:20/);
});

test("formatUpdated returns the input when the date is invalid", () => {
  assert.equal(formatUpdated("not a date", "en"), "not a date");
});

test("isStale is false at 47 h and true at 49 h", () => {
  const t0 = Date.parse(ISO);
  assert.equal(isStale(ISO, new Date(t0 + 47 * 3600e3)), false);
  assert.equal(isStale(ISO, new Date(t0 + 49 * 3600e3)), true);
});

test("isStale honours a custom threshold", () => {
  const t0 = Date.parse(ISO);
  assert.equal(isStale(ISO, new Date(t0 + 7 * 3600e3), 6), true);
});

test("isStale is false for an invalid ISO string", () => {
  assert.equal(isStale("garbage", new Date()), false);
});
