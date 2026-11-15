// Checks that harmonized.js reproduces the pipeline's own regional series and behaves sensibly.
// Usage: node test_contract.mjs <app_data_dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as H from "./harmonized.js";
import { buildIndex } from "./countries_index.mjs";
import { validateContext, validateIndigenous } from "./app/src/contextCheck.ts";

const dir = process.argv[2] || "data/app";
const gridJson = JSON.parse(readFileSync(join(dir, "grid.json"), "utf8"));
let currentJson = null;
try { currentJson = JSON.parse(readFileSync(join(dir, "current.json"), "utf8")); } catch {}
const grid = H.decodeGrid(gridJson, currentJson);
const csv = readFileSync(join(dir, "series_regions.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
let fails = 0;
const check = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) fails++; };

// Area names come from series_regions.csv: the first area is the whole country, the others are its regions.
const areas = [...new Set(csv.map((r) => r[0]))];
const countryArea = areas[0];
const regionAreas = areas.slice(1);
const label = (a) => a.charAt(0).toUpperCase() + a.slice(1);
const countryLabel = label(countryArea);
console.log(`     area ${countryArea}, ${regionAreas.length} regions, grid ${gridJson.meta.grid.rows}x${gridJson.meta.grid.cols} at ${gridJson.meta.grid.deg} deg`);

// 1. whole country (all cells) must equal the pipeline's country series, month by month
const all = H.zoneSeries(grid, [...grid.cells.keys()]);
const py = csv.filter((r) => r[0] === countryArea);
// grid.json stores each cell-month rounded to 0.1, so the sum over the n cells of a month carries n independent errors of
// +-0.05 (standard deviation 0.029 each, sqrt(n) * 0.029 for the sum): the allowance is 0.2 * sqrt(n), about 7 sigma, on top
// of the 0.2 % relative tolerance. Visible only when the monthly totals are small (Uruguay, Ecuador).
const cellsInMonth = new Map();
for (const c of grid.cells.values()) for (const m of c.m) cellsInMonth.set(m, (cellsInMonth.get(m) ?? 0) + 1);
let maxDiff = 0, worstUse = 0;
for (const r of py) {
  const m = H.indexOf(grid.meta, +r[1], +r[2]);
  const diff = Math.abs(all.harmonized[m] - +r[3]);
  const tol = 0.002 * Math.abs(+r[3]) + 0.2 * Math.sqrt(cellsInMonth.get(m) ?? 0);
  maxDiff = Math.max(maxDiff, diff / Math.max(1, +r[3]));
  worstUse = Math.max(worstUse, diff / tol);
}
check(worstUse <= 1, `country series matches pipeline (max rel diff ${maxDiff.toExponential(2)}; worst month uses ${(100 * worstUse).toFixed(0)} % of 0.2 % + the 0.1 cell rounding)`);

// 2. polygon selection: a box over the central Chaco (Paraguay) or, for other countries, a box of 10x10 cells
// centred on the grid cell with the most hotspots
const gm = gridJson.meta.grid;
let box, boxName, minCells, side;
if (countryArea === "paraguay") {
  box = [[-61.5, -23.5], [-59.0, -23.5], [-59.0, -21.0], [-61.5, -21.0], [-61.5, -23.5]];
  boxName = "central Chaco box"; minCells = 400; side = 25;
} else {
  let best = -1, bestIdx = 0;
  for (const [idx, , harmonized] of gridJson.cells) {
    const t = harmonized.reduce((a, b) => a + b, 0);
    if (t > best) { best = t; bestIdx = idx; }
  }
  const lon = gm.lon0 + ((bestIdx % gm.cols) + 0.5) * gm.deg, lat = gm.lat0 + (Math.floor(bestIdx / gm.cols) + 0.5) * gm.deg;
  const h = 5 * gm.deg;
  box = [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]];
  boxName = "densest 10x10-cell box"; minCells = 1; side = 10;
}
const ids = H.cellsInPolygon(grid, box);
check(ids.length >= minCells && ids.length <= side * side, `polygon selects ${ids.length} cells (box is ${side}x${side} cells)`);
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
    for (const [name, sel] of [[countryLabel, all], [boxName, s]]) {
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

// 7. burn history (optional file: only countries with burn_history in countries.json)
let bhJson = null;
try { bhJson = JSON.parse(readFileSync(join(dir, "burn_history.json"), "utf8")); } catch {}
// Paraguay ships it ("fire in new places"); for other countries it is optional and the app hides that block without it
if (countryArea === "paraguay") check(bhJson !== null, "burn_history.json present (required for Paraguay)");
if (!bhJson) console.log("     note: burn_history.json not found in " + dir + ", skipping burn-history checks");
else {
  const bh = H.decodeBurnHistory(bhJson);
  // a 2.5 x 2.5 degree box at the centre of the country's grid
  const g = grid.meta.grid, cx = g.lon0 + g.cols * g.deg / 2, cy = g.lat0 + g.rows * g.deg / 2;
  let burned = 0; for (let lat = cy - 1.25; lat < cy + 1.25; lat += 0.01) for (let lon = cx - 1.25; lon < cx + 1.25; lon += 0.01) if (bh.lastYearBurned(lon, lat)) burned++;
  check(burned > 0, `burn history decodes (${burned} of ~62,500 fine cells in the box burned at least once)`);
}

// 8. CSV export
const out = H.seriesToCSV(grid, s);
check(out.split("\n").length === grid.nMonths + 2, `zone CSV has ${grid.nMonths} rows`);

// 9. departments (optional file): the department series add up to the country series
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
  check((countryArea !== "paraguay" || deps.length === 17) && deps.length > 0 && n > 0 && worst < 0.01, `${deps.length} department series sum to the country series in ${n} months with >100 hotspots (max rel diff ${worst.toExponential(2)})`);
}

// 10. harmonized FRP (experimental, optional file): same cell and month index as grid.json
let frp = null;
try { frp = JSON.parse(readFileSync(join(dir, "frp.json"), "utf8")); } catch {}
if (!frp) console.log("     note: frp.json not found in " + dir + ", skipping FRP checks");
else {
  const gridCells = new Set(gridJson.cells.map((c) => c[0]));
  const nm = gridJson.meta.months.count;
  const okCells = frp.cells.every(([idx, m, x]) => gridCells.has(idx) && m.length === x.length && m.every((k) => k >= 0 && k < nm) && x.every((y) => y > 0));
  const lo = frp.meta.validation.leave_one_year_out;
  check(okCells && frp.meta.months.count === nm, `frp.json: ${frp.cells.length} cells on the grid.json index, ${nm} months`);
  console.log(`     FRP leave-one-year-out mdape: ${Object.entries(lo).map(([k, v]) => `${k} ${v.mdape_pct}%`).join(", ")}` +
    (frp.meta.experimental ? " (experimental)" : ""));

  // the decoded country FRP series is the sum of frp.json (plus current.json FRP when it carries it)
  const fgrid = H.decodeFrp(frp, currentJson, gridJson.meta);
  const fall = H.zoneSeries(fgrid, [...fgrid.cells.keys()]);
  const nm0 = frp.meta.months.count;
  const sums = new Float64Array(nm0);
  for (const [, m, x] of frp.cells) for (let i = 0; i < m.length; i++) sums[m[i]] += x[i];
  let worst = 0;
  for (let m = 0; m < nm0; m++) worst = Math.max(worst, Math.abs(fall.harmonized[m] - sums[m]) / Math.max(1, sums[m]));
  check(worst < 0.002, `country FRP series equals the sum of frp.json (max rel diff ${worst.toExponential(2)}, ${nm0} months)`);
  const missing = [...fgrid.noData].sort((a, b) => a - b).map((m) => H.monthOf(fgrid.meta, m).label);
  console.log(`     FRP months without data in current.json: ${missing.length ? missing.join(", ") : "none"}`);
  const vf = H.verdict(fgrid, fall.harmonized, H.indexOf(fgrid.meta, 2024, 9));
  console.log(`     FRP Sep 2024 ${countryLabel}: ${vf.value.toFixed(0)} MW vs median ${vf.median.toFixed(0)} -> x${vf.ratio.toFixed(2)} ${vf.class.label}`);
}

// 11. region presets of a biome country (optional file): cells of each factor region, drawn and summed by the app
let regionsJson = null;
try { regionsJson = JSON.parse(readFileSync(join(dir, "regions.json"), "utf8")); } catch {}
if (!regionsJson) console.log("     note: regions.json not found in " + dir + (gridJson.meta.regions?.kind === "biome" ? " (the app shows no region presets)" : ""));
else {
  const names = gridJson.meta.regions?.names ?? [];
  const seen = new Set();
  let dup = 0, inGrid = 0;
  for (const r of regionsJson.regions) for (const c of r.cells) { if (seen.has(c)) dup++; seen.add(c); }
  for (const idx of grid.cells.keys()) if (seen.has(idx)) inGrid++;
  check(regionsJson.regions.length > 0 && regionsJson.regions.every((r) => names.includes(r.id)) && dup === 0,
    `regions.json: ${regionsJson.regions.length} regions of meta.regions.names, no cell in two regions`);
  check(inGrid / grid.cells.size >= 0.99, `regions.json covers ${(100 * inGrid / grid.cells.size).toFixed(1)}% of the grid cells with data`);
  for (const r of regionsJson.regions) {
    const zs = H.zoneSeries(grid, r.cells);
    const v = H.verdict(grid, zs.harmonized, H.indexOf(grid.meta, 2024, 9));
    const ref = csv.find((x) => x[0] === r.id && +x[1] === 2024 && +x[2] === 9);
    console.log(`     ${r.id}: ${r.cells.length} cells; Sep 2024 ${v.value.toFixed(0)} by cell centre vs ${ref ? (+ref[3]).toFixed(0) : "?"} by hotspot (pipeline) -> x${v.ratio.toFixed(2)}`);
  }
}

// 12. countries index (site root only): in sync with countries.json, every listed country has its data folder
let index = null;
try { index = JSON.parse(readFileSync(join(dir, "countries.json"), "utf8")); } catch {}
if (index) {
  const config = JSON.parse(readFileSync(new URL("./countries.json", import.meta.url), "utf8"));
  const want = buildIndex(config, dir);
  check(JSON.stringify(index) === JSON.stringify(want), `countries.json index in sync with countries.json (${index.countries.map((c) => c.iso3).join(", ")}); regenerate with node countries_index.mjs`);
  check(index.countries.some((c) => c.iso3 === index.default && c.path === ""), `default country ${index.default} is served from the site root`);
}

// 13. fire statistics per protected area (context.json) and per indigenous territory (indigenous.json), optional files:
// they must validate as the app reads them, hold only statistics (no geometry) and cover this country's zones
const readOptional = (f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
const GEOMETRY_KEYS = new Set(["geometry", "coordinates", "bbox", "centroid", "lat", "lon", "latitude", "longitude", "lng"]);
const hasGeometry = (j) => [j, j.meta, ...j.areas].some((o) => Object.keys(o).some((k) => GEOMETRY_KEYS.has(k.toLowerCase())));
for (const [file, validate, label] of [["context.json", validateContext, "protected areas"], ["indigenous.json", validateIndigenous, "indigenous territories"]]) {
  const j = readOptional(file);
  if (!j) { console.log(`     note: ${file} not found in ${dir} (the app shows no ${label} block)`); continue; }
  check(validate(j) !== null, `${file} validates as the app reads it (${j.areas.length} ${label})`);
  check(!hasGeometry(j), `${file} holds statistics only: no geometry, bbox or centroid key`);
  const known = new Set([countryArea, ...(countryArea === "paraguay" ? ["chaco", "oriental"] : gridJson.meta.regions?.names ?? []), ...(readOptional("departments.json")?.departments ?? []).map((d) => d.id)]);
  check(Object.keys(j.zones).every((z) => known.has(z)) && Object.keys(j.zones)[0] === countryArea, `${file} zones are this country's zones (country first: ${countryArea})`);
  const through = j.meta.through.split("-").map(Number);
  const tm = H.indexOf(grid.meta, through[0], through[1]);
  check(tm >= 0 && tm < grid.nMonths, `${file} ends in ${j.meta.through}, a month of the record`);
  if (file === "indigenous.json") check(j.meta.license === "CC BY-SA 4.0" && Array.isArray(j.meta.contributors) && j.meta.contributors.length > 0 && j.areas.length > 0, `${file} names its license (${j.meta.license}) and ${j.meta.contributors.length} contributors`);
}

process.exit(fails ? 1 : 0);
