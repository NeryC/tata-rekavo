#!/usr/bin/env python3
"""
Tata Rekavo - MODIS/VIIRS active-fire harmonization pipeline (Paraguay)
NASA Space Apps Challenge 2026 - "Harmonization of MODIS and VIIRS Hot Spots"

Subcommands
  download       Download FIRMS yearly country archives (MODIS, VIIRS S-NPP, VIIRS NOAA-20)
  build          Build the harmonized dataset the web app reads (grid x month, VIIRS-equivalent)
  export-hotspots  Individual hotspots 2002-2025 in 1-degree gzip blocks, for per-search CSV downloads
  validate       Hold-out validation of the harmonization + error model + figure
  fetch-current  Pull recent months from the FIRMS Area API (needs a free MAP_KEY); best VIIRS product per day

Method (short)
  Unit: "VIIRS S-NPP-equivalent hotspots".
  Factor f(region, calendar month) = VIIRS S-NPP hotspots / MODIS Aqua hotspots,
  computed over the overlap Feb 2012 - Dec 2025 on days where both sensors delivered data.
  Before Feb 2012: Aqua hotspots x f.  From Feb 2012: VIIRS S-NPP observed.
  Sensor outage days are filled with the twin sensor (NOAA-20 for S-NPP, Terra for Aqua).
  Regions: Chaco (west of the Paraguay River) / Oriental, approximated by a polyline.

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
from typing import Callable, Optional, TypeVar

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------- constants
COUNTRY = "Paraguay"
ARCHIVE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/{src}/{year}/{src}_{year}_{country}.csv"
API_BASE = "https://firms.modaps.eosdis.nasa.gov/api"
ARCHIVE_YEARS = {"modis": range(2000, 2026), "viirs-snpp": range(2012, 2026), "viirs-jpss1": range(2018, 2026)}

# Paraguay River approximation (latitude -> river longitude). Chaco = west of river and north of CHACO_SOUTH.
RIVER_LAT = [-27.5, -25.3, -24.1, -23.4, -22.1, -20.2, -19.0]
RIVER_LON = [-57.63, -57.63, -57.15, -57.43, -57.95, -58.15, -58.15]
CHACO_SOUTH = -25.35
REGIONS = ["chaco", "oriental"]

GRID_DEG = 0.1          # app grid (~11 km)
FINE_DEG = 0.01         # burn-history grid (~1.1 km)
MASK_DEG = 0.05         # country mask used to clip API data (~5.5 km)
LAT0, LON0 = -28.0, -63.0
GRID_N = 88             # 88 x 0.1 deg covers -28..-19.2 / -63..-54.2
FINE_N = 900
MASK_N = 180
BBOX = (-62.8, -27.7, -54.1, -19.1)  # west, south, east, north (for the API)

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


def region_of(lat, lon):
    river = np.interp(lat, RIVER_LAT, RIVER_LON)
    return np.where((lon < river) & (lat > CHACO_SOUTH), "chaco", "oriental")


def cell_of(lat, lon, deg, n):
    r = np.floor((np.asarray(lat) - LAT0) / deg).astype(int)
    c = np.floor((np.asarray(lon) - LON0) / deg).astype(int)
    ok = (r >= 0) & (r < n) & (c >= 0) & (c < n)
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
    os.makedirs(args.data, exist_ok=True)
    jobs = [(s, y) for s, yrs in ARCHIVE_YEARS.items() for y in yrs]
    for src, year in jobs:
        path = os.path.join(args.data, f"{src}_{year}_{COUNTRY}.csv")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        url = ARCHIVE_URL.format(src=src, year=year, country=COUNTRY)
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


def load_archives(data_dir):
    frames = []
    for f in sorted(glob.glob(os.path.join(data_dir, f"*_{COUNTRY}.csv"))):
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


def compute_factors(v, flags, exclude_years=(), years=None):
    """f[sensor][region][month] = VIIRS S-NPP / MODIS sensor, on clean overlap days."""
    lo, hi = pd.Timestamp(*VIIRS_START, 1), pd.Timestamp(CALIB_END)
    clean_days = flags.index[(flags.index >= lo) & (flags.index <= hi) & ~flags.snpp_out & ~flags.aqua_out & ~flags.terra_out]
    c = v[v.date.isin(clean_days)]
    if years is not None:
        c = c[c.year.isin(years)]
    if len(exclude_years):
        c = c[~c.year.isin(exclude_years)]
    num = c[c.sensor == "snpp"].groupby(["region", "month"]).size()
    out = {}
    for s in ["aqua", "terra"]:
        den = c[c.sensor == s].groupby(["region", "month"]).size()
        out[s] = (num / den).reindex(pd.MultiIndex.from_product([REGIONS, range(1, 13)]))
    return out, clean_days


def harmonized_weights(v, flags, f):
    """Weight of every hotspot in the harmonized record (0 = not used)."""
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
def cmd_build(args):
    os.makedirs(args.out, exist_ok=True)
    a = load_archives(args.data)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values)
    v["m"] = month_index(v.year.values, v.month.values)
    flags = daily_flags(v)
    f, clean_days = compute_factors(v, flags)
    v["w"], v["hsrc"] = harmonized_weights(v, flags, f)
    v = v[v.m >= 0]
    n_months = int(v.m.max()) + 1
    r, c, ok = cell_of(v.latitude.values, v.longitude.values, GRID_DEG, GRID_N)
    v["cell"] = np.where(ok, r * GRID_N + c, -1)
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
        "name": "Tata Rekavo harmonized hotspot record - Paraguay",
        "unit": "VIIRS S-NPP-equivalent vegetation-fire hotspots per month",
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "grid": {"deg": GRID_DEG, "lat0": LAT0, "lon0": LON0, "rows": GRID_N, "cols": GRID_N,
                 "cell_index": "row * cols + col; row = floor((lat-lat0)/deg), col = floor((lon-lon0)/deg)"},
        "months": {"first": "%04d-%02d" % START, "count": n_months, "last": "%04d-%02d" % index_to_ym(n_months - 1),
                   "viirs_start_index": VIIRS_START_IDX, "index": "m = (year-%d)*12 + (month-%d)" % START},
        "cell_columns": ["cell_index", "month_indices", "harmonized", "modis_raw_terra_aqua", "viirs_snpp_raw"],
        "regions": {"method": "Chaco = west of the Paraguay River (polyline) and north of %.2f" % CHACO_SOUTH,
                    "river_lat": RIVER_LAT, "river_lon": RIVER_LON, "chaco_south": CHACO_SOUTH},
        "factors": {s: {reg: [round(float(f[s][(reg, mo)]), 4) for mo in range(1, 13)] for reg in REGIONS} for s in ["aqua", "terra"]},
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
    for name, sel in [("paraguay", v), ("chaco", v[v.region == "chaco"]), ("oriental", v[v.region == "oriental"])]:
        s = pd.DataFrame({"harmonized": sel.groupby("m").w.sum(),
                          "modis_raw": sel[sel.sensor.isin(["aqua", "terra"])].groupby("m").size(),
                          "viirs_snpp_raw": sel[sel.sensor == "snpp"].groupby("m").size()}).reindex(range(n_months)).fillna(0)
        for m_, rr in s.iterrows():
            y, mo = index_to_ym(m_)
            rows.append([name, y, mo, round(rr.harmonized, 1), int(rr.modis_raw), int(rr.viirs_snpp_raw)])
    reg = pd.DataFrame(rows, columns=["area", "year", "month", "harmonized", "modis_raw", "viirs_snpp_raw"])
    reg.to_csv(os.path.join(args.out, "series_regions.csv"), index=False)

    # --- long CSV (cell x month), for analysis / download
    rr, cc = np.divmod(t.cell.values, GRID_N)
    ym = [index_to_ym(m_) for m_ in t.m.values]
    pd.DataFrame({"cell_lat": np.round(LAT0 + (rr + 0.5) * GRID_DEG, 3), "cell_lon": np.round(LON0 + (cc + 0.5) * GRID_DEG, 3),
                  "year": [y for y, _ in ym], "month": [m_ for _, m_ in ym], "harmonized": t.h.round(1).values,
                  "modis_raw": t.modis.astype(int).values, "viirs_snpp_raw": t.viirs.astype(int).values}
                 ).to_csv(os.path.join(args.out, "grid_monthly.csv"), index=False)

    # --- burn history (~1 km): last year burned and number of years burned, any sensor, Jul 2002 - end
    fr, fc, fok = cell_of(v.latitude.values, v.longitude.values, FINE_DEG, FINE_N)
    hist = pd.DataFrame({"k": (fr * FINE_N + fc)[fok], "y": v.year.values[fok]}).drop_duplicates()
    last = np.zeros(FINE_N * FINE_N, np.uint8); nyr = np.zeros(FINE_N * FINE_N, np.uint8)
    agg = hist.groupby("k").y.agg(["max", "size"])
    last[agg.index.values] = (agg["max"].values - 2000).astype(np.uint8)
    nyr[agg.index.values] = agg["size"].values.astype(np.uint8)
    with open(os.path.join(args.out, "burn_history.json"), "w") as fh:
        json.dump({"deg": FINE_DEG, "lat0": LAT0, "lon0": LON0, "rows": FINE_N, "cols": FINE_N,
                   "period": "%04d-%02d..%s" % (START[0], START[1], meta["months"]["last"]),
                   "last_year_minus_2000_b64": base64.b64encode(last.tobytes()).decode(),
                   "years_burned_b64": base64.b64encode(nyr.tobytes()).decode(),
                   "note": "uint8 arrays, row-major, index = row*cols+col; 0 = never detected"}, fh, separators=(",", ":"))

    # --- country mask (~5.5 km) from every hotspot in the archive, used to clip API data
    mr, mc, mok = cell_of(a.latitude.values, a.longitude.values, MASK_DEG, MASK_N)
    mask = np.zeros((MASK_N, MASK_N), bool); mask[mr[mok], mc[mok]] = True
    with open(os.path.join(args.out, "mask.json"), "w") as fh:
        json.dump({"deg": MASK_DEG, "lat0": LAT0, "lon0": LON0, "rows": MASK_N, "cols": MASK_N,
                   "bits_b64": bitpack(mask), "cells_in_mask": int(mask.sum()),
                   "note": "cells with at least one FIRMS hotspot in the Paraguay country archives 2000-2025"}, fh)
    log("wrote grid.json, gaps.json, series_regions.csv, grid_monthly.csv, burn_history.json, mask.json")


# ----------------------------------------------------------------------------- validate
def cmd_validate(args):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.stats import spearmanr

    a = load_archives(args.data)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values)
    v["m"] = month_index(v.year.values, v.month.values)
    flags = daily_flags(v)
    _, clean_days = compute_factors(v, flags)
    c = v[v.date.isin(clean_days)].copy()
    c["blk1"] = (np.floor(c.latitude).astype(int) * 1000 + np.floor(c.longitude).astype(int))
    for deg, name in [(0.1, "g01"), (0.25, "g025"), (0.5, "g05")]:
        c[name] = (np.floor((c.latitude - LAT0) / deg).astype(int) * 1000 + np.floor((c.longitude - LON0) / deg).astype(int))
    years = sorted(c.year.unique())

    def predict(train_years, test_years):
        fa, _ = compute_factors(v, flags, years=train_years)
        te = c[c.year.isin(test_years)]
        aq = te[te.sensor == "aqua"]
        key = pd.MultiIndex.from_arrays([aq.region.values, aq.month.values])
        aq = aq.assign(p=fa["aqua"].reindex(key).values)
        return te[te.sensor == "snpp"], aq

    levels = {"country": [], "chaco": ["region"], "oriental": ["region"], "block_1deg": ["blk1"],
              "cell_0.5deg": ["g05"], "cell_0.25deg": ["g025"], "cell_0.1deg": ["g01"]}

    def table(obs, aq, by):
        o = obs.groupby(by + ["m"]).size().rename("obs")
        p = aq.groupby(by + ["m"]).p.sum().rename("pred")
        return pd.concat([o, p], axis=1).fillna(0)

    # leave-one-year-out
    pairs = {k: [] for k in levels}
    for y in years:
        obs, aq = predict([x for x in years if x != y], [y])
        for k, by in levels.items():
            tb = table(obs, aq, by).reset_index()
            if k in ("chaco", "oriental"):
                tb = tb[tb.region == k]
            pairs[k].append(tb)
    pairs = {k: pd.concat(x) for k, x in pairs.items()}

    def mdape(t, thr):
        t = t[t.obs >= thr]
        return float(np.median(np.abs(t.pred - t.obs) / t.obs) * 100)

    thr = {"country": 1, "chaco": 1, "oriental": 1, "block_1deg": 50, "cell_0.5deg": 30, "cell_0.25deg": 20, "cell_0.1deg": 10}
    loyo = {k: {"mdape_pct": round(mdape(t, thr[k]), 1),
                "p90_ape_pct": round(float(np.quantile(np.abs(t[t.obs >= thr[k]].pred - t[t.obs >= thr[k]].obs) / t[t.obs >= thr[k]].obs, .9) * 100), 1),
                "bias_pct": round(float((t.pred.sum() / t.obs.sum() - 1) * 100), 1), "n": int((t.obs >= thr[k]).sum()),
                "min_obs": thr[k]} for k, t in pairs.items()}

    # backward extrapolation: train 2019-2025, test 2012-2018
    obs, aq = predict(list(range(2019, 2026)), list(range(2012, 2019)))
    bo = obs.groupby("year").size(); bp = aq.groupby("year").p.sum()
    backward = {int(y): round(float((bp[y] / bo[y] - 1) * 100), 1) for y in bo.index}

    # anomaly agreement (value / median of same calendar month), country & region
    def classes(x):
        return pd.cut(x, [-1, .5, 1.5, 3, 1e9], labels=False)
    agree = {}
    for k in ["country", "chaco", "oriental", "block_1deg"]:
        t = pairs[k].copy()
        idx = levels[k] if k == "block_1deg" else []
        t["month"] = (t.m + START[1] - 1) % 12 + 1
        for col in ["obs", "pred"]:
            t["a_" + col] = t[col] / t.groupby(idx + ["month"])[col].transform("median")
        t = t[t.groupby(idx + ["month"]).obs.transform("median") >= 30].dropna(subset=["a_obs", "a_pred"])
        agree[k] = {"spearman": round(float(spearmanr(t.a_obs, t.a_pred)[0]), 3),
                    "same_class_pct": round(float((classes(t.a_obs) == classes(t.a_pred)).mean() * 100), 1), "n": int(len(t))}

    # error model: median relative error vs predicted count, pooled over all aggregation levels
    pool = pd.concat([t[["obs", "pred"]] for t in pairs.values()])
    pool = pool[pool.pred >= 1]
    pool["rel"] = np.abs(pool.obs - pool.pred) / pool.pred
    bins = np.unique(np.round(np.logspace(0, np.log10(pool.pred.max()), 30)))
    pool["bin"] = pd.cut(pool.pred, bins)
    bstat = pool.groupby("bin", observed=True).agg(n=("pred", "median"), rel=("rel", "median"), k=("rel", "size"))
    bstat = bstat[bstat.k >= 30]
    # power law in log space, weighted by bin size: rel = c * n^(-p)
    slope, intercept = np.polyfit(np.log(bstat.n.values), np.log(bstat.rel.values), 1, w=np.sqrt(bstat.k.values))
    ec, ep = float(np.exp(intercept)), float(-slope)

    def rel_err(n):
        return min(1.0, ec * max(n, 1) ** -ep)

    # systematic term for the reconstructed years: Aqua-based vs Terra+Aqua-based reconstruction (country, yearly)
    f_all, _ = compute_factors(v, flags)
    cl = v[v.date.isin(clean_days)]
    num = cl[cl.sensor == "snpp"].groupby(["region", "month"]).size()
    den = cl[cl.sensor.isin(["aqua", "terra"])].groupby(["region", "month"]).size()
    f_ta = (num / den)
    pre = v[(v.m >= 0) & (v.m < VIIRS_START_IDX)]
    ka = pd.MultiIndex.from_arrays([pre.region.values, pre.month.values])
    rec_a = pd.Series(np.where(pre.sensor == "aqua", f_all["aqua"].reindex(ka).values, 0), index=pre.index).groupby(pre.year).sum()
    rec_ta = pd.Series(np.where(pre.sensor.isin(["aqua", "terra"]), f_ta.reindex(ka).values, 0), index=pre.index).groupby(pre.year).sum()
    sys_by_year = {int(y): round(float(abs(rec_ta[y] / rec_a[y] - 1)), 3) for y in rec_a.index}

    error_model = {
        "formula": "relative_error(n) = min(1, c * n^(-p)) where n = harmonized hotspots in the zone-month; "
                   "for months before viirs_start add the systematic term in quadrature: sqrt(rel^2 + sys[year]^2); "
                   "months from viirs_start are observed (no translation error)",
        "c": round(ec, 4), "p": round(ep, 4), "sys_by_year": sys_by_year,
        "meaning": "median absolute relative error (about half of zone-months fall inside the band)",
        "fit_bins": [[round(float(n), 1), round(float(r), 4), int(k), round(rel_err(n), 4)] for n, r, k in bstat[["n", "rel", "k"]].values],
    }
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
        s = series[(series.area == "paraguay") & (series.year.between(2003, 2025))].groupby("year")[["harmonized", "modis_raw", "viirs_snpp_raw"]].sum()
        naive = np.where(s.index >= 2012, s.viirs_snpp_raw, s.modis_raw)
        ax[0].bar(s.index, naive, color=["#8a8a8a" if y < 2012 else "#d95f02" for y in s.index])
        ax[0].set_title("Naive record: MODIS until 2011, VIIRS after\n(the jump is the sensor, not the fire)")
        ax[1].bar(s.index, s.harmonized, color=["#7570b3" if y < 2012 else "#d95f02" for y in s.index])
        pre_y = s.index[s.index < 2012]
        err = [np.sqrt(rel_err(hh) ** 2 + sys_by_year.get(int(y), 0) ** 2) * hh for y, hh in zip(pre_y, s.harmonized[pre_y])]
        ax[1].errorbar(pre_y, s.harmonized[pre_y], yerr=err, fmt="none", ecolor="black", capsize=3, lw=1.2)
        ax[1].set_title("Harmonized record (VIIRS S-NPP equivalent)\npurple = MODIS Aqua translated, orange = VIIRS observed")
        for x in ax[:2]:
            x.set_ylabel("vegetation-fire hotspots per year, Paraguay")
            x.set_ylim(0, max(naive.max(), s.harmonized.max()) * 1.12)
    t = pairs["chaco"].assign(r="chaco")
    t = pd.concat([t, pairs["oriental"].assign(r="oriental")])
    t = t[t.obs > 0]
    ax[2].scatter(t.obs, t.pred, s=12, alpha=.6, c=np.where(t.r == "chaco", "#1b9e77", "#e7298a"))
    lim = [10, t.obs.max() * 1.4]
    ax[2].plot(lim, lim, "k--", lw=1); ax[2].set_xscale("log"); ax[2].set_yscale("log"); ax[2].set_xlim(lim); ax[2].set_ylim(lim)
    ax[2].set_xlabel("VIIRS S-NPP observed (region-month)"); ax[2].set_ylabel("predicted from MODIS Aqua, year held out")
    ax[2].set_title("Hold-out validation 2012-2025\nmedian error: Chaco %.1f%%, Oriental %.1f%%" % (loyo["chaco"]["mdape_pct"], loyo["oriental"]["mdape_pct"]))
    fig.text(0.5, -0.02, "Data: NASA FIRMS (MODIS C6.1 Terra/Aqua, VIIRS 375 m S-NPP/NOAA-20), Paraguay, vegetation fires. "
             "Error bars: modelled median error. AI-assisted figure.", ha="center", fontsize=8.5)
    plt.tight_layout()
    plt.savefig(os.path.join(args.out, "validation.png"), dpi=130, bbox_inches="tight")
    log(json.dumps({"leave_one_year_out": loyo, "backward": backward, "agreement": agree,
                    "error_model": {"c": error_model["c"], "p": error_model["p"], "sys_by_year": sys_by_year}}, indent=1))


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
    with open(os.path.join(args.out, "mask.json")) as fh:
        mk = json.load(fh)
    mask = np.unpackbits(np.frombuffer(base64.b64decode(mk["bits_b64"]), np.uint8))[: MASK_N * MASK_N].reshape(MASK_N, MASK_N).astype(bool)
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
            url = f"{API_BASE}/area/csv/{key}/{prod}/{','.join(map(str, BBOX))}/{span}/{day.date()}"
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
    r, c, ok = cell_of(df.latitude.values, df.longitude.values, MASK_DEG, MASK_N)
    inside = np.zeros(len(df), bool)
    inside[ok] = mask[r[ok], c[ok]]
    df = df[inside].copy()
    df["m"] = month_index(df.date.dt.year.values, df.date.dt.month.values)
    gr, gc, gok = cell_of(df.latitude.values, df.longitude.values, GRID_DEG, GRID_N)
    df["cell"] = np.where(gok, gr * GRID_N + gc, -1)
    t = df[df.cell >= 0].groupby(["cell", "m"]).size().rename("n").reset_index()
    cells = [[int(cell), g.m.astype(int).tolist(), g.n.astype(float).tolist()] for cell, g in t.groupby("cell")]

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
                            "clip": "Paraguay mask (mask.json)", "cell_columns": ["cell_index", "month_indices", "viirs_hotspots"],
                            "month_coverage": month_cov,
                            "month_coverage_note": "share of the month's days with data (1 = complete month); comparisons are scaled by it",
                            "month_products": month_src, "days_without_data": missing_days},
                   "cells": cells}, fh, separators=(",", ":"))
    df.drop(columns=["date", "m", "cell"]).to_csv(hpath + ".tmp", index=False)
    atomic_replace([jpath + ".tmp", hpath + ".tmp"])  # both fully written first, so a crash never leaves a half file
    log(f"current.json: {len(df):,} hotspots inside Paraguay, {len(cells)} cells, "
        f"coverage {', '.join(f'{index_to_ym(m)[1]:02d}:{v:.0%}' for m, v in month_cov.items())}")


# ----------------------------------------------------------------------------- export-hotspots
def cmd_export_hotspots(args):
    """Individual hotspots of the harmonized period, split in 1-degree blocks (gzip CSV) so the app
    can download only the blocks a search touches."""
    import gzip
    a = load_archives(args.data)
    v = vegetation(a).copy()
    v["region"] = region_of(v.latitude.values, v.longitude.values)
    v["m"] = month_index(v.year.values, v.month.values)
    flags = daily_flags(v)
    f, _ = compute_factors(v, flags)
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


# ----------------------------------------------------------------------------- main
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    d = sp.add_parser("download"); d.add_argument("--data", default="data/raw"); d.add_argument("--retries", type=int, default=6)
    b = sp.add_parser("build"); b.add_argument("--data", default="data/raw"); b.add_argument("--out", default="data/app")
    e = sp.add_parser("export-hotspots"); e.add_argument("--data", default="data/raw"); e.add_argument("--out", default="data/app")
    v = sp.add_parser("validate"); v.add_argument("--data", default="data/raw"); v.add_argument("--out", default="data/app")
    f = sp.add_parser("fetch-current"); f.add_argument("--out", default="data/app"); f.add_argument("--map-key")
    f.add_argument("--start", default="2026-01-01"); f.add_argument("--end"); f.add_argument("--cache", default="data/api_cache")
    f.add_argument("--offline", action="store_true", help="build current.json from cached windows only, no API calls")
    a = p.parse_args()
    {"download": cmd_download, "build": cmd_build, "export-hotspots": cmd_export_hotspots, "validate": cmd_validate, "fetch-current": cmd_fetch_current}[a.cmd](a)


if __name__ == "__main__":
    main()
