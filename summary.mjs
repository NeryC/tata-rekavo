// Writes summary.json: the latest month's verdict for the whole of every country in the site's index, with the same
// functions the app uses (harmonized.js), so the "South America now" row matches each country's own verdict.
// About 1 kB: the app shows every country at once without loading any country's grid.
// Usage: node summary.mjs [data/app] [out file, default <data dir>/summary.json]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as H from "./harmonized.js";

const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

/** Latest-month verdict of one country's data folder; null when its grid is missing. */
export function countrySummary(dir) {
  const gridJson = readJson(join(dir, "grid.json"));
  if (!gridJson) return null;
  const current = readJson(join(dir, "current.json"));
  const grid = H.decodeGrid(gridJson, current);
  const series = H.zoneSeries(grid, [...grid.cells.keys()]).harmonized;
  const m = grid.nMonths - 1;
  const coverage = H.monthCoverage(grid.meta, m, current ? current.meta : null);
  const v = H.verdict(grid, series, m, coverage);
  const { year, month } = H.monthOf(grid.meta, m);
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    coverage: Math.round(coverage * 1000) / 1000,
    value: r1(v.value), median: r1(v.median),
    ratio: Number.isFinite(v.ratio) ? Math.round(v.ratio * 100) / 100 : null,
    classId: v.class.id,
    generated: current?.meta?.generated ?? null,
  };
}

export function buildSummary(dataDir) {
  const index = readJson(join(dataDir, "countries.json"));
  const countries = {};
  for (const c of index?.countries ?? []) {
    const s = countrySummary(join(dataDir, c.path));
    if (s) countries[c.iso3] = s;
  }
  return { generated: new Date().toISOString(), countries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.argv[2] || "data/app";
  const out = process.argv[3] || join(dataDir, "summary.json");
  const s = buildSummary(dataDir);
  writeFileSync(out, JSON.stringify(s) + "\n");
  console.log(`${out}: ${Object.entries(s.countries).map(([k, v]) => `${k} ${v.month} x${v.ratio} ${v.classId}`).join(", ")}`);
}
