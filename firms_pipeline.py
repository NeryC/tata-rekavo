#!/usr/bin/env python3
"""
Tata Rekavo - MODIS/VIIRS active-fire harmonization pipeline (per country; Paraguay by default)
NASA Space Apps Challenge 2026 - "Harmonization of MODIS and VIIRS Hot Spots"

Subcommands
  download       Download FIRMS yearly country archives (MODIS, VIIRS S-NPP, VIIRS NOAA-20)
  build          Build the harmonized dataset the web app reads (grid x month, VIIRS-equivalent)
  export-hotspots  Individual hotspots 2002-2025 in 1-degree gzip blocks, for per-search CSV downloads
  validate       Hold-out validation of the harmonization + error model + figure
  build-frp      Harmonized Fire Radiative Power (MW per cell-month, VIIRS S-NPP-equivalent) + its own validation (experimental)
  fetch-current  Pull recent months from the FIRMS Area API (needs a free MAP_KEY); best VIIRS product per day
  build-regions  Department boundaries (geoBoundaries ADM1) and which 0.1-degree grid cells belong to each department

Method (short)
  Unit: "VIIRS S-NPP-equivalent hotspots".
  Factor f(region, calendar month) = VIIRS S-NPP hotspots / MODIS Aqua hotspots,
  computed over the overlap Feb 2012 - Dec 2025 on days where both sensors delivered data.
  Before Feb 2012: Aqua hotspots x f.  From Feb 2012: VIIRS S-NPP observed.
  Sensor outage days are filled with the twin sensor (NOAA-20 for S-NPP, Terra for Aqua).
  Regions: per country (countries.json). Paraguay: Chaco (west of the Paraguay River) / Oriental, approximated by a polyline.
  Every subcommand takes --country ISO3 (default PRY); grids, regions and names come from countries.json.

Code written with AI assistance (a large language model) and reviewed by the team.
"""
import argparse
import base64
import datetime as dt
import glob
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Optional, TypeVar

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------- constants
ARCHIVE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/{src}/{year}/{src}_{year}_{country}.csv"
API_BASE = "https://firms.modaps.eosdis.nasa.gov/api"
ARCHIVE_YEARS = {"modis": range(2000, 2026), "viirs-snpp": range(2012, 2026), "viirs-jpss1": range(2018, 2026)}

START = (2002, 7)       # first full month with MODIS Aqua
VIIRS_START = (2012, 2) # first full month with VIIRS S-NPP
CALIB_END = "2025-12-31"

# outage rules (country-level daily counts, vegetation fires only)
SNPP_OUT_N20 = 10       # S-NPP has 0 hotspots while NOAA-20 has >= 10
SNPP_OUT_AQUA = 5       # ... or Aqua has >= 5 (pre-NOAA-20 period)
AQUA_OUT_TERRA = 30     # Aqua has 0 while Terra has >= 30
AQUA_OUT_SNPP = 100     # ... or S-NPP has >= 100
TERRA_OUT_AQUA = 30

CLASSES = [  # ratio = value / median of the same calendar month
    {"id": "low", "label": "Below normal", "max": 0.5},
    {"id": "normal", "label": "Normal", "max": 1.5},
    {"id": "high", "label": "High", "max": 3.0},
    {"id": "extreme", "label": "Extreme", "max": None},
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def month_index(year, month):
    return (np.asarray(year) - START[0]) * 12 + (np.asarray(month) - START[1])


def index_to_ym(m):
    y, mo = divmod(int(m) + START[1] - 1, 12)
    return START[0] + y, mo + 1


VIIRS_START_IDX = int(month_index(*VIIRS_START))


# ----------------------------------------------------------------------------- country config
COUNTRIES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "countries.json")
DEFAULT_COUNTRY = "PRY"


@dataclass(frozen=True)
class GridSpec:
    """Regular lat/lon grid; cell (row, col) covers [lat0 + row*deg, +deg) x [lon0 + col*deg, +deg)."""
    deg: float
    lat0: float
    lon0: float
    rows: int
    cols: int

    def index(self, r, c):
        return r * self.cols + c


@dataclass(frozen=True)
class CountryConfig:
    """One entry of countries.json. The app grid (deg, lat0, lon0, rows, cols) may be non-square; the burn-history
    (`fine`) and mask grids share its origin. `area` is the id of the whole-country series ("paraguay")."""
    iso3: str
    firms_name: str               # name used in the FIRMS country archive file names
    bbox: tuple                   # west, south, east, north (for the Area API)
    deg: float
    lat0: float
    lon0: float
    rows: int
    cols: int
    regions: dict                 # {"kind": "river-split" | "biome", "names": [...], ...}
    export_hotspots: bool
    burn_history: bool
    name: str = ""                # display name ("Paraguay")
    area: str = ""                # country-level area id in the series ("paraguay")
    fine: dict = field(default_factory=dict)         # {"deg", "rows", "cols"} burn-history grid (~1 km)
    mask: dict = field(default_factory=dict)         # {"deg", "rows", "cols"} country mask used to clip API data
    departments: dict = field(default_factory=dict)  # ADM1 display names / merges / note for build-regions

    @property
    def grid(self):
        return GridSpec(self.deg, self.lat0, self.lon0, self.rows, self.cols)

    @property
    def fine_grid(self):
        return GridSpec(self.fine["deg"], self.lat0, self.lon0, self.fine["rows"], self.fine["cols"])

    @property
    def mask_grid(self):
        return GridSpec(self.mask["deg"], self.lat0, self.lon0, self.mask["rows"], self.mask["cols"])

    @property
    def region_names(self):
        return list(self.regions["names"])

    def region_label(self, region):
        return self.regions.get("labels", {}).get(region, region)


def load_country(iso3, path=None) -> CountryConfig:
    path = path or COUNTRIES_PATH
    with open(path, encoding="utf-8") as fh:
        table = json.load(fh)
    key = str(iso3).upper()
    if key not in table:
        raise ValueError(f"country {iso3!r} not in {path} (known: {', '.join(sorted(table))})")
    c = dict(table[key])
    c["bbox"] = tuple(c["bbox"])
    return CountryConfig(iso3=key, **c)


def region_of(lat, lon, cfg: CountryConfig):
    reg = cfg.regions
    kind = reg.get("kind")
    if kind == "river-split":  # west of the river polyline (latitude -> river longitude) and north of chaco_south
        river = np.interp(lat, reg["river_lat"], reg["river_lon"])
        west, east = reg["names"]
        return np.where((lon < river) & (lat > reg["chaco_south"]), west, east)
    if kind == "biome":
        raise NotImplementedError("biome regions are not implemented yet")
    raise ValueError(f"unknown regions kind {kind!r} for {cfg.iso3}")


def regions_meta(cfg: CountryConfig):
    """Description of the factor regions stored in grid.json."""
    reg = cfg.regions
    if reg["kind"] == "river-split":
        return {"method": reg["method"].format(**reg), "river_lat": reg["river_lat"], "river_lon": reg["river_lon"],
                "chaco_south": reg["chaco_south"]}
    return {"method": reg.get("method", reg["kind"]), "names": cfg.region_names}


def cell_of(lat, lon, g: GridSpec):
    r = np.floor((np.asarray(lat) - g.lat0) / g.deg).astype(int)
    c = np.floor((np.asarray(lon) - g.lon0) / g.deg).astype(int)
    ok = (r >= 0) & (r < g.rows) & (c >= 0) & (c < g.cols)
    return r, c, ok


# ----------------------------------------------------------------------------- retries / atomic writes
T = TypeVar("T")


def _retryable(e):
    """4xx answers (bad key, bad request, not found) will not change on a retry; 429 and 5xx/network errors might."""
    return not (isinstance(e, urllib.error.HTTPError) and 400 <= e.code < 500 and e.code != 429)


def with_retries(fn: Callable[[], T], attempts: int, delay: Callable[[int], float],
                 sleep: Optional[Callable[[float], None]] = None,
                 on_retry: Optional[Callable[[Exception], None]] = None) -> T:
    """Call fn() up to `attempts` times; between failed attempts wait delay(attempt) seconds (attempt is 0-based).
    4xx HTTP errors other than 429 are raised immediately; after the last attempt the last error is raised."""
    sleep = sleep or time.sleep
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as e:
            if not _retryable(e) or attempt == attempts - 1:
                raise
            if on_retry:
                on_retry(e)
            sleep(delay(attempt))
    raise ValueError("attempts must be >= 1")


def redact(text, key):
    """Never let the MAP_KEY reach logs or error messages."""
    return str(text).replace(key, "***") if key else str(text)


def atomic_replace(tmp_paths):
    """Move every <name>.tmp onto <name>; called only once all temp files were written completely."""
    for tmp in tmp_paths:
        os.replace(tmp, tmp[: -len(".tmp")])


# ----------------------------------------------------------------------------- download
def http_get(url, timeout=300):
    req = urllib.request.Request(url, headers={"User-Agent": "tata-rekavo-spaceapps/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def cmd_download(args):
    country = load_country(args.country).firms_name
    os.makedirs(args.data, exist_ok=True)
    jobs = [(s, y) for s, yrs in ARCHIVE_YEARS.items() for y in yrs]
    for src, year in jobs:
        path = os.path.join(args.data, f"{src}_{year}_{country}.csv")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        url = ARCHIVE_URL.format(src=src, year=year, country=country)
        def fetch():
            _, body = http_get(url)
            if not body.startswith(b"latitude"):
                raise ValueError("unexpected content")
            return body

        try:  # connection resets are common: back off and retry (4xx except 429 is final)
            body = with_retries(fetch, attempts=args.retries, delay=lambda a: 2 * (a + 1),
                                on_retry=lambda e: log(f"retry {src} {year}: {e}"))
            with open(path, "wb") as f:
                f.write(body)
            log(f"ok   {src} {year} ({len(body)/1e6:.1f} MB)")
        except urllib.error.HTTPError as e:
            log(f"404  {src} {year} (not published)" if e.code == 404 else f"gave up {src} {year}: HTTP {e.code}")
        except Exception as e:
            log(f"gave up {src} {year}: {e}")
        time.sleep(1)


# ----------------------------------------------------------------------------- load
RENAME = {"bright_ti4": "brightness", "bright_ti5": "brightness_2", "bright_t31": "brightness_2"}


def load_archives(data_dir, firms_name):
    frames = []
    for f in sorted(glob.glob(os.path.join(data_dir, f"*_{firms_name}.csv"))):
        src = os.path.basename(f).split("_")[0]
        df = pd.read_csv(f, dtype={"acq_time": str, "confidence": str, "version": str, "satellite": str})
        df = df.rename(columns=RENAME)
        df["src"] = src
        frames.append(df)
    if not frames:
        sys.exit(f"no FIRMS archives found in {data_dir}; run `download` first")
    a = pd.concat(frames, ignore_index=True)
    a["date"] = pd.to_datetime(a["acq_date"])
    a["year"], a["month"] = a.date.dt.year, a.date.dt.month
    a["sensor"] = np.select(
        [a.satellite == "Aqua", a.satellite == "Terra", a.src == "viirs-snpp", a.src == "viirs-jpss1"],
        ["aqua", "terra", "snpp", "n20"], "other")
    log(f"loaded {len(a):,} hotspots from {data_dir}")
    return a


def vegetation(a):
    return a[a["type"] == 0] if "type" in a.columns else a


# ----------------------------------------------------------------------------- outages & factors
def daily_flags(v):
    """Country-level daily counts per sensor and outage flags."""
    d = v.groupby(["date", "sensor"]).size().unstack(fill_value=0)
    days = pd.date_range(v.date.min(), v.date.max())
    d = d.reindex(days, fill_value=0)
    for s in ["aqua", "terra", "snpp", "n20"]:
        if s not in d:
            d[s] = 0
    d["snpp_out"] = (d.index >= pd.Timestamp(*VIIRS_START, 1)) & (d.snpp == 0) & ((d.n20 >= SNPP_OUT_N20) | (d.aqua >= SNPP_OUT_AQUA))
    d["aqua_out"] = (d.index >= pd.Timestamp(*START, 1)) & (d.aqua == 0) & ((d.terra >= AQUA_OUT_TERRA) | (d.snpp >= AQUA_OUT_SNPP))
    d["terra_out"] = (d.terra == 0) & (d.aqua >= TERRA_OUT_AQUA)
    return d


def compute_factors(v, flags, exclude_years=(), years=None, value_col: Optional[str] = None, regions=None):
    """f[sensor][region][month] = VIIRS S-NPP / MODIS sensor, on clean overlap days.

    regions: the region ids the factors are indexed by (default: every region present in v, sorted).

    value_col=None: ratio of hotspot counts. value_col="frp": ratio of summed values (rows with a NaN value
    are left out of the fit; zero values are kept); a region-month whose MODIS sum is 0 gets no factor (NaN)."""
    regions = sorted(pd.unique(v.region)) if regions is None else list(regions)
    lo, hi = pd.Timestamp(*VIIRS_START, 1), pd.Timestamp(CALIB_END)
    clean_days = flags.index[(flags.index >= lo) & (flags.index <= hi) & ~flags.snpp_out & ~flags.aqua_out & ~flags.terra_out]
    c = v[v.date.isin(clean_days)]
    if years is not None:
        c = c[c.year.isin(years)]
    if len(exclude_years):
        c = c[~c.year.isin(exclude_years)]
    if value_col is None:
        def agg(sel):
            return sel.groupby(["region", "month"]).size()
    else:
        c = c[c[value_col].notna()]

        def agg(sel):
            return sel.groupby(["region", "month"])[value_col].sum()
    num = agg(c[c.sensor == "snpp"])
    out = {}
    for s in ["aqua", "terra"]:
        den = agg(c[c.sensor == s])
        r = num / den
        if value_col is not None:
            r = r.replace([np.inf, -np.inf], np.nan)
        out[s] = r.reindex(pd.MultiIndex.from_product([regions, range(1, 13)]))
    return out, clean_days


def harmonized_weights(v, flags, f, value_col: Optional[str] = None):
    """Weight of every hotspot in the harmonized record (0 = not used).

    With value_col (e.g. "frp", with FRP factors in f) the weight is multiplied by that value (NaN -> 0),
    i.e. the hotspot's contribution to the harmonized FRP sum."""
    w, src = _harmonized_weights(v, flags, f)
    if value_col is not None:
        w = w * np.nan_to_num(v[value_col].to_numpy(dtype=float), nan=0.0)
    return w, src


def _harmonized_weights(v, flags, f):
    day = flags.reindex(v.date)
    snpp_out, aqua_out = day.snpp_out.values, day.aqua_out.values
    n20_has = day.n20.values > 0
    post = (v.date >= pd.Timestamp(*VIIRS_START, 1)).values
    key = pd.MultiIndex.from_arrays([v.region.values, v.month.values])
    fa = f["aqua"].reindex(key).values
    ft = f["terra"].reindex(key).values
    s = v.sensor.values
    w = np.zeros(len(v))
    src = np.full(len(v), "", dtype=object)
    # before Feb 2012: Aqua x f ; Terra x f only on Aqua outage days
    m = ~post & (s == "aqua") & ~aqua_out;                         w[m], src[m] = fa[m], "aqua"
    m = ~post & (s == "terra") & aqua_out;                         w[m], src[m] = ft[m], "terra_fill"
    # from Feb 2012: S-NPP observed ; on S-NPP outage days NOAA-20, else Aqua/Terra x f
    m = post & (s == "snpp") & ~snpp_out;                          w[m], src[m] = 1.0, "snpp"
    m = post & (s == "n20") & snpp_out & n20_has;                  w[m], src[m] = 1.0, "n20_fill"
    m = post & (s == "aqua") & snpp_out & ~n20_has & ~aqua_out;    w[m], src[m] = fa[m], "aqua_fill"
    m = post & (s == "terra") & snpp_out & ~n20_has & aqua_out;    w[m], src[m] = ft[m], "terra_fill"
    return np.nan_to_num(w), src


def bitpack(mask2d):
    return base64.b64encode(np.packbits(mask2d.astype(np.uint8).ravel()).tobytes()).decode()


# ----------------------------------------------------------------------------- build
def grid_meta(g: GridSpec):
    return {"deg": g.deg, "lat0": g.lat0, "lon0": g.lon0, "rows": g.rows, "cols": g.cols,
            "cell_index": "row * cols + col; row = floor((lat-lat0)/deg), col = floor((lon-lon0)/deg)"}


def months_meta(n_months):
    return {"first": "%04d-%02d" % START, "count": n_months, "last": "%04d-%02d" % index_to_ym(n_months - 1),
            "viirs_start_index": VIIRS_START_IDX, "index": "m = (year-%d)*12 + (month-%d)" % START}


def cmd_build(args):
    cfg = load_country(args.country)
    grid = cfg.grid
    os.makedirs(args.out, exist_ok=True)
    a = load_archives(args.data, cfg.firms_name)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values, cfg)
    v["m"] = month_index(v.year.values, v.month.values)
    flags = daily_flags(v)
    f, clean_days = compute_factors(v, flags, regions=cfg.region_names)
    v["w"], v["hsrc"] = harmonized_weights(v, flags, f)
    v = v[v.m >= 0]
    n_months = int(v.m.max()) + 1
    r, c, ok = cell_of(v.latitude.values, v.longitude.values, grid)
    v["cell"] = np.where(ok, grid.index(r, c), -1)
    v = v[v.cell >= 0]

    # --- grid x month table
    g = v.groupby(["cell", "m"])
    h = g.w.sum()
    modis_raw = v[v.sensor.isin(["aqua", "terra"])].groupby(["cell", "m"]).size()
    viirs_raw = v[v.sensor == "snpp"].groupby(["cell", "m"]).size()
    t = pd.DataFrame({"h": h, "modis": modis_raw, "viirs": viirs_raw}).fillna(0)
    t = t[(t.h > 0) | (t.modis > 0) | (t.viirs > 0)].reset_index()
    cells = []
    for cell, grp in t.groupby("cell"):
        cells.append([int(cell), grp.m.astype(int).tolist(), grp.h.round(1).tolist(),
                      grp.modis.astype(int).tolist(), grp.viirs.astype(int).tolist()])
    meta = {
        "name": f"Tata Rekavo harmonized hotspot record - {cfg.name}",
        "unit": "VIIRS S-NPP-equivalent vegetation-fire hotspots per month",
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "grid": grid_meta(grid), "months": months_meta(n_months),
        "cell_columns": ["cell_index", "month_indices", "harmonized", "modis_raw_terra_aqua", "viirs_snpp_raw"],
        "regions": regions_meta(cfg),
        "factors": {s: {reg: [round(float(f[s][(reg, mo)]), 4) for mo in range(1, 13)] for reg in cfg.region_names}
                    for s in ["aqua", "terra"]},
        "factor_definition": "VIIRS S-NPP / MODIS {aqua|terra} hotspots, vegetation fires, clean overlap days %s..%s" % (
            clean_days.min().date(), clean_days.max().date()),
        "classes": CLASSES,
        "sources": ["NASA FIRMS MODIS Collection 6.1 (Terra, Aqua) standard processing",
                    "NASA FIRMS VIIRS 375 m (Suomi NPP, NOAA-20) standard processing"],
    }
    with open(os.path.join(args.out, "grid.json"), "w") as fh:
        json.dump({"meta": meta, "cells": cells}, fh, separators=(",", ":"))
    log(f"grid.json: {len(cells)} cells, {len(t):,} cell-months, {n_months} months")

    # --- outage / fill log
    filled = v[v.hsrc.isin(["n20_fill", "aqua_fill", "terra_fill"])]
    fill_days = filled.groupby(["date", "hsrc"]).w.sum().reset_index()
    fill_days["date"] = fill_days.date.dt.strftime("%Y-%m-%d")
    with open(os.path.join(args.out, "gaps.json"), "w") as fh:
        json.dump({"rules": {"snpp_out": f"S-NPP=0 and (NOAA-20>={SNPP_OUT_N20} or Aqua>={SNPP_OUT_AQUA})",
                             "aqua_out": f"Aqua=0 and (Terra>={AQUA_OUT_TERRA} or S-NPP>={AQUA_OUT_SNPP})"},
                   "snpp_outage_days": int(flags.snpp_out.sum()), "aqua_outage_days": int(flags.aqua_out.sum()),
                   "filled": fill_days.round(1).values.tolist()}, fh, separators=(",", ":"))

    # --- region / country monthly series (CSV + JSON)
    rows = []
    for name, sel in [(cfg.area, v)] + [(reg, v[v.region == reg]) for reg in cfg.region_names]:
        s = pd.DataFrame({"harmonized": sel.groupby("m").w.sum(),
                          "modis_raw": sel[sel.sensor.isin(["aqua", "terra"])].groupby("m").size(),
                          "viirs_snpp_raw": sel[sel.sensor == "snpp"].groupby("m").size()}).reindex(range(n_months)).fillna(0)
        for m_, rr in s.iterrows():
            y, mo = index_to_ym(m_)
            rows.append([name, y, mo, round(rr.harmonized, 1), int(rr.modis_raw), int(rr.viirs_snpp_raw)])
    reg = pd.DataFrame(rows, columns=["area", "year", "month", "harmonized", "modis_raw", "viirs_snpp_raw"])
    reg.to_csv(os.path.join(args.out, "series_regions.csv"), index=False)

    # --- long CSV (cell x month), for analysis / download
    rr, cc = np.divmod(t.cell.values, grid.cols)
    ym = [index_to_ym(m_) for m_ in t.m.values]
    pd.DataFrame({"cell_lat": np.round(grid.lat0 + (rr + 0.5) * grid.deg, 3), "cell_lon": np.round(grid.lon0 + (cc + 0.5) * grid.deg, 3),
                  "year": [y for y, _ in ym], "month": [m_ for _, m_ in ym], "harmonized": t.h.round(1).values,
                  "modis_raw": t.modis.astype(int).values, "viirs_snpp_raw": t.viirs.astype(int).values}
                 ).to_csv(os.path.join(args.out, "grid_monthly.csv"), index=False)

    # --- burn history (~1 km): last year burned and number of years burned, any sensor, Jul 2002 - end
    wrote = ["grid.json", "gaps.json", "series_regions.csv", "grid_monthly.csv"]
    if cfg.burn_history:
        fg = cfg.fine_grid
        fr, fc, fok = cell_of(v.latitude.values, v.longitude.values, fg)
        hist = pd.DataFrame({"k": fg.index(fr, fc)[fok], "y": v.year.values[fok]}).drop_duplicates()
        last = np.zeros(fg.rows * fg.cols, np.uint8); nyr = np.zeros(fg.rows * fg.cols, np.uint8)
        agg = hist.groupby("k").y.agg(["max", "size"])
        last[agg.index.values] = (agg["max"].values - 2000).astype(np.uint8)
        nyr[agg.index.values] = agg["size"].values.astype(np.uint8)
        with open(os.path.join(args.out, "burn_history.json"), "w") as fh:
            json.dump({"deg": fg.deg, "lat0": fg.lat0, "lon0": fg.lon0, "rows": fg.rows, "cols": fg.cols,
                       "period": "%04d-%02d..%s" % (START[0], START[1], meta["months"]["last"]),
                       "last_year_minus_2000_b64": base64.b64encode(last.tobytes()).decode(),
                       "years_burned_b64": base64.b64encode(nyr.tobytes()).decode(),
                       "note": "uint8 arrays, row-major, index = row*cols+col; 0 = never detected"}, fh, separators=(",", ":"))
        wrote.append("burn_history.json")

    # --- country mask (~5.5 km) from every hotspot in the archive, used to clip API data
    mg = cfg.mask_grid
    mr, mc, mok = cell_of(a.latitude.values, a.longitude.values, mg)
    mask = np.zeros((mg.rows, mg.cols), bool); mask[mr[mok], mc[mok]] = True
    with open(os.path.join(args.out, "mask.json"), "w") as fh:
        json.dump({"deg": mg.deg, "lat0": mg.lat0, "lon0": mg.lon0, "rows": mg.rows, "cols": mg.cols,
                   "bits_b64": bitpack(mask), "cells_in_mask": int(mask.sum()),
                   "note": f"cells with at least one FIRMS hotspot in the {cfg.name} country archives 2000-2025"}, fh)
    log("wrote " + ", ".join(wrote + ["mask.json"]))


# ----------------------------------------------------------------------------- season climatology
SEASON_YEARS = (2003, 2025)
SEASON_UNIT = "VIIRS S-NPP-equivalent hotspots, cumulative"


def daily_cumulative(df, years):
    """df[date, area, w] -> {area: array (n_years, 365)} of cumulative daily weights.

    DOY 1..365; Feb 29 is added to Feb 28 (DOY 59), so Mar 1 is DOY 60 in every year."""
    years = list(years)
    yidx = {y: i for i, y in enumerate(years)}
    out = {}
    for area, g in df.groupby("area", sort=False):
        d = pd.DatetimeIndex(g["date"])
        doy = d.day_of_year.values - (d.is_leap_year & (d.day_of_year.values >= 60))
        row = pd.Series(d.year).map(yidx).values
        ok = ~np.isnan(row)
        flat = row[ok].astype(int) * 365 + (doy[ok] - 1)
        daily = np.bincount(flat, weights=g["w"].values[ok], minlength=len(years) * 365)
        out[area] = np.cumsum(daily.reshape(len(years), 365), axis=1)
    return out


def season_percentiles(cum):
    """Per-DOY p10/p50/p90 across years of the cumulative curves (monotone by construction)."""
    q = np.percentile(cum, [10, 50, 90], axis=0)
    return {k: np.round(row, 1).tolist() for k, row in zip(("p10", "p50", "p90"), q)}


def cmd_build_season(args):
    cfg = load_country(args.country)
    a = load_archives(args.data, cfg.firms_name)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values, cfg)
    flags = daily_flags(v)
    f, _ = compute_factors(v, flags, regions=cfg.region_names)
    v["w"], _ = harmonized_weights(v, flags, f)
    r, c, ok = cell_of(v.latitude.values, v.longitude.values, cfg.grid)
    v["cell"] = np.where(ok, cfg.grid.index(r, c), -1)
    v = v[(v.cell >= 0) & v.year.between(*SEASON_YEARS)][["date", "region", "cell", "w"]]
    parts = [v.assign(area=cfg.area), v.assign(area=v.region)]
    dp = os.path.join(args.out, "departments.json")
    if os.path.exists(dp):
        with open(dp, encoding="utf-8") as fh:
            deps = json.load(fh)["departments"]
        cell_dept = pd.Series({cl: d["id"] for d in deps for cl in d["cells"]})
        area = v.cell.map(cell_dept)
        parts.append(v.assign(area=area)[area.notna().values])
    else:
        log("departments.json missing: emitting only the country and its regions")
    years = list(range(SEASON_YEARS[0], SEASON_YEARS[1] + 1))
    cum = daily_cumulative(pd.concat(parts, ignore_index=True)[["date", "area", "w"]], years)
    head = [cfg.area] + cfg.region_names
    order = head + sorted(k for k in cum if k not in head)
    doc = {"meta": {"years": list(SEASON_YEARS), "doy": 365, "unit": SEASON_UNIT,
                    "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")},
           "areas": {k: season_percentiles(cum[k]) for k in order if k in cum}}
    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, "season.json")
    with open(out + ".tmp", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    atomic_replace([out + ".tmp"])
    log(f"season.json: {len(doc['areas'])} areas, {os.path.getsize(out):,} bytes")


# ----------------------------------------------------------------------------- validate
def validation_levels(cfg: CountryConfig):
    """Aggregation levels of the validation: the country, each factor region, blocks and cells (key columns)."""
    return {"country": [], **{reg: ["region"] for reg in cfg.region_names}, "block_1deg": ["blk1"],
            "cell_0.5deg": ["g05"], "cell_0.25deg": ["g025"], "cell_0.1deg": ["g01"]}


VALIDATION_MIN_OBS = {"block_1deg": 50, "cell_0.5deg": 30, "cell_0.25deg": 20, "cell_0.1deg": 10}  # country / regions: 1


def validation_frame(v, clean_days, cfg: CountryConfig):
    """Hotspots of the clean overlap days, with the block / cell keys of every validation level."""
    c = v[v.date.isin(clean_days)].copy()
    c["blk1"] = (np.floor(c.latitude).astype(int) * 1000 + np.floor(c.longitude).astype(int))
    for deg, name in [(0.1, "g01"), (0.25, "g025"), (0.5, "g05")]:
        c[name] = (np.floor((c.latitude - cfg.lat0) / deg).astype(int) * 1000 + np.floor((c.longitude - cfg.lon0) / deg).astype(int))
    return c


def predict_holdout(v, flags, c, train_years, test_years, value_col: Optional[str] = None):
    """Aqua factors fitted on train_years, applied to the test years of c. Returns (S-NPP rows, Aqua rows with p),
    p = factor (counts) or factor x value_col (e.g. FRP)."""
    fa, _ = compute_factors(v, flags, years=train_years, value_col=value_col)
    te = c[c.year.isin(test_years)]
    aq = te[te.sensor == "aqua"]
    key = pd.MultiIndex.from_arrays([aq.region.values, aq.month.values])
    p = fa["aqua"].reindex(key).values
    if value_col is not None:
        p = p * aq[value_col].to_numpy(dtype=float)
    aq = aq.assign(p=p)
    return te[te.sensor == "snpp"], aq


def loyo_pairs(v, flags, c, levels, value_col: Optional[str] = None):
    """Leave-one-year-out observed vs predicted tables per aggregation level (zone x month).
    A level keyed by ["region"] is the region named like the level (see validation_levels)."""
    years = sorted(c.year.unique())

    def table(obs, aq, by):
        g = obs.groupby(by + ["m"])
        o = (g.size() if value_col is None else g[value_col].sum()).rename("obs")
        p = aq.groupby(by + ["m"]).p.sum().rename("pred")
        return pd.concat([o, p], axis=1).fillna(0)

    pairs = {k: [] for k in levels}
    for y in years:
        obs, aq = predict_holdout(v, flags, c, [x for x in years if x != y], [y], value_col)
        for k, by in levels.items():
            tb = table(obs, aq, by).reset_index()
            if by == ["region"]:
                tb = tb[tb.region == k]
            pairs[k].append(tb)
    return {k: pd.concat(x) for k, x in pairs.items()}


def loyo_stats(t, thr):
    """Median / 90th-percentile absolute percentage error over zone-months with obs >= thr; bias over all."""
    s = t[t.obs >= thr]
    ape = np.abs(s.pred - s.obs) / s.obs
    return {"mdape_pct": round(float(np.median(ape) * 100), 1),
            "p90_ape_pct": round(float(np.quantile(ape, .9) * 100), 1),
            "bias_pct": round(float((t.pred.sum() / t.obs.sum() - 1) * 100), 1), "n": int((t.obs >= thr).sum()),
            "min_obs": thr}


def fit_error_model(tables):
    """Median relative error vs predicted value, pooled over the given obs/pred tables; power law
    rel = c * n^(-p) fitted in log space, weighted by bin size. Returns (c, p, bin table)."""
    pool = pd.concat([t[["obs", "pred"]] for t in tables])
    pool = pool[pool.pred >= 1]
    pool["rel"] = np.abs(pool.obs - pool.pred) / pool.pred
    bins = np.unique(np.round(np.logspace(0, np.log10(pool.pred.max()), 30)))
    pool["bin"] = pd.cut(pool.pred, bins)
    bstat = pool.groupby("bin", observed=True).agg(n=("pred", "median"), rel=("rel", "median"), k=("rel", "size"))
    bstat = bstat[bstat.k >= 30]
    slope, intercept = np.polyfit(np.log(bstat.n.values), np.log(bstat.rel.values), 1, w=np.sqrt(bstat.k.values))
    return float(np.exp(intercept)), float(-slope), bstat


def systematic_by_year(v, clean_days, f_aqua, value_col: Optional[str] = None):
    """Systematic term for the reconstructed years: Aqua-based vs Terra+Aqua-based reconstruction (country, yearly)."""
    cl = v[v.date.isin(clean_days)]
    if value_col is None:
        num = cl[cl.sensor == "snpp"].groupby(["region", "month"]).size()
        den = cl[cl.sensor.isin(["aqua", "terra"])].groupby(["region", "month"]).size()
    else:
        cl = cl[cl[value_col].notna()]
        num = cl[cl.sensor == "snpp"].groupby(["region", "month"])[value_col].sum()
        den = cl[cl.sensor.isin(["aqua", "terra"])].groupby(["region", "month"])[value_col].sum()
    f_ta = (num / den)
    pre = v[(v.m >= 0) & (v.m < VIIRS_START_IDX)]
    ka = pd.MultiIndex.from_arrays([pre.region.values, pre.month.values])
    fa_, fta_ = f_aqua.reindex(ka).values, f_ta.reindex(ka).values
    if value_col is not None:
        x = pre[value_col].to_numpy(dtype=float)
        fa_, fta_ = fa_ * x, fta_ * x
    rec_a = pd.Series(np.where(pre.sensor == "aqua", fa_, 0), index=pre.index).groupby(pre.year).sum()
    rec_ta = pd.Series(np.where(pre.sensor.isin(["aqua", "terra"]), fta_, 0), index=pre.index).groupby(pre.year).sum()
    return {int(y): round(float(abs(rec_ta[y] / rec_a[y] - 1)), 3) for y in rec_a.index}


def error_model_doc(ec, ep, bstat, sys_by_year, what):
    """The error model as stored in metrics.json / grid.json (what = the quantity n stands for)."""
    def rel_err(n):
        return min(1.0, ec * max(n, 1) ** -ep)
    return {
        "formula": f"relative_error(n) = min(1, c * n^(-p)) where n = {what} in the zone-month; "
                   "for months before viirs_start add the systematic term in quadrature: sqrt(rel^2 + sys[year]^2); "
                   "months from viirs_start are observed (no translation error)",
        "c": round(ec, 4), "p": round(ep, 4), "sys_by_year": sys_by_year,
        "meaning": "median absolute relative error (about half of zone-months fall inside the band)",
        "fit_bins": [[round(float(n), 1), round(float(r), 4), int(k), round(rel_err(n), 4)] for n, r, k in bstat[["n", "rel", "k"]].values],
    }


def cmd_validate(args):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.stats import spearmanr

    cfg = load_country(args.country)
    regions = cfg.region_names
    a = load_archives(args.data, cfg.firms_name)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values, cfg)
    v["m"] = month_index(v.year.values, v.month.values)
    flags = daily_flags(v)
    _, clean_days = compute_factors(v, flags, regions=regions)
    c = validation_frame(v, clean_days, cfg)
    levels = validation_levels(cfg)

    # leave-one-year-out
    pairs = loyo_pairs(v, flags, c, levels)
    thr = {k: VALIDATION_MIN_OBS.get(k, 1) for k in levels}
    loyo = {k: loyo_stats(t, thr[k]) for k, t in pairs.items()}

    # backward extrapolation: train 2019-2025, test 2012-2018
    obs, aq = predict_holdout(v, flags, c, list(range(2019, 2026)), list(range(2012, 2019)))
    bo = obs.groupby("year").size(); bp = aq.groupby("year").p.sum()
    backward = {int(y): round(float((bp[y] / bo[y] - 1) * 100), 1) for y in bo.index}

    # anomaly agreement (value / median of same calendar month), country & region
    def classes(x):
        return pd.cut(x, [-1, .5, 1.5, 3, 1e9], labels=False)
    agree = {}
    for k in ["country", *regions, "block_1deg"]:
        t = pairs[k].copy()
        idx = levels[k] if k == "block_1deg" else []
        t["month"] = (t.m + START[1] - 1) % 12 + 1
        for col in ["obs", "pred"]:
            t["a_" + col] = t[col] / t.groupby(idx + ["month"])[col].transform("median")
        t = t[t.groupby(idx + ["month"]).obs.transform("median") >= 30].dropna(subset=["a_obs", "a_pred"])
        agree[k] = {"spearman": round(float(spearmanr(t.a_obs, t.a_pred)[0]), 3),
                    "same_class_pct": round(float((classes(t.a_obs) == classes(t.a_pred)).mean() * 100), 1), "n": int(len(t))}

    # error model: median relative error vs predicted count, pooled over all aggregation levels
    ec, ep, bstat = fit_error_model(pairs.values())

    def rel_err(n):
        return min(1.0, ec * max(n, 1) ** -ep)

    f_all, _ = compute_factors(v, flags, regions=regions)
    sys_by_year = systematic_by_year(v, clean_days, f_all["aqua"])
    error_model = error_model_doc(ec, ep, bstat, sys_by_year, "harmonized hotspots")
    metrics = {"method": "Aqua-based factor per region x calendar month, clean overlap days",
               "leave_one_year_out": loyo, "backward_train_2019_2025_bias_pct": backward,
               "anomaly_class_agreement": agree, "error_model": error_model,
               "snpp_outage_days": int(flags.snpp_out.sum()), "aqua_outage_days": int(flags.aqua_out.sum())}
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=1)
    gpath = os.path.join(args.out, "grid.json")
    if os.path.exists(gpath):  # store the error model next to the data the app reads
        with open(gpath) as fh:
            g = json.load(fh)
        g["meta"]["error_model"] = {k: error_model[k] for k in ["formula", "c", "p", "sys_by_year", "meaning"]}
        g["meta"]["validation"] = {"leave_one_year_out": loyo, "anomaly_class_agreement": agree}
        with open(gpath, "w") as fh:
            json.dump(g, fh, separators=(",", ":"))

    # figure
    series = pd.read_csv(os.path.join(args.out, "series_regions.csv")) if os.path.exists(os.path.join(args.out, "series_regions.csv")) else None
    fig, ax = plt.subplots(1, 3, figsize=(17, 4.8))
    if series is not None:
        s = series[(series.area == cfg.area) & (series.year.between(2003, 2025))].groupby("year")[["harmonized", "modis_raw", "viirs_snpp_raw"]].sum()
        naive = np.where(s.index >= 2012, s.viirs_snpp_raw, s.modis_raw)
        ax[0].bar(s.index, naive, color=["#8a8a8a" if y < 2012 else "#d95f02" for y in s.index])
        ax[0].set_title("Naive record: MODIS until 2011, VIIRS after\n(the jump is the sensor, not the fire)")
        ax[1].bar(s.index, s.harmonized, color=["#7570b3" if y < 2012 else "#d95f02" for y in s.index])
        pre_y = s.index[s.index < 2012]
        err = [np.sqrt(rel_err(hh) ** 2 + sys_by_year.get(int(y), 0) ** 2) * hh for y, hh in zip(pre_y, s.harmonized[pre_y])]
        ax[1].errorbar(pre_y, s.harmonized[pre_y], yerr=err, fmt="none", ecolor="black", capsize=3, lw=1.2)
        ax[1].set_title("Harmonized record (VIIRS S-NPP equivalent)\npurple = MODIS Aqua translated, orange = VIIRS observed")
        for x in ax[:2]:
            x.set_ylabel(f"vegetation-fire hotspots per year, {cfg.name}")
            x.set_ylim(0, max(naive.max(), s.harmonized.max()) * 1.12)
    palette = ["#1b9e77", "#e7298a", "#7570b3", "#e6ab02", "#66a61e", "#a6761d"]
    t = pd.concat([pairs[reg].assign(r=reg) for reg in regions])
    t = t[t.obs > 0]
    colors = t.r.map({reg: palette[i % len(palette)] for i, reg in enumerate(regions)}).values
    ax[2].scatter(t.obs, t.pred, s=12, alpha=.6, c=colors)
    lim = [10, t.obs.max() * 1.4]
    ax[2].plot(lim, lim, "k--", lw=1); ax[2].set_xscale("log"); ax[2].set_yscale("log"); ax[2].set_xlim(lim); ax[2].set_ylim(lim)
    ax[2].set_xlabel("VIIRS S-NPP observed (region-month)"); ax[2].set_ylabel("predicted from MODIS Aqua, year held out")
    ax[2].set_title("Hold-out validation 2012-2025\nmedian error: " +
                    ", ".join("%s %.1f%%" % (cfg.region_label(reg), loyo[reg]["mdape_pct"]) for reg in regions))
    fig.text(0.5, -0.02, f"Data: NASA FIRMS (MODIS C6.1 Terra/Aqua, VIIRS 375 m S-NPP/NOAA-20), {cfg.name}, vegetation fires. "
             "Error bars: modelled median error. AI-assisted figure.", ha="center", fontsize=8.5)
    plt.tight_layout()
    plt.savefig(os.path.join(args.out, "validation.png"), dpi=130, bbox_inches="tight")
    log(json.dumps({"leave_one_year_out": loyo, "backward": backward, "agreement": agree,
                    "error_model": {"c": error_model["c"], "p": error_model["p"], "sys_by_year": sys_by_year}}, indent=1))


# ----------------------------------------------------------------------------- build-frp (experimental)
FRP_UNIT = "MW (sum of FRP), VIIRS S-NPP-equivalent"
FRP_EXPERIMENTAL_MDAPE = 25.0   # country leave-one-year-out median error above this -> experimental
FRP_MIN_OBS = 1.0               # MW; zone-months below this are left out of mdape / p90 (as 1 hotspot for counts)


def frp_cells(t):
    """t[cell, m, frp] -> [[cell, [m...], [frp...]]] with FRP rounded to 0.1 MW; cell-months that round to 0 are dropped."""
    t = t.assign(frp=t.frp.round(1))
    t = t[t.frp > 0].sort_values(["cell", "m"])
    return [[int(cell), g.m.astype(int).tolist(), g.frp.tolist()] for cell, g in t.groupby("cell")]


def _nan_none(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 4)


def cmd_build_frp(args):
    """Harmonized Fire Radiative Power: same method as the counts with FRP sums (factor = sum S-NPP FRP /
    sum MODIS FRP per region x calendar month on clean overlap days), own leave-one-year-out validation."""
    t0 = time.time()
    cfg = load_country(args.country)
    os.makedirs(args.out, exist_ok=True)
    a = load_archives(args.data, cfg.firms_name)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values, cfg)
    v["m"] = month_index(v.year.values, v.month.values)
    flags = daily_flags(v)
    f, clean_days = compute_factors(v, flags, value_col="frp", regions=cfg.region_names)
    v["w"], v["hsrc"] = harmonized_weights(v, flags, f, value_col="frp")

    # leave-one-year-out validation + error model, exactly as for the counts
    c = validation_frame(v, clean_days, cfg)
    pairs = loyo_pairs(v, flags, c, validation_levels(cfg), value_col="frp")
    loyo = {}
    for name, level in [(cfg.area, "country")] + [(reg, reg) for reg in cfg.region_names]:
        s = loyo_stats(pairs[level], FRP_MIN_OBS)
        loyo[name] = {"mdape_pct": s["mdape_pct"], "p90_pct": s["p90_ape_pct"], "bias_pct": s["bias_pct"]}
    ec, ep, bstat = fit_error_model(pairs.values())
    sys_by_year = systematic_by_year(v, clean_days, f["aqua"], value_col="frp")
    em = error_model_doc(ec, ep, bstat, sys_by_year, "harmonized FRP (MW)")

    # cell x month FRP grid, same cell / month index as grid.json
    v = v[v.m >= 0]
    n_months = int(v.m.max()) + 1
    r, cc, ok = cell_of(v.latitude.values, v.longitude.values, cfg.grid)
    v = v.assign(cell=np.where(ok, cfg.grid.index(r, cc), -1))
    v = v[v.cell >= 0]
    t = v.groupby(["cell", "m"]).w.sum().rename("frp").reset_index()
    cells = frp_cells(t)
    meta = {
        "name": f"Tata Rekavo harmonized Fire Radiative Power - {cfg.name} (experimental)",
        "unit": FRP_UNIT,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "grid": grid_meta(cfg.grid), "months": months_meta(n_months),
        "cell_columns": ["cell_index", "month_indices", "frp_mw"],
        "cells_note": "only cell-months with harmonized FRP > 0 (rounded to 0.1 MW)",
        "factors": {s: {reg: [_nan_none(f[s][(reg, mo)]) for mo in range(1, 13)] for reg in cfg.region_names} for s in ["aqua", "terra"]},
        "factor_definition": "sum of VIIRS S-NPP FRP / sum of MODIS {aqua|terra} FRP, vegetation fires, clean overlap days %s..%s; "
                             "applied to each MODIS hotspot's FRP, S-NPP (and NOAA-20 fill) FRP used as observed" % (
                                 clean_days.min().date(), clean_days.max().date()),
        "validation": {"leave_one_year_out": loyo},
        "validation_note": "Aqua FRP x factor fitted without the held-out year vs S-NPP FRP observed, zone-months with "
                           ">= %g MW; mdape = median, p90 = 90th percentile of the absolute percentage error" % FRP_MIN_OBS,
        "error_model": {k: em[k] for k in ["formula", "c", "p", "sys_by_year", "meaning"]},
        "experimental": bool(loyo[cfg.area]["mdape_pct"] > FRP_EXPERIMENTAL_MDAPE),
        "experimental_rule": "true when the country leave-one-year-out mdape_pct > %g" % FRP_EXPERIMENTAL_MDAPE,
        "sources": ["NASA FIRMS MODIS Collection 6.1 (Terra, Aqua) standard processing",
                    "NASA FIRMS VIIRS 375 m (Suomi NPP, NOAA-20) standard processing"],
    }
    path = os.path.join(args.out, "frp.json")
    with open(path + ".tmp", "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"meta": meta, "cells": cells}, fh, separators=(",", ":"))
    atomic_replace([path + ".tmp"])
    log(json.dumps({"leave_one_year_out": loyo, "experimental": meta["experimental"],
                    "error_model": {"c": em["c"], "p": em["p"]}, "factors": meta["factors"]}))
    log(f"frp.json: {len(cells)} cells, {sum(len(x[1]) for x in cells):,} cell-months, "
        f"{os.path.getsize(path) / 1e6:.2f} MB, {time.time() - t0:.0f} s")


# ----------------------------------------------------------------------------- fetch-current
def api_csv(url):
    status, body = http_get(url, timeout=120)
    txt = body.decode("utf-8", "replace")
    if not txt.startswith("latitude"):  # a valid answer always starts with the CSV header, even with zero rows
        raise RuntimeError(f"FIRMS API error (not CSV): {txt[:200]!r}")
    return pd.read_csv(io.StringIO(txt), dtype={"acq_time": str, "confidence": str, "version": str, "satellite": str})


def availability(key):
    try:
        _, body = with_retries(lambda: http_get(f"{API_BASE}/data_availability/csv/{key}/ALL", timeout=60),
                               attempts=6, delay=lambda a: 3 * (a + 1),
                               on_retry=lambda e: log(f"retry data_availability: {redact(e, key)}"))
    except Exception as e:
        log(f"FIRMS data_availability endpoint unreachable: {redact(e, key)}")
        sys.exit(2)
    d = pd.read_csv(io.StringIO(body.decode()))
    log("availability: " + ", ".join(f"{k} {v[0].date()}..{v[1].date()}" for k, v in
                                     {r.data_id: (pd.Timestamp(r.min_date), pd.Timestamp(r.max_date)) for r in d.itertuples()}.items()
                                     if k.startswith("VIIRS_SNPP")))
    return {r.data_id: (pd.Timestamp(r.min_date), pd.Timestamp(r.max_date)) for r in d.itertuples()}


PRODUCT_PREFERENCE = ["VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "VIIRS_NOAA21_SP",
                      "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]


def plan_requests(start, end, av):
    """Best product per day (S-NPP first; NOAA-20/21 when S-NPP has no data), grouped into <=5-day requests."""
    days = pd.date_range(start, end)
    pick = []
    for d in days:
        p = next((p for p in PRODUCT_PREFERENCE if p in av and av[p][0] <= d <= av[p][1]), None)
        pick.append(p)
    reqs, i = [], 0
    while i < len(days):
        p, j = pick[i], i
        while j < len(days) and pick[j] == p and (days[j] - days[i]).days < 5:
            j += 1
        if p:
            reqs.append((p, days[i], j - i))
        i = j
    return reqs


def cmd_fetch_current(args):
    key = args.map_key or os.environ.get("FIRMS_MAP_KEY")
    if not key and not args.offline:
        sys.exit("set FIRMS_MAP_KEY or pass --map-key (free key: https://firms.modaps.eosdis.nasa.gov/api/map_key/)")
    cfg = load_country(args.country)
    mg, grid = cfg.mask_grid, cfg.grid
    with open(os.path.join(args.out, "mask.json")) as fh:
        mk = json.load(fh)
    mask = np.unpackbits(np.frombuffer(base64.b64decode(mk["bits_b64"]), np.uint8))[: mg.rows * mg.cols].reshape(mg.rows, mg.cols).astype(bool)
    start = pd.Timestamp(args.start)
    end = pd.Timestamp(args.end) if args.end else pd.Timestamp(dt.date.today())
    cache = args.cache
    os.makedirs(cache, exist_ok=True)
    rd = {"acq_time": str, "confidence": str, "version": str, "satellite": str}

    if args.offline:  # use every cached request inside [start, end]
        reqs = []
        for f in sorted(glob.glob(os.path.join(cache, "VIIRS_*.csv"))):
            name = os.path.basename(f)[:-4]
            prod, d0, span = name.rsplit("_", 2)
            reqs.append((prod, pd.Timestamp(d0), int(span)))
        reqs = [r for r in reqs if r[1] >= start and r[1] <= end]
    else:
        av = availability(key)
        reqs = plan_requests(start, end, av)
    log(f"{len(reqs)} requests: " + ", ".join(sorted({p for p, _, _ in reqs})))

    frames, got = [], {}
    for prod, day, span in sorted(reqs, key=lambda r: r[1], reverse=True):  # newest first
        cpath = os.path.join(cache, f"{prod}_{day.date()}_{span}.csv")
        # NRT requests that may still receive data (last 3 days) are never cached
        cacheable = day + pd.Timedelta(days=span + 2) < pd.Timestamp(dt.date.today())
        if os.path.exists(cpath) and (cacheable or args.offline):
            df = pd.read_csv(cpath, dtype=rd)
        elif args.offline:
            continue
        else:
            url = f"{API_BASE}/area/csv/{key}/{prod}/{','.join(map(str, cfg.bbox))}/{span}/{day.date()}"
            try:
                df = with_retries(lambda: api_csv(url), attempts=10, delay=lambda a: min(60, 4 * (a + 1)),
                                  on_retry=lambda e: log(f"retry {day.date()} {prod}: {redact(e, key)}"))
            except Exception as e:
                log(f"failed {redact(url, key)}: {redact(e, key)} - run again, finished requests are cached in {cache}")
                sys.exit(2)
            # always cache (recent NRT requests are re-fetched on the next online run anyway)
            tmp = cpath + ".tmp"
            (df if len(df) else pd.DataFrame(columns=["latitude", "longitude", "acq_date"])).to_csv(tmp, index=False)
            atomic_replace([tmp])
            log(f"{day.date()} +{span}d {prod}: {len(df)}")
            time.sleep(0.5)
        for i in range(span):  # day -> product (the preferred product wins if two cover the same day)
            d = day + pd.Timedelta(days=i)
            if d not in got or PRODUCT_PREFERENCE.index(prod) < PRODUCT_PREFERENCE.index(got[d]):
                got[d] = prod
        if len(df):
            df = df.copy()
            df["product"] = prod
            frames.append(df)

    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["latitude", "longitude", "acq_date", "product"])
    df = df.rename(columns=RENAME)
    # overlapping cached requests of the same product must not count a hotspot twice
    df = df.drop_duplicates(subset=[c for c in ["latitude", "longitude", "acq_date", "acq_time", "product"] if c in df.columns])
    df["date"] = pd.to_datetime(df.acq_date)
    # keep, for each day, only the hotspots of the product chosen for that day
    df = df[[got.get(d) == p for d, p in zip(df.date, df["product"])]]
    if "type" in df.columns:
        df = df[df["type"].isna() | (df["type"] == 0)]
    r, c, ok = cell_of(df.latitude.values, df.longitude.values, mg)
    inside = np.zeros(len(df), bool)
    inside[ok] = mask[r[ok], c[ok]]
    df = df[inside].copy()
    df["m"] = month_index(df.date.dt.year.values, df.date.dt.month.values)
    gr, gc, gok = cell_of(df.latitude.values, df.longitude.values, grid)
    df["cell"] = np.where(gok, grid.index(gr, gc), -1)
    grp = df[df.cell >= 0].groupby(["cell", "m"])
    t = grp.size().rename("n").to_frame()
    has_frp = "frp" in df.columns   # optional 4th array: FRP sum (MW) per month, observed VIIRS, no factor
    if has_frp:
        t["frp"] = df.loc[df.cell >= 0].assign(frp=pd.to_numeric(df.frp, errors="coerce")).groupby(["cell", "m"]).frp.sum()
    t = t.reset_index()
    cells = [[int(cell), g.m.astype(int).tolist(), g.n.astype(float).tolist()] + ([g.frp.round(1).tolist()] if has_frp else [])
             for cell, g in t.groupby("cell")]
    cell_columns = ["cell_index", "month_indices", "viirs_hotspots"] + (["viirs_frp_mw"] if has_frp else [])

    alld = pd.date_range(start, end)
    month_cov, month_src = {}, {}
    for (y, mo), idx in pd.Series(alld, index=alld).groupby([alld.year, alld.month]):
        m = int(month_index(y, mo))
        have = [got[d] for d in idx.index if d in got]
        month_cov[m] = round(len(have) / pd.Timestamp(y, mo, 1).days_in_month, 3)
        month_src[m] = {p: have.count(p) for p in sorted(set(have))}
    missing_days = [str(d.date()) for d in alld if d not in got]
    if missing_days:
        log(f"{len(missing_days)} days without data yet (first {missing_days[0]}, last {missing_days[-1]})")
    jpath, hpath = os.path.join(args.out, "current.json"), os.path.join(args.out, "current_hotspots.csv")
    with open(jpath + ".tmp", "w") as fh:
        json.dump({"meta": {"source": "NASA FIRMS Area API; per day the best available VIIRS product "
                                      "(S-NPP preferred; NOAA-20 / NOAA-21 when S-NPP has no data; standard processing before near-real-time)",
                            "from": str(start.date()), "to": str(end.date()),
                            "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                            "clip": f"{cfg.name} mask (mask.json)", "cell_columns": cell_columns,
                            "month_coverage": month_cov,
                            "month_coverage_note": "share of the month's days with data (1 = complete month); comparisons are scaled by it",
                            "month_products": month_src, "days_without_data": missing_days},
                   "cells": cells}, fh, separators=(",", ":"))
    df.drop(columns=["date", "m", "cell"]).to_csv(hpath + ".tmp", index=False)
    atomic_replace([jpath + ".tmp", hpath + ".tmp"])  # both fully written first, so a crash never leaves a half file
    log(f"current.json: {len(df):,} hotspots inside {cfg.name}, {len(cells)} cells, "
        f"coverage {', '.join(f'{index_to_ym(m)[1]:02d}:{v:.0%}' for m, v in month_cov.items())}")


# ----------------------------------------------------------------------------- export-hotspots
def cmd_export_hotspots(args):
    """Individual hotspots of the harmonized period, split in 1-degree blocks (gzip CSV) so the app
    can download only the blocks a search touches."""
    import gzip
    cfg = load_country(args.country)
    if not cfg.export_hotspots:
        log(f"export-hotspots is disabled for {cfg.iso3} (countries.json export_hotspots = false)")
        return
    a = load_archives(args.data, cfg.firms_name)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values, cfg)
    v["m"] = month_index(v.year.values, v.month.values)
    flags = daily_flags(v)
    f, _ = compute_factors(v, flags, regions=cfg.region_names)
    v["w"], v["hsrc"] = harmonized_weights(v, flags, f)
    v = v[v.m >= 0]
    prod = {"aqua": "MODIS_SP", "terra": "MODIS_SP", "snpp": "VIIRS_SNPP_SP", "n20": "VIIRS_NOAA20_SP"}
    out = pd.DataFrame({
        "latitude": v.latitude.round(5), "longitude": v.longitude.round(5),
        "acq_date": v.date.dt.strftime("%Y-%m-%d"), "acq_time": v.acq_time.astype(str).str.zfill(4),
        "satellite": v.satellite, "instrument": np.where(v.sensor.isin(["aqua", "terra"]), "MODIS", "VIIRS"),
        "confidence": v.confidence, "frp": v.frp.round(2), "daynight": v.daynight,
        "product": v.sensor.map(prod), "harmonized_weight": v.w.round(4),
    })
    out["blk"] = [f"{la}_{lo}" for la, lo in zip(np.floor(v.latitude).astype(int), np.floor(v.longitude).astype(int))]
    d = os.path.join(args.out, "hotspots")
    os.makedirs(d, exist_ok=True)
    for old in glob.glob(os.path.join(d, "*.csv.gz")):
        os.remove(old)
    index = {}
    for blk, g in out.groupby("blk"):
        g = g.drop(columns="blk").sort_values(["acq_date", "acq_time"])
        with gzip.open(os.path.join(d, f"{blk}.csv.gz"), "wt", compresslevel=9, newline="") as fh:
            g.to_csv(fh, index=False)
        index[blk] = {"rows": int(len(g)), "first": g.acq_date.iloc[0], "last": g.acq_date.iloc[-1]}
    with open(os.path.join(d, "index.json"), "w") as fh:
        json.dump({"block_deg": 1, "key": "floor(lat)_floor(lon)", "period": "%04d-%02d..%s" % (START[0], START[1], out.acq_date.max()[:7]),
                   "note": "vegetation-fire hotspots used to build the harmonized record; harmonized_weight = contribution of each "
                           "hotspot to the VIIRS-equivalent count (0 = not used, e.g. Terra or NOAA-20 outside sensor outages)",
                   "blocks": index}, fh, separators=(",", ":"))
    size = sum(os.path.getsize(x) for x in glob.glob(os.path.join(d, "*.csv.gz")))
    log(f"hotspots/: {len(index)} blocks, {len(out):,} hotspots, {size/1e6:.1f} MB gzipped")


# ----------------------------------------------------------------------------- build-regions
GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/{iso3}/{level}/"

def dept_slug(name):
    """Lowercase ASCII slug: accents stripped, whitespace -> '-'."""
    import re
    import unicodedata
    base = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")


def fetch_boundaries(iso3, level, out):
    """Download the simplified geoBoundaries (gbOpen) GeoJSON for a country/admin level into `out`
    (a file path, or a directory in which case it is named <iso3>_<level>.geojson). Returns the path."""
    from pathlib import Path
    api = GEOBOUNDARIES_API.format(iso3=iso3.upper(), level=level.upper())
    _, body = http_get(api, timeout=60)
    url = json.loads(body)["simplifiedGeometryGeoJSON"]
    _, geo = http_get(url, timeout=120)
    json.loads(geo)  # must be valid JSON before anything is written
    out = Path(out)
    if out.suffix == "" or out.is_dir():
        out = out / f"{iso3.lower()}_{level.lower()}.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(geo)
    log(f"{out}: {len(geo)/1e3:.0f} KB from {url}")
    return out


def _geom_polygons(geom):
    """GeoJSON Polygon/MultiPolygon -> list of polygons, each a list of rings (outer first, then holes)."""
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    raise ValueError(f"unsupported geometry {geom['type']}")


def assign_cells(polygons, deg, lat0, lon0, rows, cols, cell_ids):
    """Assign grid cells to polygons by cell centre. `polygons` = [{"id": str, "geometry": GeoJSON
    Polygon|MultiPolygon}, ...]; returns {id: sorted cell indices} restricted to `cell_ids`.
    Holes are excluded; a cell claimed by several polygons stays with the first one."""
    from matplotlib.path import Path as MPath
    idx = np.array(sorted(int(c) for c in cell_ids if 0 <= int(c) < rows * cols), dtype=np.int64)
    r, c = idx // cols, idx % cols
    centres = np.column_stack([lon0 + (c + 0.5) * deg, lat0 + (r + 0.5) * deg])
    free = np.ones(len(idx), dtype=bool)
    out = {}
    for poly in polygons:
        inside = np.zeros(len(idx), dtype=bool)
        for rings in _geom_polygons(poly["geometry"]):
            m = MPath(np.asarray(rings[0], dtype=float)).contains_points(centres)
            for hole in rings[1:]:
                m &= ~MPath(np.asarray(hole, dtype=float)).contains_points(centres)
            inside |= m
        take = inside & free
        free &= ~take
        out[poly["id"]] = [int(i) for i in idx[take]]
    return out


def _round_coords(x, nd):
    if isinstance(x[0], (int, float)):
        return [round(float(v), nd) for v in x]
    return [_round_coords(y, nd) for y in x]


def _union_geoms(geoms):
    """Union of Polygon/MultiPolygon geometries without shapely: the polygons are grouped into one
    MultiPolygon, valid here because the merged units (Asuncion + Central) are adjacent and do not overlap."""
    polys = []
    for g in geoms:
        polys += _geom_polygons(g)
    return {"type": "MultiPolygon", "coordinates": polys}


def _dist_to_geom(pt, geom):
    """Planar distance (degrees) from a point to the boundary of a geometry."""
    best = np.inf
    p = np.asarray(pt, dtype=float)
    for rings in _geom_polygons(geom):
        for ring in rings:
            a = np.asarray(ring, dtype=float)
            s, e = a[:-1], a[1:]
            d = e - s
            L = np.maximum((d ** 2).sum(1), 1e-18)
            t = np.clip(((p - s) * d).sum(1) / L, 0, 1)
            proj = s + t[:, None] * d
            best = min(best, float(np.sqrt(((proj - p) ** 2).sum(1)).min()))
    return best


def build_departments(geojson, grid, cfg: CountryConfig, report=None):
    """geoBoundaries ADM1 FeatureCollection + grid.json -> list of department dicts
    {id, name, cells, bbox, geometry}. Display names (the source file may lack accents) and merged units
    (Paraguay: Asuncion into Central) come from cfg.departments, keyed by slug. Grid cells whose centre falls
    outside every polygon (border cells of the 0.1-degree grid vs the simplified outline) are assigned to
    the department with the nearest boundary, provided the centre is within one cell diagonal of it.
    If `report` (a dict) is given it receives the coverage before/after that step."""
    names, merge = cfg.departments["names"], cfg.departments.get("merge", {})
    g = grid["meta"]["grid"]
    cell_ids = {int(c[0]) for c in grid["cells"]}
    units = {}
    for ft in geojson["features"]:
        props = ft["properties"]
        slug = dept_slug(props.get("shapeName") or props.get("name"))
        slug = merge.get(slug, slug)
        units.setdefault(slug, []).append(ft["geometry"])
    if set(units) != set(names):
        raise ValueError(f"unexpected department set: unknown={sorted(set(units) - set(names))}, "
                         f"missing={sorted(set(names) - set(units))}")
    geoms = {k: (v[0] if len(v) == 1 else _union_geoms(v)) for k, v in units.items()}
    order = sorted(geoms)
    args = dict(deg=g["deg"], lat0=g["lat0"], lon0=g["lon0"], rows=g["rows"], cols=g["cols"], cell_ids=cell_ids)
    cells = assign_cells([{"id": k, "geometry": geoms[k]} for k in order], **args)
    assigned = {c for v in cells.values() for c in v}
    before = len(assigned) / len(cell_ids)
    reach = g["deg"] * 2 ** 0.5
    for cid in sorted(cell_ids - assigned):
        r, c = divmod(cid, g["cols"])
        pt = (g["lon0"] + (c + 0.5) * g["deg"], g["lat0"] + (r + 0.5) * g["deg"])
        dist = {k: _dist_to_geom(pt, geoms[k]) for k in order}
        k = min(dist, key=dist.get)
        if dist[k] <= reach:
            cells[k].append(cid)
            assigned.add(cid)
    for v in cells.values():
        v.sort()
    if report is not None:
        report.update(before=before, after=len(assigned) / len(cell_ids), unassigned=sorted(cell_ids - assigned))
    out = []
    for k in order:
        coords = _round_coords(_geom_polygons(geoms[k]), 3)
        xs = [pt[0] for poly in coords for pt in poly[0]]
        ys = [pt[1] for poly in coords for pt in poly[0]]
        out.append({"id": k, "name": names[k], "cells": cells[k],
                    "bbox": [min(xs), min(ys), max(xs), max(ys)],
                    "geometry": {"type": "MultiPolygon", "coordinates": coords}})
    return out


def cmd_build_regions(args):
    from pathlib import Path
    cfg = load_country(args.country)
    gj = Path(args.ext) / f"{cfg.iso3.lower()}_adm1.geojson"
    if args.refresh or not gj.exists():
        fetch_boundaries(cfg.iso3, "ADM1", gj)
    geojson = json.loads(gj.read_bytes())
    with open(os.path.join(args.out, "grid.json"), encoding="utf-8") as fh:
        grid = json.load(fh)
    rep = {}
    deps = build_departments(geojson, grid, cfg, rep)
    meta = {"source": f"geoBoundaries gbOpen {cfg.iso3} ADM1", "license": "CC BY 4.0",
            "url": GEOBOUNDARIES_API.format(iso3=cfg.iso3, level="ADM1"),
            "retrieved": dt.date.today().isoformat(),
            "note": cfg.departments["note"]}
    path = os.path.join(args.out, "departments.json")
    with open(path + ".tmp", "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"meta": meta, "departments": deps}, fh, ensure_ascii=False, separators=(",", ":"))
    atomic_replace([path + ".tmp"])
    log(f"departments.json: {len(deps)} departments, {os.path.getsize(path)/1e3:.0f} KB, "
        f"coverage {rep['before']:.2%} -> {rep['after']:.2%}, unassigned {len(rep['unassigned'])}")


# ----------------------------------------------------------------------------- main
def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    d = sp.add_parser("download"); d.add_argument("--data", default="data/raw"); d.add_argument("--retries", type=int, default=6)
    b = sp.add_parser("build"); b.add_argument("--data", default="data/raw"); b.add_argument("--out", default="data/app")
    e = sp.add_parser("export-hotspots"); e.add_argument("--data", default="data/raw"); e.add_argument("--out", default="data/app")
    v = sp.add_parser("validate"); v.add_argument("--data", default="data/raw"); v.add_argument("--out", default="data/app")
    f = sp.add_parser("fetch-current"); f.add_argument("--out", default="data/app"); f.add_argument("--map-key")
    f.add_argument("--start", default="2026-01-01"); f.add_argument("--end"); f.add_argument("--cache", default="data/api_cache")
    f.add_argument("--offline", action="store_true", help="build current.json from cached windows only, no API calls")
    fr = sp.add_parser("build-frp"); fr.add_argument("--data", default="data/raw"); fr.add_argument("--out", default="data/app")
    sn = sp.add_parser("build-season"); sn.add_argument("--data", default="data/raw"); sn.add_argument("--out", default="data/app")
    r = sp.add_parser("build-regions"); r.add_argument("--out", default="data/app"); r.add_argument("--ext", default="data/ext")
    r.add_argument("--refresh", action="store_true", help="re-download the boundaries even if data/ext/<iso3>_adm1.geojson exists")
    for sub in sp.choices.values():
        sub.add_argument("--country", default=DEFAULT_COUNTRY, help="ISO3 code of an entry in countries.json (default PRY)")
    return p.parse_args(argv)


def main():
    a = parse_args()
    {"download": cmd_download, "build": cmd_build, "export-hotspots": cmd_export_hotspots, "validate": cmd_validate, "fetch-current": cmd_fetch_current,
     "build-regions": cmd_build_regions, "build-season": cmd_build_season, "build-frp": cmd_build_frp}[a.cmd](a)


if __name__ == "__main__":
    main()
