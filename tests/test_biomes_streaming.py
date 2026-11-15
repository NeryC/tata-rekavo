"""Biome factor regions (RESOLVE Ecoregions 2017 raster), the factor fallback to the country, and the streaming
(one year at a time) build compared with the in-memory build on synthetic archives."""
import argparse
import json
import math
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import firms_pipeline
from firms_pipeline import GridSpec, load_country, region_of

ROOT = Path(__file__).resolve().parent.parent
NPZ = ROOT / "data" / "ext" / "biomes_latam.npz"
MOIST = "Tropical & Subtropical Moist Broadleaf Forests"


def _countries(tmp_path, entries):
    p = tmp_path / "countries.json"
    p.write_text(json.dumps(entries), encoding="utf-8")
    return p


def _entry(**over):
    raw = json.loads((ROOT / "countries.json").read_text(encoding="utf-8"))["PRY"]
    raw.update(over)
    return raw


# ----------------------------------------------------------------------------- the committed biome raster
def test_biome_lookup_amazon_is_moist_broadleaf():
    assert firms_pipeline.biome_name_at(-3, -60) == MOIST
    assert list(firms_pipeline.biome_name_at([-3, -3.5], [-60, -61])) == [MOIST, MOIST]


def test_biome_raster_is_small_and_self_describing():
    assert NPZ.stat().st_size < 2_000_000
    b = firms_pipeline.load_biomes(str(NPZ))
    assert b.grid == GridSpec(0.05, -56.0, -118.0, 1780, 1680)
    assert b.codes.dtype == np.uint8 and b.codes.shape == (1780, 1680)
    assert b.names[1] == MOIST
    assert set(np.unique(b.codes)) - {0} <= set(b.names)
    assert 0.2 < (b.codes > 0).mean() < 0.6             # land share of the Latin America box (25 %)
    assert (b.filled > 0).all()                          # every cell has a nearest biome


def test_biome_lookup_known_places():
    # ecoregions checked against the RESOLVE shapefile (RESOLVE 2017 files the Dry Chaco under biome 7)
    names = firms_pipeline.biome_name_at([-22.0, -34.6, -16.6, -23.5, -17.8, -19.0], [-60.5, -60.0, -68.4, -46.6, -63.2, -57.5])
    assert list(names) == ["Tropical & Subtropical Grasslands, Savannas & Shrublands",   # Dry Chaco (Paraguay)
                           "Temperate Grasslands, Savannas & Shrublands",                # Humid Pampas
                           "Montane Grasslands & Shrublands",                            # Central Andean wet puna (Bolivia)
                           MOIST,                                                        # Serra do Mar coastal forests
                           "Tropical & Subtropical Dry Broadleaf Forests",               # Chiquitano dry forests
                           "Flooded Grasslands & Savannas"]                              # Pantanal


def test_biome_lookup_coast_and_outside():
    # a point in the sea next to the coast takes the nearest biome; outside the raster there is none (code 0)
    assert int(firms_pipeline.biome_at(-23.05, -43.0)) > 0
    assert int(firms_pipeline.biome_at(-23.05, -43.0, fill=False)) in (0, int(firms_pipeline.biome_at(-23.05, -43.0)))
    assert int(firms_pipeline.biome_at(60.0, -60.0)) == 0


# ----------------------------------------------------------------------------- rasterization
def _square(w, s, e, n):
    return [[w, s], [e, s], [e, n], [w, n], [w, s]]


def test_rasterize_biomes_by_cell_centre_with_holes_first_claim_wins():
    g = GridSpec(1.0, 0.0, 0.0, 4, 6)
    feats = [
        {"code": 2, "name": "B", "geometry": {"type": "Polygon", "coordinates": [_square(2, 0, 6, 4)]}},
        {"code": 1, "name": "A", "geometry": {"type": "MultiPolygon", "coordinates": [
            [_square(0, 0, 3, 4), _square(1, 1, 2, 2)]]}},   # hole at cell (1, 1); overlaps B on column 2
    ]
    codes = firms_pipeline.rasterize_biomes(feats, g)
    assert codes.dtype == np.uint8 and codes.shape == (4, 6)
    want = np.array([[1, 1, 1, 2, 2, 2],
                     [1, 0, 1, 2, 2, 2],
                     [1, 1, 1, 2, 2, 2],
                     [1, 1, 1, 2, 2, 2]])
    assert (codes == want).all()     # ascending code: A (1) claims column 2 before B (2)


def test_write_and_load_biome_raster_roundtrip(tmp_path):
    g = GridSpec(0.5, -2.0, -3.0, 8, 12)
    codes = np.zeros((8, 12), np.uint8)
    codes[:, :6], codes[2:6, 6:9] = 1, 7
    p = tmp_path / "b.npz"
    firms_pipeline.write_biomes(p, codes, g, {1: "Alpha forests", 7: "Beta grasslands", 9: "Not present"})
    b = firms_pipeline.load_biomes(str(p))
    assert b.grid == g and (b.codes == codes).all()
    assert b.names == {1: "Alpha forests", 7: "Beta grasslands"}          # only codes present are kept
    assert int(b.filled[0, 11]) == 7 and int(b.filled[7, 0]) == 1        # nearest-biome fill of empty cells
    assert list(firms_pipeline.biome_at([-1.9, 0.1], [-2.9, 1.1], path=str(p))) == [1, 7]
    assert int(firms_pipeline.biome_at(-1.9, 2.9, path=str(p), fill=False)) == 0


# ----------------------------------------------------------------------------- biome regions in the country config
def _biome_npz(tmp_path):
    """Synthetic raster over the Paraguay box: west of -58.5 'Alpha forests' (1), east 'Beta grasslands' (7), and a
    'Gamma desert' (13) corner inside the bbox (lat -27.7..-27.5, lon -62.8..-62.5) where the synthetic archives have no hotspot."""
    g = GridSpec(0.05, -28.0, -63.0, 180, 180)
    codes = np.ones((180, 180), np.uint8)
    codes[:, 90:] = 7
    codes[6:10, 4:10] = 13
    p = tmp_path / "biomes.npz"
    firms_pipeline.write_biomes(p, codes, g, {1: "Alpha forests", 7: "Beta grasslands", 13: "Gamma desert"})
    return p


def _biome_cfg(tmp_path, **regions):
    npz = _biome_npz(tmp_path)
    reg = {"kind": "biome", "source": str(npz), "min_hotspots": 500, **regions}
    return load_country("TST", _countries(tmp_path, {"TST": _entry(regions=reg)}))


def test_region_of_biome_returns_biome_ids(tmp_path):
    cfg = _biome_cfg(tmp_path)
    assert cfg.region_names == ["alpha-forests", "beta-grasslands", "gamma-desert"]   # every biome in the bbox
    assert cfg.region_label("beta-grasslands") == "Beta grasslands"
    assert list(region_of(np.array([-22.0, -22.0]), np.array([-60.0, -56.0]), cfg)) == ["alpha-forests", "beta-grasslands"]
    assert cfg.factor_min_hotspots == 500
    meta = firms_pipeline.regions_meta(cfg)
    assert meta["kind"] == "biome" and meta["names"] == cfg.region_names and meta["min_hotspots"] == 500
    assert "RESOLVE" in meta["method"]


def test_region_names_explicit_list_is_kept(tmp_path):
    cfg = _biome_cfg(tmp_path, names=["beta-grasslands"])
    assert cfg.region_names == ["beta-grasslands"]


def test_paraguay_has_no_factor_fallback():
    assert load_country("PRY").factor_min_hotspots is None


def test_bolivia_entry():
    c = load_country("BOL")
    assert c.firms_name == "Bolivia" and c.deg == 0.25 and c.regions["kind"] == "biome"
    assert c.export_hotspots is False and c.burn_history is False
    w, s, e, n = c.bbox
    assert c.lon0 <= w and c.lat0 <= s and c.lon0 + c.cols * c.deg >= e and c.lat0 + c.rows * c.deg >= n
    assert c.rows * c.cols < 15_000
    assert c.mask_grid.lat0 == c.lat0 and c.mask_grid.rows * c.mask_grid.deg == pytest.approx(c.rows * c.deg)
    assert c.region_names == ["tropical-subtropical-moist-broadleaf-forests", "tropical-subtropical-dry-broadleaf-forests",
                              "tropical-subtropical-grasslands-savannas-shrublands", "flooded-grasslands-savannas",
                              "montane-grasslands-shrublands"]   # explicit: the Atacama corner of the bbox is Chile
    assert set(c.region_names) < {firms_pipeline.biome_region_id(n) for _, n in firms_pipeline.biomes_in_box(c.bbox)}
    assert c.region_label("tropical-subtropical-moist-broadleaf-forests") == MOIST
    assert str(region_of(-16.6, -68.4, c)) == "montane-grasslands-shrublands"


def test_load_country_warns_when_grid_does_not_cover_bbox(tmp_path):
    p = _countries(tmp_path, {"TST": _entry(bbox=[-62.8, -27.7, -50.0, -19.1])})
    with pytest.warns(UserWarning, match=r"TST.*east"):
        load_country("TST", p)
    p = _countries(tmp_path, {"TST": _entry(bbox=[-62.5, -27.5, -55.0, -20.0])})
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        load_country("TST", p)


# ----------------------------------------------------------------------------- factor fallback (biome kind only)
def _two_region_hotspots(big_n=1200, small_n=40):
    """Clean overlap days in 2013: region 'big' with big_n S-NPP and big_n/2 Aqua (and Terra) hotspots in March,
    'small' with small_n S-NPP and small_n/4 Aqua hotspots (its own factor 4, the big one 2)."""
    rows = []
    d = pd.Timestamp("2013-03-10")
    for region, n_snpp, n_aqua in [("big", big_n, big_n // 2), ("small", small_n, small_n // 4)]:
        rows += [(d, "snpp", region)] * n_snpp + [(d, "aqua", region)] * n_aqua + [(d, "terra", region)] * n_aqua
    v = pd.DataFrame(rows, columns=["date", "sensor", "region"])
    v["year"], v["month"] = v.date.dt.year, v.date.dt.month
    days = pd.date_range("2013-01-01", "2013-12-31")
    flags = pd.DataFrame({"snpp_out": False, "aqua_out": False, "terra_out": False, "n20": 0}, index=days)
    return v, flags


def test_compute_factors_without_fallback_keeps_small_region_factor():
    v, flags = _two_region_hotspots()
    f, _ = firms_pipeline.compute_factors(v, flags, regions=["big", "small"])
    assert float(f["aqua"][("big", 3)]) == 2.0 and float(f["aqua"][("small", 3)]) == 4.0
    assert "country" not in f


def test_compute_factors_small_region_falls_back_to_country_factor():
    v, flags = _two_region_hotspots()
    f, _ = firms_pipeline.compute_factors(v, flags, regions=["big", "small", "empty"], min_hotspots=500)
    country = (1200 + 40) / (600 + 10)
    assert float(f["aqua"][("big", 3)]) == 2.0                       # 600 Aqua and 1200 S-NPP hotspots: own factor
    assert float(f["aqua"][("small", 3)]) == pytest.approx(country)  # < 500: country factor of that month
    assert float(f["aqua"][("empty", 3)]) == pytest.approx(country)
    assert float(f["country"]["aqua"][3]) == pytest.approx(country)
    assert math.isnan(float(f["aqua"][("big", 4)]))                   # no data in April anywhere: no factor
    assert f["fallback"]["aqua"]["small"] == list(range(1, 13)) and 3 not in f["fallback"]["aqua"]["big"]


def test_harmonized_weights_unlisted_region_uses_country_factor():
    v, flags = _two_region_hotspots()
    f, _ = firms_pipeline.compute_factors(v, flags, regions=["big"], min_hotspots=500)
    pre = pd.DataFrame({"date": [pd.Timestamp("2010-03-05")] * 2, "sensor": ["aqua", "aqua"], "region": ["big", "other"],
                        "month": [3, 3]})
    fl = pd.DataFrame({"snpp_out": [False], "aqua_out": [False], "terra_out": [False], "n20": [0]}, index=[pd.Timestamp("2010-03-05")])
    w, src = firms_pipeline.harmonized_weights(pre, fl, f)
    assert w[0] == 2.0 and w[1] == pytest.approx((1200 + 40) / (600 + 10)) and list(src) == ["aqua", "aqua"]


# ----------------------------------------------------------------------------- carried fixes
def test_loyo_pairs_passes_the_country_regions_to_the_factor_fit(monkeypatch):
    v, flags = _two_region_hotspots()
    v["m"] = firms_pipeline.month_index(v.year.values, v.month.values)
    seen = []
    real = firms_pipeline.compute_factors

    def spy(*a, **k):
        seen.append((k.get("regions"), k.get("min_hotspots")))
        return real(*a, **k)

    monkeypatch.setattr(firms_pipeline, "compute_factors", spy)
    c = v.assign(blk1=0)
    firms_pipeline.loyo_pairs(v, flags, c, {"country": []}, regions=["big", "small", "x"], min_hotspots=500)
    assert seen and all(s == (["big", "small", "x"], 500) for s in seen)


def test_build_departments_without_departments_block(tmp_path):
    cfg = load_country("TST", _countries(tmp_path, {"TST": {k: v for k, v in _entry().items() if k != "departments"}}))
    assert cfg.departments == {}
    gj = {"features": [{"properties": {"shapeName": "Norte Grande"}, "geometry": {"type": "Polygon", "coordinates": [_square(-63, -20, -58, -19.2)]}},
                       {"properties": {"shapeName": "Sur"}, "geometry": {"type": "Polygon", "coordinates": [_square(-63, -28, -58, -20)]}}]}
    grid = {"meta": {"grid": firms_pipeline.grid_meta(cfg.grid)}, "cells": [[cfg.grid.index(r, 5), [0], [1.0]] for r in range(0, 88, 7)]}
    deps = firms_pipeline.build_departments(gj, grid, cfg)
    assert [(d["id"], d["name"]) for d in deps] == [("norte-grande", "Norte Grande"), ("sur", "Sur")]
    assert firms_pipeline.departments_note(cfg)


# ----------------------------------------------------------------------------- streaming build == in-memory build
HEADER_MODIS = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type"
HEADER_VIIRS = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type"


def _write_archives(d, name="Testland", years=(2011, 2012), seed=7):
    """Synthetic FIRMS yearly country archives: MODIS Aqua/Terra every year, VIIRS S-NPP from 2012, NOAA-20 in 2012
    (to exercise the fills), with outage days, non-vegetation rows and an FRP pattern."""
    rng = np.random.default_rng(seed)
    d.mkdir(parents=True, exist_ok=True)
    for year in years:
        days = pd.date_range(f"{year}-01-01", f"{year}-12-31")
        season = 1 + 3 * np.exp(-((days.month.values - 8.5) ** 2) / 3)
        plan = [("modis", "Aqua", 6, "MODIS"), ("modis", "Terra", 5, "MODIS")]
        if year >= 2012:
            plan += [("viirs-snpp", "N", 18, "VIIRS"), ("viirs-jpss1", "N20", 16, "VIIRS")]
        files = {}
        for src, sat, lam, inst in plan:
            n = rng.poisson(lam * season)
            if sat == "N":
                n[days.day == 9] = 0                              # S-NPP outage (NOAA-20 present)
            if sat == "Aqua":
                n[days.day == 17] = 0                             # Aqua outage ...
            if sat == "Terra":
                n[days.day == 17] = 40                            # ... with Terra >= 30
            dates = np.repeat(days.strftime("%Y-%m-%d").values, n)
            k = len(dates)
            west = rng.random(k) < 0.4
            lat = np.round(np.where(west, rng.uniform(-23.5, -19.3, k), rng.uniform(-27.4, -21.0, k)), 4)
            lon = np.round(np.where(west, rng.uniform(-62.5, -59.0, k), rng.uniform(-58.4, -54.4, k)), 4)
            df = pd.DataFrame({"latitude": lat, "longitude": lon, "b1": 330.5, "scan": 0.4, "track": 0.4, "acq_date": dates,
                               "acq_time": [f"{t:04d}" for t in rng.integers(0, 2359, k)], "satellite": sat, "instrument": inst,
                               "confidence": "n", "version": "2.0NRT", "b2": 290.1, "frp": np.round(rng.gamma(1.5, 6.0, k), 2),
                               "daynight": "D", "type": np.where(rng.random(k) < 0.05, 2, 0)})
            files.setdefault(src, []).append(df)
        for src, frames in files.items():
            body = pd.concat(frames, ignore_index=True)
            head = HEADER_MODIS if src == "modis" else HEADER_VIIRS
            body.columns = head.split(",")
            body.to_csv(d / f"{src}_{year}_{name}.csv", index=False)
    return d


def _strip(obj):
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k != "generated"}
    return obj


def _outputs(out):
    res = {}
    for p in sorted(Path(out).rglob("*")):
        if p.is_file():
            res[p.name] = _strip(json.loads(p.read_text(encoding="utf-8"))) if p.suffix == ".json" else p.read_bytes()
    return res


@pytest.mark.parametrize("kind", ["river-split", "biome"])
def test_streaming_build_equals_in_memory_build(tmp_path, monkeypatch, kind):
    data = _write_archives(tmp_path / "raw")
    entry = _entry(firms_name="Testland")
    if kind == "biome":
        entry["regions"] = {"kind": "biome", "source": str(_biome_npz(tmp_path)), "min_hotspots": 500}
    monkeypatch.setattr(firms_pipeline, "COUNTRIES_PATH", str(_countries(tmp_path, {"TST": entry})))
    outs = {}
    for streaming in (True, False):
        out = tmp_path / ("stream" if streaming else "memory")
        args = argparse.Namespace(country="TST", data=str(data), out=str(out), in_memory=not streaming)
        firms_pipeline.cmd_build(args)
        firms_pipeline.cmd_build_season(args)
        outs[streaming] = _outputs(out)
    assert set(outs[True]) == {"grid.json", "gaps.json", "series_regions.csv", "grid_monthly.csv", "burn_history.json",
                               "mask.json", "season.json"}
    for name in outs[True]:
        assert outs[True][name] == outs[False][name], name
    grid = outs[True]["grid.json"]
    assert grid["meta"]["months"]["count"] == 2012 * 12 + 12 - (2002 * 12 + 7) + 1
    assert sum(len(c[1]) for c in grid["cells"]) > 1000
    if kind == "biome":
        assert grid["meta"]["regions"]["kind"] == "biome"
        assert set(grid["meta"]["factors"]["aqua"]) == {"alpha-forests", "beta-grasslands"}
        assert "factor_fallback" in grid["meta"]


def test_streaming_reads_one_year_at_a_time(tmp_path, monkeypatch):
    data = _write_archives(tmp_path / "raw")
    monkeypatch.setattr(firms_pipeline, "COUNTRIES_PATH", str(_countries(tmp_path, {"TST": _entry(firms_name="Testland")})))
    seen = []
    real = firms_pipeline.read_archive_files

    def spy(files):
        seen.append(sorted({Path(f).name.split("_")[1] for f in files}))
        return real(files)

    monkeypatch.setattr(firms_pipeline, "read_archive_files", spy)
    firms_pipeline.cmd_build(argparse.Namespace(country="TST", data=str(data), out=str(tmp_path / "o"), in_memory=False))
    assert seen and all(len(y) == 1 for y in seen)          # never two years in one frame
    assert {y[0] for y in seen} == {"2011", "2012"}


# ----------------------------------------------------------------------------- fix round 1
def test_country_regions_keep_only_biomes_with_hotspots(tmp_path):
    cfg = _biome_cfg(tmp_path)
    rows = [(pd.Timestamp("2013-03-10"), "alpha-forests", "snpp", 900), (pd.Timestamp("2013-03-11"), "beta-grasslands", "aqua", 500),
            (pd.Timestamp("2013-03-11"), "gamma-desert", "snpp", 499)]
    daily = firms_pipeline.DailyCounts(pd.DataFrame(rows, columns=["date", "region", "sensor", "n"]))
    got = firms_pipeline.country_regions(cfg, daily)
    assert got.region_names == ["alpha-forests", "beta-grasslands"]      # < 500 hotspots in the whole archive: dropped
    assert got.regions["kind"] == "biome" and cfg.region_names[-1] == "gamma-desert"   # the input config is unchanged
    fixed = _biome_cfg(tmp_path, names=["gamma-desert"])
    assert firms_pipeline.country_regions(fixed, daily) is fixed             # explicit names are kept as they are
    assert firms_pipeline.country_regions(load_country("PRY"), daily).region_names == ["chaco", "oriental"]


def test_streaming_build_drops_biomes_without_hotspots(tmp_path, monkeypatch):
    data = _write_archives(tmp_path / "raw")
    entry = _entry(firms_name="Testland", regions={"kind": "biome", "source": str(_biome_npz(tmp_path)), "min_hotspots": 500})
    monkeypatch.setattr(firms_pipeline, "COUNTRIES_PATH", str(_countries(tmp_path, {"TST": entry})))
    out = tmp_path / "o"
    firms_pipeline.cmd_build(argparse.Namespace(country="TST", data=str(data), out=str(out), in_memory=False))
    g = json.loads((out / "grid.json").read_text(encoding="utf-8"))
    assert g["meta"]["regions"]["names"] == ["alpha-forests", "beta-grasslands"]
    assert set(pd.read_csv(out / "series_regions.csv").area) == {"paraguay", "alpha-forests", "beta-grasslands"}


def test_biome_raster_path_is_cached_once():
    a = firms_pipeline.load_biomes()
    assert firms_pipeline.load_biomes(firms_pipeline.BIOMES_PATH) is a
    assert firms_pipeline.load_biomes(str(Path(firms_pipeline.BIOMES_PATH))) is a
    rel = Path(firms_pipeline.BIOMES_PATH).relative_to(Path.cwd()) if Path.cwd() in Path(firms_pipeline.BIOMES_PATH).parents else None
    if rel is not None:
        assert firms_pipeline.load_biomes(str(rel)) is a
    assert firms_pipeline.biome_id_table() is firms_pipeline.biome_id_table(firms_pipeline.BIOMES_PATH)


def test_merge_parts_handles_zero_rows():
    empty = firms_pipeline._merge_parts([], ["cell", "m"])
    assert len(empty) == 0 and list(empty.index.names) == ["cell", "m"]
    assert len(firms_pipeline._merge_parts([], ["m"])) == 0
    idx = pd.MultiIndex.from_tuples([(1, 2)], names=["cell", "m"])
    one = pd.Series([3.0], index=idx)
    none = pd.Series([], dtype=float, index=pd.MultiIndex.from_tuples([], names=["cell", "m"]))
    assert firms_pipeline._merge_parts([none, one, none], ["cell", "m"]).equals(one)
    assert len(firms_pipeline._merge_parts([none, none], ["cell", "m"])) == 0


def test_validation_rows_keep_only_the_needed_columns(tmp_path, monkeypatch):
    data = _write_archives(tmp_path / "raw")
    monkeypatch.setattr(firms_pipeline, "COUNTRIES_PATH", str(_countries(tmp_path, {"TST": _entry(firms_name="Testland")})))
    cfg = load_country("TST")
    arch = firms_pipeline.open_archives(cfg, str(data))
    _, clean = firms_pipeline.compute_factors(arch.daily, arch.flags, regions=cfg.region_names)
    v = firms_pipeline.validation_rows(arch, clean)
    assert list(v.columns) == ["latitude", "longitude", "date", "year", "month", "m", "sensor", "region", "frp"]
    assert set(v.sensor) <= {"snpp", "aqua", "terra"}
