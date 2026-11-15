import { test } from "node:test";
import assert from "node:assert/strict";
import { alertRows, alertText, newerSummary, validSummary, type AlertWords } from "./highlights.ts";

const W: AlertWords = {
  head: (c, m) => `Abnormal fire in ${c}, ${m}`,
  row: (r, k) => `×${r} the usual level (${k})`,
  none: (c, m) => `${c}, ${m}: no department with abnormal fire`,
  more: (n) => `…and ${n} more`,
  see: "See:",
  classes: { high: "high", extreme: "extreme", normal: "normal", low: "low" },
};
const fmt = (x: number) => x.toFixed(2);
const row = (name: string, ratio: number, classId: string, lowSignal = false) => ({ name, ratio, classId, lowSignal });

test("alertRows keeps high and extreme departments with signal, highest first", () => {
  const { shown, more } = alertRows([row("A", 1.7, "high"), row("B", 9, "extreme", true), row("C", 0.9, "normal"), row("D", 3.1, "extreme")]);
  assert.deepEqual(shown.map((r) => r.name), ["D", "A"]);
  assert.equal(more, 0);
});

test("alertRows caps the list and counts the rest", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(`D${i}`, 2 + i, "high"));
  const { shown, more } = alertRows(rows, 5);
  assert.equal(shown.length, 5);
  assert.equal(shown[0].name, "D6");
  assert.equal(more, 2);
});

test("alertText lists the abnormal departments and the link", () => {
  const t = alertText([row("Alto Paraguay", 2.4, "high"), row("Central", 0.8, "normal")], "Paraguay", "September 2024", "https://x/?m=2024-09", W, fmt);
  assert.equal(t, "🔥 Abnormal fire in Paraguay, September 2024\n• Alto Paraguay: ×2.40 the usual level (high)\nSee: https://x/?m=2024-09");
});

test("alertText says so when nothing is abnormal", () => {
  const t = alertText([row("Central", 0.8, "normal")], "Peru", "May 2026", "https://x", W, fmt);
  assert.equal(t, "✅ Peru, May 2026: no department with abnormal fire\nSee: https://x");
});

const SUMMARY = { generated: "2026-11-15T17:21:00Z", countries: {
  PRY: { month: "2026-11", coverage: 0.5, value: 3030, median: 5516, ratio: 0.55, classId: "normal", generated: "2026-11-15T17:20:56+00:00" },
} };

test("validSummary accepts the file and drops malformed countries", () => {
  assert.deepEqual(validSummary(SUMMARY), SUMMARY);
  const bad = { ...SUMMARY, countries: { ...SUMMARY.countries, bol: SUMMARY.countries.PRY, URY: { ...SUMMARY.countries.PRY, classId: "hot" } } };
  assert.deepEqual(Object.keys(validSummary(bad)!.countries), ["PRY"]);
  assert.equal(validSummary(null), null);
  assert.equal(validSummary({ countries: {} }), null);
});

test("newerSummary prefers the later file and tolerates nulls", () => {
  const older = { ...SUMMARY, generated: "2026-11-14T00:00:00Z" };
  assert.equal(newerSummary(older, SUMMARY), SUMMARY);
  assert.equal(newerSummary(SUMMARY, older), SUMMARY);
  assert.equal(newerSummary(null, SUMMARY), SUMMARY);
  assert.equal(newerSummary(null, null), null);
});
