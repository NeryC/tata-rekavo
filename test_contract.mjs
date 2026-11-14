// Checks that harmonized.js reproduces the pipeline's own regional series and behaves sensibly.
// Usage: node test_contract.mjs <app_data_dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as H from "./harmonized.js";

const dir = process.argv[2] || "data/app";
const gridJson = JSON.parse(readFileSync(join(dir, "grid.json"), "utf8"));
let currentJson = null;
try { currentJson = JSON.parse(readFileSync(join(dir, "current.json"), "utf8")); } catch {}
const grid = H.decodeGrid(gridJson, currentJson);
const csv = readFileSync(join(dir, "series_regions.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
let fails = 0;
const check = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) fails++; };

// 1. whole country (all cells) must equal the pipeline's Paraguay series, month by month
const all = H.zoneSeries(grid, [...grid.cells.keys()]);
const py = csv.filter((r) => r[0] === "paraguay");
let maxDiff = 0;
for (const r of py) {
  const m = H.indexOf(grid.meta, +r[1], +r[2]);
  maxDiff = Math.max(maxDiff, Math.abs(all.harmonized[m] - +r[3]) / Math.max(1, +r[3]));
}
check(maxDiff < 0.002, `country series matches pipeline (max rel diff ${maxDiff.toExponential(2)})`);

// 2. polygon selection: a box over the central Chaco
const chacoBox = [[-61.5, -23.5], [-59.0, -23.5], [-59.0, -21.0], [-61.5, -21.0], [-61.5, -23.5]];
const ids = H.cellsInPolygon(grid, chacoBox);
check(ids.length > 400 && ids.length <= 25 * 25, `polygon selects ${ids.length} cells (box is 25x25 cells)`);
const s = H.zoneSeries(grid, ids);

// 3. verdict for a few months
for (const [y, mo] of [[2020, 9], [2024, 9], [2007, 9], [2025, 6]]) {
  const v = H.verdict(grid, s.harmonized, H.indexOf(grid.meta, y, mo));
  console.log(`     ${v.label}: ${v.value.toFixed(0)} vs median ${v.median.toFixed(0)} -> x${v.ratio.toFixed(2)} ${v.class.label}` +
    ` (rank ${v.rank}/${v.yearsCompared + 1}, ±${(v.relativeError * 100).toFixed(0)}%)`);
}

// 3b. months from current.json (FIRMS API), with partial-month correction
if (currentJson) {
  const to = currentJson.meta.to, last = grid.nMonths - 1;
  check(last > grid.meta.months.count - 1, `current.json extends the record to ${H.monthOf(grid.meta, last).label} (data to ${to})`);
  for (let m = grid.meta.months.count; m <= last; m++) {
    for (const [name, sel] of [["Paraguay", all], ["central Chaco box", s]]) {
      const cov = H.monthCoverage(grid.meta, m, currentJson.meta);
      if (cov === 0) { console.log(`     ${H.monthOf(grid.meta, m).label} ${name}: no data fetched yet`); continue; }
      const v = H.verdict(grid, sel.harmonized, m, cov);
      console.log(`     ${v.label} ${name}: ${v.value.toFixed(0)} vs median ${v.median.toFixed(0)}${v.partial ? ` (scaled to ${(v.coverage * 100).toFixed(0)}% of month)` : ""} -> x${v.ratio.toFixed(2)} ${v.class.label}`);
    }
  }
}

// 4. calendar shape
const cal = H.calendar(grid, s.harmonized);
check(cal.rows[0].year === 2002 && cal.rows[0].cells[5] === null && cal.rows[0].cells[6] !== null, "calendar starts in Jul 2002");
console.log(`     calendar ${cal.rows[0].year}-${cal.rows.at(-1).year}, last month ${H.monthOf(grid.meta, grid.nMonths - 1).label}`);

// 5. error model monotone and zero for observed months
const em = (n) => H.relativeError(grid.meta, H.indexOf(grid.meta, 2008, 9), n);
check(em(10) > em(100) && em(100) > em(10000), `error shrinks with size: n=10 ${(em(10) * 100).toFixed(0)}%, n=100 ${(em(100) * 100).toFixed(0)}%, n=10000 ${(em(10000) * 100).toFixed(0)}%`);
check(H.relativeError(grid.meta, H.indexOf(grid.meta, 2020, 9), 50) === 0, "observed VIIRS months have no translation error");

// 6. naive vs harmonized jump, country
const avg = (arr, y0, y1) => { let t = 0, k = 0; for (let m = 0; m < grid.nMonths; m++) { const y = H.monthOf(grid.meta, m).year; if (y >= y0 && y <= y1) { t += arr[m]; k++; } } return t / k; };
console.log(`     2013-2025 vs 2003-2011: naive x${(avg(all.naive, 2013, 2025) / avg(all.naive, 2003, 2011)).toFixed(2)}, harmonized x${(avg(all.harmonized, 2013, 2025) / avg(all.harmonized, 2003, 2011)).toFixed(2)}`);

// 7. burn history
const bh = H.decodeBurnHistory(JSON.parse(readFileSync(join(dir, "burn_history.json"), "utf8")));
let burned = 0; for (let lat = -23.5; lat < -21; lat += 0.01) for (let lon = -61.5; lon < -59; lon += 0.01) if (bh.lastYearBurned(lon, lat)) burned++;
check(burned > 0, `burn history decodes (${burned} of ~62,500 fine cells in the box burned at least once)`);

// 8. CSV export
const out = H.seriesToCSV(grid, s);
check(out.split("\n").length === grid.nMonths + 2, `zone CSV has ${grid.nMonths} rows`);

// 9. departments: the 17 department series add up to the country series
let deps = null;
try { deps = JSON.parse(readFileSync(join(dir, "departments.json"), "utf8")).departments; } catch {}
if (!deps) console.log("     note: departments.json not found in " + dir + ", skipping department checks");
else {
  const sum = new Float64Array(grid.nMonths);
  for (const d of deps) { const hs = H.zoneSeries(grid, d.cells).harmonized; for (let m = 0; m < sum.length; m++) sum[m] += hs[m]; }
  let worst = 0, n = 0;
  for (let m = 0; m < grid.nMonths; m++) {
    if (all.harmonized[m] <= 100) continue;
    n++; worst = Math.max(worst, Math.abs(sum[m] - all.harmonized[m]) / all.harmonized[m]);
  }
  check(deps.length === 17 && n > 0 && worst < 0.01, `${deps.length} department series sum to the country series in ${n} months with >100 hotspots (max rel diff ${worst.toExponential(2)})`);
}

process.exit(fails ? 1 : 0);
