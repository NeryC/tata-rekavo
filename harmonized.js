// Tata Rekavo - reference client logic for the harmonized hotspot record.
// Pure ES module, no dependencies. Works in the browser and in Node >= 18.
// Code written with AI assistance (a large language model) and reviewed by the team.
//
// Data files (produced by firms_pipeline.py):
//   grid.json     harmonized grid x month record, factors, error model, validation
//   current.json  recent VIIRS S-NPP months from the FIRMS API (optional)
//   burn_history.json  ~1 km "last year burned" / "years burned" rasters

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse grid.json (and optionally current.json) into a fast lookup structure. */
export function decodeGrid(gridJson, currentJson = null) {
  const meta = gridJson.meta;
  const cells = new Map();
  let nMonths = meta.months.count;
  for (const [idx, m, h, modis, viirs] of gridJson.cells) {
    cells.set(idx, { m, h, modis, viirs });
  }
  if (currentJson) {
    // current.json months are observed VIIRS S-NPP; they replace/extend the archive months
    for (const [idx, m, n] of currentJson.cells) {
      const c = cells.get(idx) || { m: [], h: [], modis: [], viirs: [] };
      for (let i = 0; i < m.length; i++) {
        const k = c.m.indexOf(m[i]);
        if (k >= 0) { c.h[k] = n[i]; c.viirs[k] = n[i]; }
        else { c.m.push(m[i]); c.h.push(n[i]); c.modis.push(0); c.viirs.push(n[i]); }
        nMonths = Math.max(nMonths, m[i] + 1);
      }
      cells.set(idx, c);
    }
  }
  return { meta, cells, nMonths };
}

const DEFAULT_CLASSES = [
  { id: "low", label: "Below normal", max: 0.5 }, { id: "normal", label: "Normal", max: 1.5 },
  { id: "high", label: "High", max: 3 }, { id: "extreme", label: "Extreme", max: null },
];

/**
 * Parse frp.json (and optionally current.json) into a Grid with the same shape as decodeGrid, so
 * zoneSeries / verdict / calendar / departmentRanking / relativeError work unchanged on fire power (MW).
 *
 * - h holds the harmonized FRP in MW. frp.json carries no raw per-sensor series, so modis and viirs
 *   repeat h (the raw-sensor view is not offered for FRP; naive equals harmonized).
 * - meta is the frp.json meta (grid, months, error_model, validation, experimental) completed with what the
 *   shared functions need and frp.json does not carry: classes and regions come from gridMeta (grid.json meta),
 *   classes falling back to the default thresholds.
 * - current.json months are observed S-NPP FRP, taken from the optional 4th array of each cell
 *   ([idx, m[], n[], frp[]]). A current month without FRP (a file written before FRP was added) is NOT zero:
 *   it is listed in grid.noData and zoneSeries reports NaN for it. If no cell of the file carries the array,
 *   every current month is no data, including months with no hotspot cell (current.meta.month_coverage lists
 *   them). Otherwise a month is no data when any of its cells lacks the array. A month for which frp.json
 *   itself has values (overlap with the archive) is never no data.
 */
export function decodeFrp(frpJson, currentJson = null, gridMeta = null) {
  const fm = frpJson.meta;
  const meta = {
    ...(gridMeta ?? {}), ...fm,
    classes: fm.classes ?? gridMeta?.classes ?? DEFAULT_CLASSES,
    regions: fm.regions ?? gridMeta?.regions,
  };
  const cells = new Map();
  let nMonths = meta.months.count;
  for (const [idx, m, x] of frpJson.cells) cells.set(idx, { m: [...m], h: [...x], modis: [...x], viirs: [...x] });
  const noData = new Set();
  if (currentJson) {
    const hasFrp = (m, frp) => Array.isArray(frp) && frp.length === m.length;
    if (!currentJson.cells.some(([, m, , frp]) => hasFrp(m, frp))) {
      for (const k of Object.keys(currentJson.meta?.month_coverage ?? {})) {
        const m = +k;
        if (Number.isInteger(m)) { noData.add(m); nMonths = Math.max(nMonths, m + 1); }
      }
    }
    for (const [idx, m, , frp] of currentJson.cells) {
      const has = hasFrp(m, frp);
      for (let i = 0; i < m.length; i++) {
        nMonths = Math.max(nMonths, m[i] + 1);
        if (!has) noData.add(m[i]);
      }
      if (!has) continue;
      const c = cells.get(idx) || { m: [], h: [], modis: [], viirs: [] };
      for (let i = 0; i < m.length; i++) {
        const k = c.m.indexOf(m[i]);
        if (k >= 0) { c.h[k] = frp[i]; c.modis[k] = frp[i]; c.viirs[k] = frp[i]; }
        else { c.m.push(m[i]); c.h.push(frp[i]); c.modis.push(frp[i]); c.viirs.push(frp[i]); }
      }
      cells.set(idx, c);
    }
  }
  for (const [, m] of frpJson.cells) for (const k of m) noData.delete(k); // frp.json has values: not missing
  return { meta, cells, nMonths, noData };
}

/** Month index -> {year, month (1-12), label}. */
export function monthOf(meta, m) {
  const [y0, mo0] = meta.months.first.split("-").map(Number);
  const t = (y0 * 12 + (mo0 - 1)) + m;
  const year = Math.floor(t / 12), month = (t % 12) + 1;
  return { year, month, label: `${MONTHS[month - 1]} ${year}` };
}

/** {year, month} -> month index. */
export function indexOf(meta, year, month) {
  const [y0, mo0] = meta.months.first.split("-").map(Number);
  return (year - y0) * 12 + (month - mo0);
}

/** Center of a grid cell as [lon, lat]. */
export function cellCenter(meta, idx) {
  const g = meta.grid, r = Math.floor(idx / g.cols), c = idx % g.cols;
  return [g.lon0 + (c + 0.5) * g.deg, g.lat0 + (r + 0.5) * g.deg];
}

/** Grid cell index of a point. */
export function cellAt(meta, lon, lat) {
  const g = meta.grid;
  const r = Math.floor((lat - g.lat0) / g.deg), c = Math.floor((lon - g.lon0) / g.deg);
  return (r < 0 || c < 0 || r >= g.rows || c >= g.cols) ? -1 : r * g.cols + c;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Cells whose center falls inside a polygon.
 * polygon: GeoJSON-style [[ [lon,lat], ... ]] (outer ring + optional holes) or a single ring [[lon,lat],...].
 */
export function cellsInPolygon(grid, polygon) {
  const rings = Array.isArray(polygon[0][0]) ? polygon : [polygon];
  const out = [];
  for (const idx of grid.cells.keys()) {
    const [x, y] = cellCenter(grid.meta, idx);
    if (pointInRing(x, y, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, y, h))) out.push(idx);
  }
  return out;
}

/** Cells inside a bounding box [west, south, east, north]. */
export function cellsInBBox(grid, [w, s, e, n]) {
  return [...grid.cells.keys()].filter((idx) => {
    const [x, y] = cellCenter(grid.meta, idx);
    return x >= w && x <= e && y >= s && y <= n;
  });
}

/** Monthly series for a set of cells: harmonized, raw MODIS (Terra+Aqua), raw VIIRS S-NPP. */
export function zoneSeries(grid, cellIds) {
  const n = grid.nMonths;
  const harmonized = new Float64Array(n), modis = new Float64Array(n), viirs = new Float64Array(n);
  for (const idx of cellIds) {
    const c = grid.cells.get(idx);
    if (!c) continue;
    for (let i = 0; i < c.m.length; i++) {
      harmonized[c.m[i]] += c.h[i]; modis[c.m[i]] += c.modis[i]; viirs[c.m[i]] += c.viirs[i];
    }
  }
  // months with no data for this metric (FRP before current.json carried it) are unknown, not zero
  if (grid.noData) for (const m of grid.noData) if (m < n) harmonized[m] = modis[m] = viirs[m] = NaN;
  // "naive" = what you get by stitching raw sensors: MODIS before VIIRS starts, VIIRS after
  const vs = grid.meta.months.viirs_start_index;
  const naive = Float64Array.from(harmonized, (_, m) => (m < vs ? modis[m] : viirs[m]));
  return { harmonized, modis, viirs, naive };
}

/**
 * Validation panel summary: leave-one-year-out MdAPE (and, when published, the p90 error and the
 * anomaly-class agreement) for paraguay/chaco/oriental. The country is read from `country` (grid.json)
 * or `paraguay` (frp.json). classAgreementPct is null when absent (frp.json has none); p90Pct is only
 * present on a row when the metric publishes it.
 */
export function validationSummary(meta) {
  const loyo = meta?.validation?.leave_one_year_out ?? {};
  const agree = meta?.validation?.anomaly_class_agreement ?? {};
  const rows = [];
  for (const [area, keys] of [["paraguay", ["country", "paraguay"]], ["chaco", ["chaco"]], ["oriental", ["oriental"]]]) {
    const key = keys.find((k) => typeof loyo[k]?.mdape_pct === "number");
    if (!key) continue;
    const e = loyo[key];
    const pct = agree[key]?.same_class_pct;
    const row = {
      area,
      mdapePct: Math.round(e.mdape_pct * 10) / 10,
      classAgreementPct: typeof pct === "number" ? Math.round(pct) : null,
    };
    if (typeof e.p90_pct === "number") row.p90Pct = Math.round(e.p90_pct * 10) / 10;
    rows.push(row);
  }
  const sp = agree.country?.spearman;
  return { rows, spearman: typeof sp === "number" ? sp : null, nMonths: loyo.country?.n ?? loyo.paraguay?.n ?? 0 };
}

/** Relative error band (median absolute relative error) for a zone-month value. */
export function relativeError(meta, m, value) {
  if (m >= meta.months.viirs_start_index) return 0; // observed VIIRS: no translation error
  const em = meta.error_model;
  const rnd = Math.min(1, em.c * Math.pow(Math.max(value, 1), -em.p));
  const sys = em.sys_by_year[String(monthOf(meta, m).year)] || 0;
  return Math.min(1, Math.sqrt(rnd * rnd + sys * sys));
}

function median(a) {
  a = a.filter((x) => x === x); // NaN = month with no data: not part of the history
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

/** Class for a ratio (value / median), using meta.classes thresholds. */
export function classify(meta, ratio) {
  for (const c of meta.classes) if (c.max === null || ratio < c.max) return c;
  return meta.classes[meta.classes.length - 1];
}

/**
 * Fraction of month m covered by the data (1 for complete months).
 * current: current.json meta (uses its month_coverage), or just its "to" date "YYYY-MM-DD".
 */
export function monthCoverage(meta, m, current) {
  if (!current) return 1;
  if (typeof current === "object") {
    const cov = current.month_coverage && current.month_coverage[String(m)];
    if (cov !== undefined) return cov;
    current = current.to;
  }
  const currentTo = current;
  const { year, month } = monthOf(meta, m);
  const [y, mo, d] = currentTo.split("-").map(Number);
  if (y !== year || mo !== month) return 1;
  return d / new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Verdict for month m: compares the value with the median of the same calendar month
 * over all previous years in the record. For a month still in progress pass
 * coverage < 1 (see monthCoverage): the median is scaled to the elapsed share of the month.
 */
export function verdict(grid, series, m, coverage = 1) {
  const meta = grid.meta;
  const value = series[m];
  const history = [];
  for (let k = m - 12; k >= 0; k -= 12) if (series[k] === series[k]) history.push(series[k]);
  const med = median(history) * coverage;
  const { label, year, month } = monthOf(meta, m);
  if (value !== value) {
    // no data for this month (NaN): nothing to compare. `class` is a placeholder; callers must check noData first
    return {
      m, label, year, month, value, median: med, ratio: NaN, coverage, partial: coverage < 1, noData: true,
      class: classify(meta, 1), relativeError: 0, yearsCompared: history.length, rank: null,
    };
  }
  const ratio = med > 0 ? value / med : (value > 0 ? Infinity : 1);
  return {
    m, label, year, month, value, median: med, ratio, coverage, partial: coverage < 1, noData: false,
    class: classify(meta, ratio),
    relativeError: relativeError(meta, m, value),
    yearsCompared: history.length,
    rank: coverage < 1 ? null : 1 + history.filter((x) => x > value).length, // 1 = highest on record for that calendar month
  };
}

/** Departments with a median below this many hotspots have too little history to rank by ratio. */
const LOW_SIGNAL_MEDIAN = 10;

/**
 * Ranks departments by how abnormal month m is for them.
 * departments: departments.json "departments" array ({id, name, cells}). Each is judged with verdict()
 * on its own harmonized series. Rows with median >= 10 come first, by ratio descending (Infinity first);
 * then the lowSignal rows (median < 10 or no history at all, i.e. NaN median; ratio unreliable) by value descending.
 * Ties: value desc, then name. For a partial month (coverage < 1) lowSignal is judged on the coverage-scaled median.
 * lowSignalMedian (default 10) is that threshold in the unit of the grid: pass a larger one for fire power in MW.
 * Returns [{id, name, value, median, ratio, classId, relativeError, lowSignal, partial}], or [] when m is in grid.noData.
 */
export function departmentRanking(grid, departments, m, coverage = 1, lowSignalMedian = LOW_SIGNAL_MEDIAN) {
  if (grid.noData?.has(m)) return []; // month with no data for this metric: nothing to rank
  const rows = departments.map((d) => {
    const v = verdict(grid, zoneSeries(grid, d.cells).harmonized, m, coverage);
    return {
      id: d.id, name: d.name, value: v.value, median: v.median, ratio: v.ratio,
      classId: v.class.id, relativeError: v.relativeError,
      lowSignal: !(v.median >= lowSignalMedian), partial: v.partial, // !(>=) is also true for a NaN median (no history)
    };
  });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return rows.sort((a, b) =>
    cmp(a.lowSignal, b.lowSignal)
    || (a.lowSignal ? 0 : cmp(b.ratio, a.ratio))
    || cmp(b.value, a.value)
    || a.name.localeCompare(b.name, "es"));
}

// Protected areas: the context.json built by the pipeline holds fire STATISTICS per area (sparse monthly series, no geometry).
const dedupedAreas = new WeakMap();

/** Areas of a context file without repeated records (same name and same series, e.g. two identical biosphere reserve entries). */
function uniqueAreas(context) {
  let list = dedupedAreas.get(context);
  if (!list) {
    const seen = new Set();
    list = context.areas.filter((a) => {
      const key = `${a.name}|${a.m.join(",")}|${a.n.join(",")}|${a.frp.join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    dedupedAreas.set(context, list);
  }
  return list;
}

/** Value of a sparse series ({m, <field>}) at month m: a month that is not listed is 0. */
function sparseAt(series, field, m) {
  const k = series.m.indexOf(m);
  return k < 0 ? 0 : series[field][k];
}

/**
 * Fire inside protected areas for month m, from context.json (statistics per area, no geometry).
 *
 * - zoneId: "paraguay" | "chaco" | "oriental" | a department id (a key of context.zones). Returns null for any other id
 *   (a custom area has no protected-area figures) and when m is later than context.meta.through: the figures stop there
 *   and are never reused for a later month.
 * - metric: "count" uses n (hotspots), "frp" uses frp (MW).
 * - inside: the zone's value for that month from context.zones, which is the UNION of the areas (each hotspot once).
 *   Areas overlap and hotspots count in every area that holds them, so the areas' values can add up to more than inside.
 *   An area that crosses the zone's limits is listed with its whole value.
 * - areas: the areas that overlap the zone (all for paraguay; by `regions` for chaco/oriental, by `departments` for a department),
 *   repeated records removed, sorted by value descending (then name). Each: {id, name, desig, value, median, ratio, classId}.
 *   ratio is value / median of the same calendar month in the area's previous years (missing months count as 0), the median scaled
 *   by `coverage` like verdict() does for a month in progress. median is null when the area has no previous year (m < 12);
 *   ratio and classId are null when there is no history or the median is 0 (too little to compare; treat like a low-signal row).
 *   lowSignal is true when ratio is null or the median is below opts.lowSignalMedian (default 0): too little fire in a typical
 *   month for a ratio to mean much (a median of 0.4 hotspots makes any month look x10). Callers should not show ratio/class then.
 * - opts.classes: class thresholds for classId (grid.json meta.classes; default 0.5 / 1.5 / 3).
 * - opts.zoneValue: the zone's value for the same month in the same unit (from verdict); share = inside / zoneValue, null without it.
 */
export function protectedSummary(context, zoneId, m, metric = "count", coverage = 1, { classes = DEFAULT_CLASSES, zoneValue, lowSignalMedian = 0 } = {}) {
  const zone = context?.zones?.[zoneId];
  if (!zone || !Array.isArray(context.areas)) return null;
  const [ty, tm] = context.meta.through.split("-").map(Number);
  if (m > indexOf({ months: { first: context.meta.first } }, ty, tm)) return null;
  const field = metric === "frp" ? "frp" : "n";
  const inside = sparseAt(zone, field, m);
  const cls = { classes };
  const areas = uniqueAreas(context)
    .filter((a) => zoneId === "paraguay" || (zoneId === "chaco" || zoneId === "oriental" ? a.regions.includes(zoneId) : a.departments.includes(zoneId)))
    .map((a) => {
      const value = sparseAt(a, field, m);
      const history = [];
      for (let k = m - 12; k >= 0; k -= 12) history.push(sparseAt(a, field, k));
      const med = history.length ? median(history) * coverage : null;
      const ratio = med !== null && med > 0 ? value / med : null;
      return {
        id: a.id, name: a.name, desig: a.desig, value, median: med, ratio, classId: ratio === null ? null : classify(cls, ratio).id,
        lowSignal: ratio === null || !(med >= lowSignalMedian),
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "es"));
  return { inside, share: zoneValue > 0 ? inside / zoneValue : null, areas };
}

/** Calendar matrix (years x 12) with ratio to the calendar-month median over the whole record. */
export function calendar(grid, series) {
  const meta = grid.meta, n = grid.nMonths;
  const first = monthOf(meta, 0), last = monthOf(meta, n - 1);
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let m = 0; m < n; m++) if (series[m] === series[m]) byMonth[monthOf(meta, m).month - 1].push(series[m]);
  const med = byMonth.map(median);
  const rows = [];
  for (let y = first.year; y <= last.year; y++) {
    const cells = [];
    for (let mo = 1; mo <= 12; mo++) {
      const m = indexOf(meta, y, mo);
      if (m < 0 || m >= n) { cells.push(null); continue; }
      const v = series[m];
      if (v !== v) { cells.push({ m, value: NaN, ratio: null, class: null, relativeError: 0, noData: true }); continue; }
      const ratio = med[mo - 1] > 0 ? v / med[mo - 1] : null;
      cells.push({ m, value: v, ratio, class: ratio === null ? null : classify(meta, ratio).id, relativeError: relativeError(meta, m, v) });
    }
    rows.push({ year: y, cells, total: cells.reduce((s, c) => s + (c && !c.noData ? c.value : 0), 0) });
  }
  return { rows, monthlyMedian: med };
}

/** Decode burn_history.json into lookups: lastYearBurned(lon, lat) and yearsBurned(lon, lat). */
export function decodeBurnHistory(json) {
  const dec = (b64) => (typeof atob === "function"
    ? Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    : new Uint8Array(Buffer.from(b64, "base64")));
  const last = dec(json.last_year_minus_2000_b64), years = dec(json.years_burned_b64);
  const at = (lon, lat) => {
    const r = Math.floor((lat - json.lat0) / json.deg), c = Math.floor((lon - json.lon0) / json.deg);
    return r < 0 || c < 0 || r >= json.rows || c >= json.cols ? -1 : r * json.cols + c;
  };
  return {
    lastYearBurned: (lon, lat) => { const k = at(lon, lat); return k < 0 || !last[k] ? null : 2000 + last[k]; },
    yearsBurned: (lon, lat) => { const k = at(lon, lat); return k < 0 ? 0 : years[k]; },
  };
}

/**
 * CSV text of a zone series, for the download button. metric "frp" labels the value as MW and drops the
 * raw-sensor columns (frp.json has none); a month with no data is left empty.
 */
export function seriesToCSV(grid, s, { metric = "count" } = {}) {
  const frp = metric === "frp";
  const lines = [frp
    ? "year,month,harmonized_frp_mw_viirs_equivalent,relative_error"
    : "year,month,harmonized_viirs_equivalent,relative_error,modis_raw_terra_aqua,viirs_snpp_raw"];
  for (let m = 0; m < grid.nMonths; m++) {
    const { year, month } = monthOf(grid.meta, m);
    const v = s.harmonized[m];
    if (frp) lines.push([year, month, v === v ? v.toFixed(1) : "", v === v ? relativeError(grid.meta, m, v).toFixed(3) : ""].join(","));
    else lines.push([year, month, v.toFixed(1), relativeError(grid.meta, m, v).toFixed(3), s.modis[m], s.viirs[m]].join(","));
  }
  return lines.join("\n") + "\n";
}

const SEASON_DAYS = 365;
const SEASON_EARLY_DOY = 15;

/**
 * Cumulative hotspot count by day of year for one calendar year.
 *
 * `hotspots` need only a `date` ("YYYY-MM-DD", the UTC FIRMS acq_date). Each hotspot counts 1
 * (observed VIIRS, already S-NPP-equivalent units). Hotspots from other years are ignored.
 * Day-of-year follows the pipeline rule: DOY 1..365, with Feb 29 merged into Feb 28 (DOY 59),
 * so Mar 1 is DOY 60 in every year. Returns a Float64Array(365) where index d-1 holds the
 * count for DOY 1..d (non-decreasing).
 */
export function currentCumulative(hotspots, year) {
  const cum = new Float64Array(SEASON_DAYS);
  const prefix = `${year}-`;
  for (const h of hotspots) {
    const d = h.date;
    if (typeof d !== "string" || !d.startsWith(prefix)) continue;
    const doy = Math.round((Date.UTC(year, +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(year, 0, 1)) / 86400000) + 1;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const idx = (leap && doy >= 60 ? doy - 1 : doy) - 1;
    if (idx >= 0 && idx < SEASON_DAYS) cum[idx] += 1;
  }
  for (let i = 1; i < SEASON_DAYS; i++) cum[i] += cum[i - 1];
  return cum;
}

/**
 * Where this season stands against the historical climatology on a given day.
 *
 * `cum` is the current cumulative curve (see currentCumulative); `clim` is one area of
 * season.json: `{p10, p50, p90}` cumulative curves of length 365; `doy` is 1-based.
 * Returns:
 *  - ratio: cum[doy-1] / p50[doy-1]. 0 when cum is 0 (no division by zero); Infinity when
 *    p50 is 0 but cum > 0.
 *  - band: "below" if cum < p10, "above" if cum > p90, otherwise "within" (all at doy).
 *  - leadDays: how many days ahead of the median the season is. Positive = early (the median
 *    only reaches today's total later), negative = late, 0 = on the median. Computed as
 *    (first DOY at which p50 >= cum[doy-1]) - doy. Where p50 is flat the earliest such DOY is
 *    used. null when it is undefined: cum is 0 (nothing to match) or p50 never reaches cum
 *    during the year.
 *  - early: doy < 15. Too few days of data to compare; callers should say so instead of
 *    showing a verdict.
 */
export function seasonStatus(cum, clim, doy) {
  const i = doy - 1;
  const c = cum[i], p50 = clim.p50[i];
  const ratio = c === 0 ? 0 : p50 === 0 ? Infinity : c / p50;
  const band = c < clim.p10[i] ? "below" : c > clim.p90[i] ? "above" : "within";
  let leadDays = null;
  if (c > 0) {
    for (let d = 0; d < SEASON_DAYS; d++) {
      if (clim.p50[d] >= c) { leadDays = d + 1 - doy; break; }
    }
  }
  return { ratio, band, leadDays, early: doy < SEASON_EARLY_DOY };
}
