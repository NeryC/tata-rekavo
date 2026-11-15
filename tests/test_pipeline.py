import argparse
import base64
import json
import urllib.error

import numpy as np
import pytest

import firms_pipeline
from firms_pipeline import api_csv, cmd_fetch_current, index_to_ym, month_index, region_of, with_retries


def test_month_index_start():
    assert int(month_index(2002, 7)) == 0


def test_index_to_ym():
    assert index_to_ym(115) == (2012, 2)


def test_region_of_chaco():
    assert str(region_of(-22, -60)) == "chaco"


def test_region_of_oriental():
    assert str(region_of(-25.3, -55)) == "oriental"


# ----------------------------------------------------------------------------- retries / atomic writes
KEY = "SECRETKEY123"


def _area_delay(a):
    return min(60, 4 * (a + 1))


def test_with_retries_succeeds_after_failures():
    calls, sleeps = [], []

    def fn():
        calls.append(1)
        if len(calls) < 3:
            raise urllib.error.URLError("boom")
        return "ok"

    assert with_retries(fn, attempts=10, delay=_area_delay, sleep=sleeps.append) == "ok"
    assert len(calls) == 3
    assert sleeps == [4, 8]


def test_with_retries_raises_after_last_attempt():
    calls, sleeps = [], []

    def fn():
        calls.append(1)
        raise urllib.error.URLError("down")

    with pytest.raises(urllib.error.URLError):
        with_retries(fn, attempts=3, delay=_area_delay, sleep=sleeps.append)
    assert len(calls) == 3
    assert sleeps == [4, 8]  # no pointless sleep after the final attempt


def test_with_retries_does_not_retry_http_401():
    calls, sleeps = [], []

    def fn():
        calls.append(1)
        raise urllib.error.HTTPError(f"https://x/api/area/csv/{KEY}/p", 401, "Unauthorized", {}, None)

    with pytest.raises(Exception) as ei:
        with_retries(fn, attempts=10, delay=_area_delay, sleep=sleeps.append)
    assert len(calls) == 1 and sleeps == []
    assert KEY not in str(ei.value)


def test_with_retries_retries_http_429_and_5xx():
    for code in (429, 503):
        calls = []

        def fn():
            calls.append(1)
            if len(calls) < 2:
                raise urllib.error.HTTPError("https://x", code, "err", {}, None)
            return "ok"

        assert with_retries(fn, attempts=3, delay=lambda a: 0, sleep=lambda s: None) == "ok"
        assert len(calls) == 2


def test_api_csv_rejects_error_text(monkeypatch):
    for body in (b"<html><body>Service Unavailable</body></html>", b"Invalid MAP_KEY.", b""):
        monkeypatch.setattr(firms_pipeline, "http_get", lambda url, timeout=300, b=body: (200, b))
        with pytest.raises(RuntimeError):
            api_csv("https://x/area")


def test_api_csv_parses_csv(monkeypatch):
    monkeypatch.setattr(firms_pipeline, "http_get",
                        lambda url, timeout=300: (200, b"\n".join([b"latitude,longitude,acq_date", b"-22.1,-58.2,2026-01-02", b""])))
    assert len(api_csv("https://x/area")) == 1


def _fetch_args(tmp_path):
    out = tmp_path / "app"
    out.mkdir()
    n = firms_pipeline.MASK_N
    (out / "mask.json").write_text(json.dumps({"bits_b64": base64.b64encode(np.packbits(np.ones(n * n, bool)).tobytes()).decode()}))
    return out, argparse.Namespace(out=str(out), map_key=KEY, start="2026-01-01", end="2026-01-03",
                                   cache=str(tmp_path / "cache"), offline=False)


def test_fetch_current_exits_2_and_keeps_outputs_when_api_down(tmp_path, monkeypatch, capsys):
    out, args = _fetch_args(tmp_path)
    (out / "current.json").write_text("OLD-JSON")
    (out / "current_hotspots.csv").write_text("OLD-CSV")

    def down(url, timeout=300):
        raise urllib.error.URLError("api down")

    monkeypatch.setattr(firms_pipeline, "http_get", down)
    monkeypatch.setattr(firms_pipeline.time, "sleep", lambda s: None)
    with pytest.raises(SystemExit) as ei:
        cmd_fetch_current(args)
    assert ei.value.code == 2
    assert (out / "current.json").read_text() == "OLD-JSON"
    assert (out / "current_hotspots.csv").read_text() == "OLD-CSV"
    assert not (out / "current.json.tmp").exists()
    assert KEY not in capsys.readouterr().err


def test_fetch_current_redacts_key_on_invalid_key(tmp_path, monkeypatch, capsys):
    out, args = _fetch_args(tmp_path)

    def bad_key(url, timeout=300):
        raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, None)

    sleeps = []
    monkeypatch.setattr(firms_pipeline, "http_get", bad_key)
    monkeypatch.setattr(firms_pipeline.time, "sleep", sleeps.append)
    with pytest.raises(SystemExit) as ei:
        cmd_fetch_current(args)
    assert ei.value.code == 2
    assert sleeps == []  # 401 is not retried
    assert KEY not in capsys.readouterr().err


def test_fetch_current_writes_outputs_atomically(tmp_path, monkeypatch):
    out, args = _fetch_args(tmp_path)
    av = b"\n".join([b"data_id,min_date,max_date", b"VIIRS_SNPP_SP,2026-01-01,2026-01-03", b""])
    csv = b"\n".join([b"latitude,longitude,acq_date,acq_time,confidence,type",
                      b"-23.0,-58.0,2026-01-02,0130,n,0", b""])

    def fake(url, timeout=300):
        return (200, av if "data_availability" in url else csv)

    monkeypatch.setattr(firms_pipeline, "http_get", fake)
    monkeypatch.setattr(firms_pipeline.time, "sleep", lambda s: None)
    cmd_fetch_current(args)
    assert json.loads((out / "current.json").read_text())["cells"]
    assert (out / "current_hotspots.csv").read_text().startswith("latitude")
    assert not list(out.glob("*.tmp"))


def test_fetch_current_offline_uses_cache_without_network(tmp_path, monkeypatch):
    out, args = _fetch_args(tmp_path)
    args.offline, args.map_key = True, None
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "VIIRS_SNPP_SP_2026-01-01_3.csv").write_text(
        "latitude,longitude,acq_date,acq_time,confidence,type\n-23.0,-58.0,2026-01-02,0130,n,0\n")

    def no_net(*a, **k):
        raise AssertionError("network used in --offline mode")

    monkeypatch.setattr(firms_pipeline, "http_get", no_net)
    cmd_fetch_current(args)
    assert json.loads((out / "current.json").read_text())["cells"]
    assert not list(out.glob("*.tmp"))


# ----------------------------------------------------------------------------- departments (build-regions)
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _square(w, s, e, n):
    return [[w, s], [e, s], [e, n], [w, n], [w, s]]


def _synthetic_grid():
    # 20x20 grid of 0.1 degree cells starting at (0, 0)
    return dict(deg=0.1, lat0=0.0, lon0=0.0, rows=20, cols=20, cell_ids=set(range(400)))


def test_assign_cells_square_covers_100_cells():
    poly = {"id": "sq", "geometry": {"type": "Polygon", "coordinates": [_square(0.5, 0.5, 1.5, 1.5)]}}
    out = firms_pipeline.assign_cells([poly], **_synthetic_grid())
    assert len(out["sq"]) == 100
    assert out["sq"] == sorted(out["sq"])
    # cell (row 5, col 5) is the south-west corner cell of the square
    assert 5 * 20 + 5 in out["sq"]
    assert 4 * 20 + 5 not in out["sq"]


def test_assign_cells_hole_excluded():
    shell = _square(0.5, 0.5, 1.5, 1.5)
    hole = _square(0.8, 0.8, 1.2, 1.2)  # 4x4 = 16 cells
    poly = {"id": "ring", "geometry": {"type": "Polygon", "coordinates": [shell, hole]}}
    out = firms_pipeline.assign_cells([poly], **_synthetic_grid())
    assert len(out["ring"]) == 100 - 16
    assert 9 * 20 + 9 not in out["ring"]  # centre of the hole


def test_assign_cells_multipolygon_and_no_duplicates():
    a = {"id": "a", "geometry": {"type": "MultiPolygon", "coordinates": [
        [_square(0.0, 0.0, 0.5, 0.5)], [_square(1.0, 1.0, 1.5, 1.5)]]}}
    b = {"id": "b", "geometry": {"type": "Polygon", "coordinates": [_square(0.3, 0.3, 0.8, 0.8)]}}  # overlaps a
    out = firms_pipeline.assign_cells([a, b], **_synthetic_grid())
    assert len(out["a"]) == 50
    assert not set(out["a"]) & set(out["b"])
    assert len(out["b"]) == 25 - 4  # the 2x2 overlap stays with the first polygon


def test_assign_cells_ignores_cells_not_in_grid_ids():
    poly = {"id": "sq", "geometry": {"type": "Polygon", "coordinates": [_square(0.5, 0.5, 1.5, 1.5)]}}
    g = _synthetic_grid()
    g["cell_ids"] = {5 * 20 + 5}
    assert firms_pipeline.assign_cells([poly], **g) == {"sq": [105]}


def test_department_slug_and_name():
    assert firms_pipeline.dept_slug("Alto Paraguay") == "alto-paraguay"
    assert firms_pipeline.dept_slug("Boquerón") == "boqueron"
    assert firms_pipeline.dept_slug("Ñeembucú") == "neembucu"


def test_departments_real_data():
    gj = ROOT / "data" / "ext" / "pry_adm1.geojson"
    if not gj.exists():
        pytest.skip("data/ext/pry_adm1.geojson not present")
    grid = json.loads((ROOT / "data" / "app" / "grid.json").read_text(encoding="utf-8"))
    deps = firms_pipeline.build_departments(json.loads(gj.read_text(encoding="utf-8")), grid)
    assert len(deps) == 17
    assert len({d["id"] for d in deps}) == 17
    seen = set()
    for d in deps:
        assert d["cells"], d["id"]
        assert not seen & set(d["cells"]), f"duplicate cell in {d['id']}"
        seen |= set(d["cells"])
        w, s, e, n = d["bbox"]
        assert w < e and s < n
        assert d["geometry"]["type"] == "MultiPolygon"
    grid_ids = {c[0] for c in grid["cells"]}
    assert seen <= grid_ids
    assert len(seen) / len(grid_ids) >= 0.99


# ----------------------------------------------------------------------------- season climatology
def _synthetic_weights():
    import pandas as pd
    rows = []
    for k, year in enumerate([2021, 2022, 2023], start=1):   # 1, 2, 3 hotspots per day
        for d in pd.date_range(f"{year}-01-01", f"{year}-12-31"):
            rows.append((d, "paraguay", float(k)))
    return pd.DataFrame(rows, columns=["date", "area", "w"])


def test_daily_cumulative_median_and_shape():
    cum = firms_pipeline.daily_cumulative(_synthetic_weights(), [2021, 2022, 2023])["paraguay"]
    assert cum.shape == (3, 365)
    p = firms_pipeline.season_percentiles(cum)
    assert p["p50"][364] == 730          # median of 365, 730, 1095
    assert p["p50"][0] == 2


def test_daily_cumulative_leap_day_added_to_doy_59():
    import pandas as pd
    df = pd.DataFrame({"date": pd.to_datetime(["2024-02-28", "2024-02-29", "2024-03-01"]),
                       "area": "paraguay", "w": [1.0, 2.0, 4.0]})
    cum = firms_pipeline.daily_cumulative(df, [2024])["paraguay"][0]
    assert cum[57] == 0 and cum[58] == 3      # DOY 59 = Feb 28 + Feb 29
    assert cum[59] == 7 and cum[364] == 7     # Mar 1 is DOY 60, as in a common year


def test_season_percentiles_monotone_and_rounded():
    rng = np.random.default_rng(0)
    cum = np.cumsum(rng.random((23, 365)) * 10, axis=1)
    p = firms_pipeline.season_percentiles(cum)
    for k in ("p10", "p50", "p90"):
        assert len(p[k]) == 365
        assert np.all(np.diff(p[k]) >= 0)
        assert all(round(x, 1) == x for x in p[k])
    assert all(a <= b <= c for a, b, c in zip(p["p10"], p["p50"], p["p90"]))


def test_season_real_data_matches_annual_median():
    import pandas as pd
    sj, sr = ROOT / "data" / "app" / "season.json", ROOT / "data" / "app" / "series_regions.csv"
    if not sj.exists():
        pytest.skip("data/app/season.json not present")
    season = json.loads(sj.read_text(encoding="utf-8"))
    assert season["meta"]["years"] == [2003, 2025] and season["meta"]["doy"] == 365
    assert {"paraguay", "chaco", "oriental"} <= set(season["areas"])
    s = pd.read_csv(sr)
    s = s[(s.area == "paraguay") & s.year.between(2003, 2025)]
    med = s.groupby("year").harmonized.sum().median()
    p50 = season["areas"]["paraguay"]["p50"][364]
    assert abs(p50 - med) / med < 0.02
    assert sj.stat().st_size < 400_000


# ----------------------------------------------------------------------------- factor fitting (counts / FRP)
import math

import pandas as pd

NAN = float("nan")


def _factor_fixture():
    """Deterministic hotspots Dec 2011 - Jun 2013, two regions, three sensors, FRP pattern, outage days."""
    rows = []
    for i, d in enumerate(pd.date_range("2011-12-01", "2013-06-30")):
        for region in ("chaco", "oriental"):
            k = 1 if region == "chaco" else 2
            n = {"snpp": 3 + (d.day_of_year % 4) + k, "aqua": 1 + d.day % 3, "terra": 1 + (d.month + k) % 2}
            if region == "chaco" and d.month == 5:
                n["terra"] = 0
            for s, cnt in n.items():
                for j in range(cnt):
                    rows.append((d, s, region, 1.5 * ((i + j) % 7 + 1)))
    v = pd.DataFrame(rows, columns=["date", "sensor", "region", "frp"])
    v["year"], v["month"] = v.date.dt.year, v.date.dt.month
    days = pd.date_range("2011-12-01", "2013-06-30")
    flags = pd.DataFrame({"snpp_out": days.day == 7, "aqua_out": days.day == 13, "terra_out": days.day == 21}, index=days)
    return v, flags


# compute_factors output pinned before the value_col refactor (counts)
PINNED_FACTORS = {
    (): {
        ("aqua", "chaco"): [2.719298245614035, 2.704761904761905, 2.719298245614035, 2.6818181818181817, 2.719298245614035, 2.7,
                            2.6491228070175437, 2.719298245614035, 2.690909090909091, 2.6491228070175437, 2.7454545454545456, 2.719298245614035],
        ("aqua", "oriental"): [3.210526315789474, 3.1904761904761907, 3.210526315789474, 3.172727272727273, 3.210526315789474, 3.190909090909091,
                               3.1403508771929824, 3.210526315789474, 3.1818181818181817, 3.1403508771929824, 3.2363636363636363, 3.210526315789474],
        ("terra", "chaco"): [5.535714285714286, 2.784313725490196, 5.535714285714286, 2.7314814814814814, NAN, 2.75,
                             5.392857142857143, 2.767857142857143, 5.481481481481482, 2.6964285714285716, 5.592592592592593, 2.767857142857143],
        ("terra", "oriental"): [3.267857142857143, 6.568627450980392, 3.267857142857143, 6.462962962962963, 3.267857142857143, 6.5,
                                3.1964285714285716, 6.535714285714286, 3.240740740740741, 6.392857142857143, 3.2962962962962963, 6.535714285714286],
    },
    (2013,): {
        ("aqua", "chaco"): [NAN, 2.6666666666666665, 2.719298245614035, 2.709090909090909, 2.719298245614035, 2.690909090909091,
                            2.6491228070175437, 2.719298245614035, 2.690909090909091, 2.6491228070175437, 2.7454545454545456, 2.719298245614035],
        ("aqua", "oriental"): [NAN, 3.1481481481481484, 3.210526315789474, 3.2, 3.210526315789474, 3.1818181818181817,
                               3.1403508771929824, 3.210526315789474, 3.1818181818181817, 3.1403508771929824, 3.2363636363636363, 3.210526315789474],
        ("terra", "chaco"): [NAN, 2.769230769230769, 5.535714285714286, 2.759259259259259, NAN, 2.740740740740741,
                             5.392857142857143, 2.767857142857143, 5.481481481481482, 2.6964285714285716, 5.592592592592593, 2.767857142857143],
        ("terra", "oriental"): [NAN, 6.538461538461538, 3.267857142857143, 6.518518518518518, 3.267857142857143, 6.481481481481482,
                                3.1964285714285716, 6.535714285714286, 3.240740740740741, 6.392857142857143, 3.2962962962962963, 6.535714285714286],
    },
}


def _assert_pinned(f, clean_days, excl):
    assert len(clean_days) == 465
    assert clean_days.min() == pd.Timestamp("2012-02-01") and clean_days.max() == pd.Timestamp("2013-06-30")
    for (s, reg), want in PINNED_FACTORS[excl].items():
        got = [float(f[s][(reg, mo)]) for mo in range(1, 13)]
        for g, w in zip(got, want):
            assert (math.isnan(g) and math.isnan(w)) or g == w, (s, reg, got)


def test_compute_factors_regression_counts():
    v, flags = _factor_fixture()
    for excl in PINNED_FACTORS:
        f, clean_days = firms_pipeline.compute_factors(v, flags, exclude_years=excl)
        _assert_pinned(f, clean_days, excl)


def test_compute_factors_value_col_none_is_the_count_path():
    v, flags = _factor_fixture()
    for excl in PINNED_FACTORS:
        f, clean_days = firms_pipeline.compute_factors(v, flags, exclude_years=excl, value_col=None)
        _assert_pinned(f, clean_days, excl)


def _frp_double_fixture():
    """S-NPP FRP = 2 x Aqua FRP on every clean day; outage days carry wildly different S-NPP FRP."""
    v, flags = _factor_fixture()
    aq = v[v.sensor == "aqua"]
    sn = aq.assign(sensor="snpp", frp=aq.frp * 2)
    out_days = flags.index[flags.snpp_out | flags.aqua_out | flags.terra_out]
    noise = sn[sn.date.isin(out_days)].assign(frp=5000.0)
    return pd.concat([v[v.sensor != "snpp"], sn, noise], ignore_index=True), flags


def test_compute_factors_frp_factor_two():
    v, flags = _frp_double_fixture()
    f, _ = firms_pipeline.compute_factors(v, flags, value_col="frp")
    assert np.allclose(f["aqua"].values, 2.0, rtol=1e-12)


def test_compute_factors_frp_excludes_nan_rows():
    v, flags = _frp_double_fixture()
    extra = v[(v.sensor == "aqua") & (v.month == 3)].assign(frp=np.nan)   # NaN rows next to real ones
    only_nan = v[(v.sensor == "snpp") & (v.region == "chaco") & (v.month == 4)].assign(sensor="terra", frp=np.nan)
    v2 = pd.concat([v[~((v.sensor == "terra") & (v.region == "chaco") & (v.month == 4))], extra, only_nan], ignore_index=True)
    f, _ = firms_pipeline.compute_factors(v2, flags, value_col="frp")
    assert np.allclose(f["aqua"].values, 2.0, rtol=1e-12)
    assert math.isnan(float(f["terra"][("chaco", 4)]))  # only NaN FRP in that group: no factor, never inf


def test_compute_factors_frp_is_ratio_of_sums_with_outlier():
    v, flags = _factor_fixture()
    clean = flags.index[~flags.snpp_out & ~flags.aqua_out & ~flags.terra_out & (flags.index >= "2012-02-01")]
    i = v.index[(v.sensor == "snpp") & (v.region == "oriental") & (v.month == 9) & v.date.isin(clean)][0]
    v.loc[i, "frp"] = 9000.0  # one huge fire
    f, _ = firms_pipeline.compute_factors(v, flags, value_col="frp")
    c = v[v.date.isin(clean) & (v.region == "oriental") & (v.month == 9)]
    want = c[c.sensor == "snpp"].frp.sum() / c[c.sensor == "aqua"].frp.sum()
    assert float(f["aqua"][("oriental", 9)]) == pytest.approx(want, rel=1e-12)


def test_compute_factors_frp_keeps_zero_rows():
    v, flags = _frp_double_fixture()
    zeros = v[(v.sensor == "aqua") & (v.month == 6)].assign(frp=0.0)
    f, _ = firms_pipeline.compute_factors(pd.concat([v, zeros], ignore_index=True), flags, value_col="frp")
    assert np.allclose(f["aqua"].values, 2.0, rtol=1e-12)  # zero-FRP detections add nothing to the sums


def test_harmonized_weights_value_col_scales_by_frp():
    d = pd.Timestamp("2013-03-05")
    v = pd.DataFrame({"date": [d] * 4, "sensor": ["snpp", "snpp", "snpp", "aqua"], "region": ["chaco"] * 4,
                      "month": [3] * 4, "frp": [4.0, 0.0, np.nan, 10.0]})
    flags = pd.DataFrame({"snpp_out": [False], "aqua_out": [False], "terra_out": [False], "n20": [0]}, index=[d])
    idx = pd.MultiIndex.from_product([firms_pipeline.REGIONS, range(1, 13)])
    f = {"aqua": pd.Series(0.5, index=idx), "terra": pd.Series(0.7, index=idx)}
    w_cnt, src_cnt = firms_pipeline.harmonized_weights(v, flags, f)
    w, src = firms_pipeline.harmonized_weights(v, flags, f, value_col="frp")
    assert list(w_cnt) == [1.0, 1.0, 1.0, 0.0]
    assert list(w) == [4.0, 0.0, 0.0, 0.0]          # observed S-NPP FRP as is; FRP=0 kept (0); NaN -> 0
    assert list(src) == list(src_cnt) == ["snpp", "snpp", "snpp", ""]
    pre = v.assign(date=pd.Timestamp("2010-03-05"))
    flags_pre = flags.set_axis([pd.Timestamp("2010-03-05")])
    w, src = firms_pipeline.harmonized_weights(pre, flags_pre, f, value_col="frp")
    assert list(w) == [0.0, 0.0, 0.0, 5.0] and src[3] == "aqua"   # Aqua FRP x FRP factor


def test_loyo_stats_reports_median_p90_and_bias():
    t = pd.DataFrame({"obs": [10.0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0.5],
                      "pred": [11.0, 9, 10, 10, 12, 8, 10, 10, 10, 20, 3]})
    s = firms_pipeline.loyo_stats(t, 1)
    assert s["n"] == 10 and s["min_obs"] == 1
    assert s["mdape_pct"] == 5.0               # median of 0,0,0,0,0,10,10,20,20,100 (%), obs >= 1 only
    assert s["p90_ape_pct"] == round(float(np.quantile([10, 10, 0, 0, 20, 20, 0, 0, 0, 100], .9)), 1)
    assert s["bias_pct"] == round((113 / 100.5 - 1) * 100, 1)


def test_fit_error_model_recovers_power_law():
    pred = np.logspace(0, 4, 6000)
    rel = 2.0 * pred ** -0.5
    sign = np.where(np.arange(len(pred)) % 2, 1, -1)
    t = pd.DataFrame({"obs": pred * (1 + sign * rel), "pred": pred})
    ec, ep, bstat = firms_pipeline.fit_error_model([t])
    assert ec == pytest.approx(2.0, rel=0.05) and ep == pytest.approx(0.5, rel=0.05)
    assert (bstat.k >= 30).all()


def test_frp_real_data():
    fj, gj = ROOT / "data" / "app" / "frp.json", ROOT / "data" / "app" / "grid.json"
    if not fj.exists():
        pytest.skip("data/app/frp.json not present")
    assert fj.stat().st_size < 6_000_000
    frp = json.loads(fj.read_text(encoding="utf-8"))
    grid = json.loads(gj.read_text(encoding="utf-8"))
    meta = frp["meta"]
    assert meta["unit"] == "MW (sum of FRP), VIIRS S-NPP-equivalent"
    assert meta["grid"] == grid["meta"]["grid"] and meta["months"] == grid["meta"]["months"]
    loyo = meta["validation"]["leave_one_year_out"]
    for k in ("paraguay", "chaco", "oriental"):
        assert set(loyo[k]) == {"mdape_pct", "p90_pct", "bias_pct"}
    assert meta["experimental"] is (loyo["paraguay"]["mdape_pct"] > 25)
    assert {"c", "p", "sys_by_year", "formula"} <= set(meta["error_model"])
    for s in ("aqua", "terra"):
        for reg in ("chaco", "oriental"):
            assert len(meta["factors"][s][reg]) == 12
    grid_cells = {c[0] for c in grid["cells"]}
    n = grid["meta"]["months"]["count"]
    for idx, m, x in frp["cells"]:
        assert idx in grid_cells
        assert len(m) == len(x) and all(0 <= k < n for k in m) and all(val > 0 for val in x)
