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
  // "naive" = what you get by stitching raw sensors: MODIS before VIIRS starts, VIIRS after
  const vs = grid.meta.months.viirs_start_index;
  const naive = Float64Array.from(harmonized, (_, m) => (m < vs ? modis[m] : viirs[m]));
  return { harmonized, modis, viirs, naive };
}

/** Validation panel summary: leave-one-year-out MdAPE and anomaly-class agreement for paraguay/chaco/oriental. */
export function validationSummary(meta) {
  const loyo = meta?.validation?.leave_one_year_out ?? {};
  const agree = meta?.validation?.anomaly_class_agreement ?? {};
  const rows = [];
  for (const [area, key] of [["paraguay", "country"], ["chaco", "chaco"], ["oriental", "oriental"]]) {
    const e = loyo[key];
    if (!e || typeof e.mdape_pct !== "number") continue;
    const pct = agree[key]?.same_class_pct;
    rows.push({
      area,
      mdapePct: Math.round(e.mdape_pct * 10) / 10,
      classAgreementPct: typeof pct === "number" ? Math.round(pct) : null,
    });
  }
  const sp = agree.country?.spearman;
  return { rows, spearman: typeof sp === "number" ? sp : null, nMonths: loyo.country?.n ?? 0 };
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
  for (let k = m - 12; k >= 0; k -= 12) history.push(series[k]);
  const med = median(history) * coverage;
  const ratio = med > 0 ? value / med : (value > 0 ? Infinity : 1);
  const { label, year, month } = monthOf(meta, m);
  return {
    m, label, year, month, value, median: med, ratio, coverage, partial: coverage < 1,
    class: classify(meta, ratio),
    relativeError: relativeError(meta, m, value),
    yearsCompared: history.length,
    rank: coverage < 1 ? null : 1 + history.filter((x) => x > value).length, // 1 = highest on record for that calendar month
  };
}

/** Calendar matrix (years x 12) with ratio to the calendar-month median over the whole record. */
export function calendar(grid, series) {
  const meta = grid.meta, n = grid.nMonths;
  const first = monthOf(meta, 0), last = monthOf(meta, n - 1);
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let m = 0; m < n; m++) byMonth[monthOf(meta, m).month - 1].push(series[m]);
  const med = byMonth.map(median);
  const rows = [];
  for (let y = first.year; y <= last.year; y++) {
    const cells = [];
    for (let mo = 1; mo <= 12; mo++) {
      const m = indexOf(meta, y, mo);
      if (m < 0 || m >= n) { cells.push(null); continue; }
      const v = series[m], ratio = med[mo - 1] > 0 ? v / med[mo - 1] : null;
      cells.push({ m, value: v, ratio, class: ratio === null ? null : classify(meta, ratio).id, relativeError: relativeError(meta, m, v) });
    }
    rows.push({ year: y, cells, total: cells.reduce((s, c) => s + (c ? c.value : 0), 0) });
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

/** CSV text of a zone series, for the download button. */
export function seriesToCSV(grid, s) {
  const lines = ["year,month,harmonized_viirs_equivalent,relative_error,modis_raw_terra_aqua,viirs_snpp_raw"];
  for (let m = 0; m < grid.nMonths; m++) {
    const { year, month } = monthOf(grid.meta, m);
    lines.push([year, month, s.harmonized[m].toFixed(1), relativeError(grid.meta, m, s.harmonized[m]).toFixed(3), s.modis[m], s.viirs[m]].join(","));
  }
  return lines.join("\n") + "\n";
}
