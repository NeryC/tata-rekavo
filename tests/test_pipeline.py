import argparse
import base64
import json
import urllib.error
from pathlib import Path

import numpy as np
import pytest

import firms_pipeline
from firms_pipeline import (CountryConfig, GridSpec, api_csv, cell_of, cmd_fetch_current, index_to_ym, load_country,
                            month_index, region_of, with_retries)

PRY = load_country("PRY")
ROOT = Path(__file__).resolve().parent.parent


def test_month_index_start():
    assert int(month_index(2002, 7)) == 0


def test_index_to_ym():
    assert index_to_ym(115) == (2012, 2)


def test_region_of_chaco():
    assert str(region_of(-22, -60, PRY)) == "chaco"


def test_region_of_oriental():
    assert str(region_of(-25.3, -55, PRY)) == "oriental"


# ----------------------------------------------------------------------------- country config
def test_load_country_pry_keeps_the_paraguay_constants():
    c = load_country("PRY")
    assert isinstance(c, CountryConfig)
    assert c.iso3 == "PRY" and c.firms_name == "Paraguay" and c.area == "paraguay"
    assert c.bbox == (-62.8, -27.7, -54.1, -19.1)
    assert (c.deg, c.lat0, c.lon0, c.rows, c.cols) == (0.1, -28.0, -63.0, 88, 88)
    assert c.region_names == ["chaco", "oriental"]
    assert c.regions["kind"] == "river-split" and c.regions["chaco_south"] == -25.35
    assert c.export_hotspots is True and c.burn_history is True
    assert c.grid == GridSpec(0.1, -28.0, -63.0, 88, 88)
    assert c.fine_grid == GridSpec(0.01, -28.0, -63.0, 900, 900)
    assert c.mask_grid == GridSpec(0.05, -28.0, -63.0, 180, 180)


def test_load_country_is_case_insensitive_and_rejects_unknown():
    assert load_country("pry").iso3 == "PRY"
    with pytest.raises(ValueError, match="XXX"):
        load_country("XXX")


def _config(tmp_path, **over):
    raw = json.loads((ROOT / "countries.json").read_text(encoding="utf-8"))["PRY"]
    raw.update(over)
    p = tmp_path / "countries.json"
    p.write_text(json.dumps({"TST": raw}), encoding="utf-8")
    return load_country("TST", p)


def test_cell_of_non_square_grid():
    g = GridSpec(deg=0.5, lat0=0.0, lon0=0.0, rows=2, cols=4)
    r, c, ok = cell_of([0.1, 0.9, 0.9, 1.1, 0.1], [0.1, 1.9, 2.1, 0.1, -0.1], g)
    assert list(r) == [0, 1, 1, 2, 0] and list(c) == [0, 3, 4, 0, -1]
    assert list(ok) == [True, True, False, False, False]
    assert g.index(1, 3) == 7


def test_region_of_unknown_kind_rejected(tmp_path):
    cfg = _config(tmp_path, regions={"kind": "nope", "names": ["a"]})
    with pytest.raises(ValueError, match="nope"):
        region_of(-22, -60, cfg)


def test_every_subcommand_takes_country(monkeypatch):
    seen = {}
    for name in ["download", "build", "export-hotspots", "validate", "fetch-current", "build-regions", "build-season", "build-frp", "build-context"]:
        monkeypatch.setattr(firms_pipeline.sys, "argv", ["firms_pipeline.py", name, "--country", "pry"])
        args = firms_pipeline.parse_args()
        seen[name] = args.country
        monkeypatch.setattr(firms_pipeline.sys, "argv", ["firms_pipeline.py", name])
        assert firms_pipeline.parse_args().country == "PRY"
    assert set(seen.values()) == {"pry"}


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
    n = PRY.mask_grid.rows * PRY.mask_grid.cols
    (out / "mask.json").write_text(json.dumps({"bits_b64": base64.b64encode(np.packbits(np.ones(n, bool)).tobytes()).decode()}))
    return out, argparse.Namespace(out=str(out), map_key=KEY, start="2026-01-01", end="2026-01-03",
                                   cache=str(tmp_path / "cache"), offline=False, country="PRY")


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


def test_fetch_current_caches_other_countries_in_their_own_folder(tmp_path, monkeypatch):
    bol = load_country("BOL")
    out = tmp_path / "app"
    out.mkdir()
    n = bol.mask_grid.rows * bol.mask_grid.cols
    (out / "mask.json").write_text(json.dumps({"bits_b64": base64.b64encode(np.packbits(np.ones(n, bool)).tobytes()).decode()}))
    args = argparse.Namespace(out=str(out), map_key=KEY, start="2026-01-01", end="2026-01-03",
                              cache=str(tmp_path / "cache"), offline=False, country="BOL")
    av = b"\n".join([b"data_id,min_date,max_date", b"VIIRS_SNPP_SP,2026-01-01,2026-01-03", b""])
    csv = b"\n".join([b"latitude,longitude,acq_date,acq_time,confidence,type", b"-16.0,-63.0,2026-01-02,0130,n,0", b""])
    monkeypatch.setattr(firms_pipeline, "http_get", lambda url, timeout=300: (200, av if "data_availability" in url else csv))
    monkeypatch.setattr(firms_pipeline.time, "sleep", lambda s: None)
    cmd_fetch_current(args)
    assert list((tmp_path / "cache" / "BOL").glob("VIIRS_SNPP_SP_*.csv"))
    assert not list((tmp_path / "cache").glob("*.csv"))   # the Paraguay cache folder is untouched
    assert json.loads((out / "current.json").read_text())["cells"]


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


def _two_squares_geojson():
    ft = lambda name, x0: {"type": "Feature", "properties": {"shapeName": name},
                           "geometry": {"type": "Polygon", "coordinates": [_square(x0, 0.0, x0 + 1.0, 1.0)]}}
    return {"type": "FeatureCollection", "features": [ft("Mainland", 0.0), ft("Galápagos", 10.0)]}


def _tiny_country(departments):
    return CountryConfig(iso3="XXX", firms_name="Xxx", bbox=(0, 0, 2, 1), deg=0.5, lat0=0.0, lon0=0.0, rows=2, cols=4,
                         regions={"kind": "biome", "names": []}, export_hotspots=False, burn_history=False, departments=departments,
                         mask={"deg": 0.25, "rows": 4, "cols": 8})


def test_departments_drop_leaves_out_units_outside_the_grid():
    grid = {"meta": {"grid": {"deg": 0.5, "lat0": 0.0, "lon0": 0.0, "rows": 2, "cols": 4}}, "cells": [[0], [1], [4], [5]]}
    cfg = _tiny_country({"names": {"mainland": "Mainland"}, "drop": ["galapagos"]})
    deps = firms_pipeline.build_departments(_two_squares_geojson(), grid, cfg)
    assert [d["id"] for d in deps] == ["mainland"] and deps[0]["cells"] == [0, 1, 4, 5]
    # without the drop entry the unexpected unit is still an error (a typo in countries.json must not pass silently)
    with pytest.raises(ValueError, match="galapagos"):
        firms_pipeline.build_departments(_two_squares_geojson(), grid, _tiny_country({"names": {"mainland": "Mainland"}}))


def test_departments_cover_mask_cells_without_archive_data():
    grid = {"meta": {"grid": {"deg": 0.5, "lat0": 0.0, "lon0": 0.0, "rows": 2, "cols": 4}}, "cells": [[0], [1], [4], [5]]}
    cfg = _tiny_country({"names": {"mainland": "Mainland"}, "drop": ["galapagos"]})
    bits = np.zeros(4 * 8, bool)
    bits[0 * 8 + 5] = True      # mask cell (row 0, col 5): centre lat 0.125, lon 1.375 -> app cell 2, which has no archive data
    bits[1 * 8 + 1] = True      # a mask cell inside app cell 0
    mask = {"bits_b64": base64.b64encode(np.packbits(bits).tobytes()).decode()}
    assert firms_pipeline.mask_cells(cfg, mask) == {0, 2}
    deps = firms_pipeline.build_departments(_two_squares_geojson(), grid, cfg, extra_cells=firms_pipeline.mask_cells(cfg, mask))
    assert deps[0]["cells"] == [0, 1, 2, 4, 5]


def test_departments_real_data():
    gj = ROOT / "data" / "ext" / "pry_adm1.geojson"
    if not gj.exists():
        pytest.skip("data/ext/pry_adm1.geojson not present")
    grid = json.loads((ROOT / "data" / "app" / "grid.json").read_text(encoding="utf-8"))
    deps = firms_pipeline.build_departments(json.loads(gj.read_text(encoding="utf-8")), grid, PRY)
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


DEPARTMENTS = {
    "BOL": {"beni": "Beni", "chuquisaca": "Chuquisaca", "cochabamba": "Cochabamba", "la-paz": "La Paz", "oruro": "Oruro",
            "pando": "Pando", "potosi": "Potosí", "santa-cruz": "Santa Cruz", "tarija": "Tarija"},
    "PER": {"amazonas": "Amazonas", "ancash": "Áncash", "apurimac": "Apurímac", "arequipa": "Arequipa", "ayacucho": "Ayacucho",
            "cajamarca": "Cajamarca", "cusco": "Cusco", "huancavelica": "Huancavelica", "huanuco": "Huánuco", "ica": "Ica",
            "junin": "Junín", "la-libertad": "La Libertad", "lambayeque": "Lambayeque", "lima": "Lima", "loreto": "Loreto",
            "madre-de-dios": "Madre de Dios", "moquegua": "Moquegua", "pasco": "Pasco", "piura": "Piura", "puno": "Puno",
            "san-martin": "San Martín", "tacna": "Tacna", "tumbes": "Tumbes", "ucayali": "Ucayali"},   # Callao and Lima Province merged into Lima
    "ECU": {"azuay": "Azuay", "bolivar": "Bolívar", "canar": "Cañar", "carchi": "Carchi", "chimborazo": "Chimborazo",
            "cotopaxi": "Cotopaxi", "el-oro": "El Oro", "esmeraldas": "Esmeraldas", "guayas": "Guayas", "imbabura": "Imbabura",
            "loja": "Loja", "los-rios": "Los Ríos", "manabi": "Manabí", "morona-santiago": "Morona Santiago", "napo": "Napo",
            "orellana": "Orellana", "pastaza": "Pastaza", "pichincha": "Pichincha", "santa-elena": "Santa Elena",
            "santo-domingo-de-los-tsachilas": "Santo Domingo de los Tsáchilas", "sucumbios": "Sucumbíos", "tungurahua": "Tungurahua",
            "zamora-chinchipe": "Zamora Chinchipe"},   # mainland only: Galapagos dropped
    "URY": {"artigas": "Artigas", "canelones": "Canelones", "cerro-largo": "Cerro Largo", "colonia": "Colonia", "durazno": "Durazno",
            "flores": "Flores", "florida": "Florida", "lavalleja": "Lavalleja", "maldonado": "Maldonado", "montevideo": "Montevideo",
            "paysandu": "Paysandú", "rio-negro": "Río Negro", "rivera": "Rivera", "rocha": "Rocha", "salto": "Salto",
            "san-jose": "San José", "soriano": "Soriano", "tacuarembo": "Tacuarembó", "treinta-y-tres": "Treinta y Tres"},
}


@pytest.mark.parametrize("iso3", sorted(DEPARTMENTS))
def test_departments_real_data_other_countries(iso3):
    gj = ROOT / "data" / "ext" / f"{iso3.lower()}_adm1.geojson"
    grid_path = ROOT / "data" / "app" / iso3 / "grid.json"
    if not gj.exists() or not grid_path.exists():
        pytest.skip(f"data/ext/{gj.name} or data/app/{iso3}/grid.json not present")
    grid = json.loads(grid_path.read_text(encoding="utf-8"))
    cfg = load_country(iso3)
    extra = firms_pipeline.mask_cells(cfg, json.loads((grid_path.parent / "mask.json").read_text(encoding="utf-8")))         if cfg.departments.get("mask_cells") else set()
    deps = firms_pipeline.build_departments(json.loads(gj.read_text(encoding="utf-8")), grid, cfg, extra_cells=extra)
    assert {d["id"]: d["name"] for d in deps} == DEPARTMENTS[iso3]    # slugs without accents, display names with them
    seen = set()
    for d in deps:
        assert d["cells"], d["id"]
        assert not seen & set(d["cells"]), f"duplicate cell in {d['id']}"
        seen |= set(d["cells"])
        w, s, e, n = d["bbox"]
        assert w < e and s < n
        assert d["geometry"]["type"] == "MultiPolygon"
    data = {c[0] for c in grid["cells"]}
    assert data <= seen <= data | extra   # every cell with data and every mask cell belongs to exactly one department


def test_region_cells_bolivia_cover_the_grid_once():
    grid_path = ROOT / "data" / "app" / "BOL" / "grid.json"
    if not grid_path.exists() or not Path(firms_pipeline.BIOMES_PATH).exists():
        pytest.skip("data/app/BOL/grid.json or data/ext/biomes_latam.npz not present")
    bol = load_country("BOL")
    grid = json.loads(grid_path.read_text(encoding="utf-8"))
    cells = firms_pipeline.build_region_cells(grid["meta"]["grid"], bol)
    assert list(cells) == bol.region_names              # every factor region has cells, in the config order
    flat = [c for v in cells.values() for c in v]
    assert len(flat) == len(set(flat))                  # no cell in two regions
    assert {c[0] for c in grid["cells"]} <= set(flat)   # every cell with data has a region
    g = grid["meta"]["grid"]
    cell = lambda lat, lon: int((lat - g["lat0"]) // g["deg"]) * g["cols"] + int((lon - g["lon0"]) // g["deg"])
    assert cell(-16.5, -68.1) in cells["montane-grasslands-shrublands"]           # La Paz, Altiplano
    assert cell(-11.0, -66.0) in cells["tropical-subtropical-moist-broadleaf-forests"]   # Riberalta, Amazon


@pytest.mark.parametrize("iso3", ["ECU", "PER", "URY"])
def test_region_cells_other_countries_cover_the_grid_once(iso3):
    grid_path = ROOT / "data" / "app" / iso3 / "grid.json"
    if not grid_path.exists() or not Path(firms_pipeline.BIOMES_PATH).exists():
        pytest.skip(f"data/app/{iso3}/grid.json or data/ext/biomes_latam.npz not present")
    cfg = load_country(iso3)
    grid = json.loads(grid_path.read_text(encoding="utf-8"))
    cells = firms_pipeline.build_region_cells(grid["meta"]["grid"], cfg)
    assert list(cells) == cfg.region_names                # explicit names in countries.json: every region has cells
    assert grid["meta"]["regions"]["names"] == cfg.region_names
    flat = [c for v in cells.values() for c in v]
    assert len(flat) == len(set(flat))                    # no cell in two regions
    data = {c[0] for c in grid["cells"]}
    assert len(data & set(flat)) / len(data) >= 0.99      # coastal cells mostly over the sea belong to no biome (as test_contract)


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
    idx = pd.MultiIndex.from_product([PRY.region_names, range(1, 13)])
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


def test_frp_cells_rounds_and_drops_zero():
    t = pd.DataFrame({"cell": [5, 5, 7, 9], "m": [3, 1, 0, 2], "frp": [12.34, 0.04, 0.0, 1.06]})
    assert firms_pipeline.frp_cells(t) == [[5, [3], [12.3]], [9, [2], [1.1]]]


def test_fetch_current_adds_frp_sum_array(tmp_path, monkeypatch):
    out, args = _fetch_args(tmp_path)
    av = b"\n".join([b"data_id,min_date,max_date", b"VIIRS_SNPP_SP,2026-01-01,2026-01-03", b""])
    csv = b"\n".join([b"latitude,longitude,acq_date,acq_time,confidence,frp,type",
                      b"-23.01,-58.01,2026-01-02,0130,n,1.2,0", b"-23.02,-58.02,2026-01-02,0131,n,2.4,0", b""])
    monkeypatch.setattr(firms_pipeline, "http_get", lambda url, timeout=300: (200, av if "data_availability" in url else csv))
    monkeypatch.setattr(firms_pipeline.time, "sleep", lambda s: None)
    cmd_fetch_current(args)
    doc = json.loads((out / "current.json").read_text())
    (cell,) = doc["cells"]
    m = int(month_index(2026, 1))
    assert cell[1:3] == [[m], [2.0]]           # first three arrays unchanged
    assert cell[3] == [3.6]                    # FRP sum per month, observed VIIRS (MW)
    assert doc["meta"]["cell_columns"] == ["cell_index", "month_indices", "viirs_hotspots", "viirs_frp_mw"]


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


# ----------------------------------------------------------------------------- build-context (protected-area fire statistics)
def _hot(rows):
    """rows = [(lat, lon, m, n, frp, region, dept)] -> hotspot frame as used by context_stats."""
    import pandas as pd
    return pd.DataFrame(rows, columns=["latitude", "longitude", "m", "n", "frp", "region", "dept"])


def _poly(w, s, e, n, hole=None):
    rings = [_square(w, s, e, n)]
    if hole:
        rings.append(_square(*hole))
    return {"type": "Polygon", "coordinates": rings}


def test_context_hotspot_in_two_overlapping_areas_counts_in_both_but_once_in_zones():
    areas = [{"id": "A", "geometry": _poly(0, 0, 2, 2)}, {"id": "B", "geometry": _poly(1, 1, 3, 3)}]
    h = _hot([(1.5, 1.5, 10, 2.0, 5.0, "oriental", "d1"),    # inside A and B
              (0.5, 0.5, 10, 1.0, 1.0, "oriental", "d1"),    # inside A only
              (2.5, 2.5, 11, 4.0, 8.0, "oriental", "d2"),    # inside B only
              (9.0, 9.0, 10, 7.0, 7.0, "oriental", "d1")])   # outside every area
    out = firms_pipeline.context_stats(h, areas, "paraguay")
    a, b = out["areas"]["A"], out["areas"]["B"]
    assert (a["m"], a["n"], a["frp"]) == ([10], [3.0], [6.0])
    assert (b["m"], b["n"], b["frp"]) == ([10, 11], [2.0, 4.0], [5.0, 8.0])
    z = out["zones"]["paraguay"]
    assert (z["m"], z["n"], z["frp"]) == ([10, 11], [3.0, 4.0], [6.0, 8.0])   # the shared hotspot once
    assert out["zones"]["oriental"] == z
    assert out["zones"]["d1"]["n"] == [3.0] and out["zones"]["d2"]["n"] == [4.0] and out["zones"]["d2"]["m"] == [11]


def test_context_by_zone_is_the_area_series_inside_each_department_and_region():
    areas = [{"id": "A", "geometry": _poly(0, 0, 4, 4)}]
    h = _hot([(1.0, 1.0, 10, 2.0, 5.0, "chaco", "d1"),
              (2.0, 1.0, 10, 3.0, 4.0, "chaco", "d2"),
              (3.0, 3.0, 11, 1.0, 1.0, "oriental", "d2"),
              (9.0, 9.0, 10, 9.0, 9.0, "chaco", "d1")])      # outside the area: in no series
    a = firms_pipeline.context_stats(h, areas, "paraguay")["areas"]["A"]
    bz = a["by_zone"]
    assert set(bz) == {"chaco", "oriental", "d1", "d2"}
    assert (bz["d1"]["m"], bz["d1"]["n"], bz["d1"]["frp"]) == ([10], [2.0], [5.0])
    assert (bz["d2"]["m"], bz["d2"]["n"]) == ([10, 11], [3.0, 1.0])
    assert (bz["chaco"]["m"], bz["chaco"]["n"]) == ([10], [5.0]) and bz["oriental"]["n"] == [1.0]
    assert (a["m"], a["n"]) == ([10, 11], [5.0, 1.0])           # the whole series is unchanged
    assert "paraguay" not in bz


def test_context_hotspot_outside_adds_nothing():
    out = firms_pipeline.context_stats(_hot([(9.0, 9.0, 3, 1.0, 1.0, "chaco", "d1")]), [{"id": "A", "geometry": _poly(0, 0, 1, 1)}], "paraguay")
    assert out["areas"]["A"]["m"] == [] and out["areas"]["A"]["n"] == [] and out["areas"]["A"]["frp"] == []
    assert out["zones"]["paraguay"]["m"] == []


def test_context_polygon_hole_is_excluded_and_multipolygon_supported():
    hole = {"id": "H", "geometry": _poly(0, 0, 4, 4, hole=(1, 1, 3, 3))}
    multi = {"id": "M", "geometry": {"type": "MultiPolygon", "coordinates": [[_square(10, 10, 11, 11)], [_square(20, 20, 21, 21)]]}}
    h = _hot([(2.0, 2.0, 5, 1.0, 1.0, "chaco", None),      # in the hole
              (0.5, 0.5, 5, 2.0, 2.0, "chaco", None),      # in the ring
              (20.5, 20.5, 6, 3.0, 3.0, "chaco", None)])   # second part of the multipolygon
    out = firms_pipeline.context_stats(h, [hole, multi], "paraguay")
    assert out["areas"]["H"]["n"] == [2.0]
    assert out["areas"]["M"]["m"] == [6] and out["areas"]["M"]["n"] == [3.0]


def test_context_rounds_to_one_decimal_and_drops_zero_months():
    out = firms_pipeline.context_stats(_hot([(0.5, 0.5, 4, 0.04, 0.03, "chaco", None), (0.5, 0.5, 5, 1.04, 0.0, "chaco", None),
                                              (0.5, 0.5, 5, 0.3, 2.26, "chaco", None)]), [{"id": "A", "geometry": _poly(0, 0, 1, 1)}], "paraguay")
    a = out["areas"]["A"]
    assert a["m"] == [5] and a["n"] == [1.3] and a["frp"] == [2.3]


def test_context_overlap_lists_from_hotspots_and_cell_centres():
    areas = [{"id": "A", "geometry": _poly(0, 0, 2, 2)}]
    h = _hot([(0.5, 0.5, 1, 1.0, 1.0, "oriental", "d1")])
    centres = {"lon": np.array([1.5, 1.6, 5.0]), "lat": np.array([1.5, 1.5, 5.0]),
               "dept": np.array(["d2", "d2", "d3"], dtype=object), "region": np.array(["chaco", "chaco", "oriental"], dtype=object)}
    a = firms_pipeline.context_stats(h, areas, "paraguay", centres=centres)["areas"]["A"]
    assert a["departments"] == ["d1", "d2"] and a["regions"] == ["chaco", "oriental"]


def _walk(x, path="$"):
    """Fail on geometry-like keys and on arrays of lon/lat pairs anywhere in a JSON document."""
    bad_keys = {"geometry", "coordinates", "bbox", "centroid", "lat", "lon", "latitude", "longitude", "lng", "cell_lat", "cell_lon"}
    if isinstance(x, dict):
        for k, v in x.items():
            assert k.lower() not in bad_keys, f"{path}.{k}"
            _walk(v, f"{path}.{k}")
    elif isinstance(x, list):
        for i, e in enumerate(x):
            assert not (isinstance(e, list) and len(e) >= 2 and all(isinstance(c, (int, float)) for c in e)), f"pair array at {path}[{i}]"
            _walk(e, f"{path}[{i}]")


def test_context_json_walker_catches_coordinates():
    with pytest.raises(AssertionError):
        _walk({"areas": [{"geometry": 1}]})
    with pytest.raises(AssertionError):
        _walk({"a": [[-57.1, -24.2], [-57.2, -24.3]]})
    _walk({"areas": [{"m": [1, 2], "n": [1.5, 2.5], "frp": [3.0, 4.0], "departments": ["x"]}]})


def test_context_output_has_no_coordinates():
    areas = [{"id": "A", "geometry": _poly(0, 0, 2, 2)}]
    h = _hot([(0.5, 0.5, 1, 1.0, 1.0, "oriental", "d1"), (1.5, 1.5, 2, 3.0, 2.0, "oriental", "d1")])
    out = firms_pipeline.context_stats(h, areas, "paraguay")
    _walk(json.loads(json.dumps(out)))


def test_build_context_is_a_subcommand_and_needs_the_prepared_file(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(firms_pipeline.sys, "argv", ["firms_pipeline.py", "build-context", "--wdpa", str(tmp_path / "nope.geojson"),
                                                     "--data", str(tmp_path), "--out", str(tmp_path), "--country", "pry"])
    args = firms_pipeline.parse_args()
    assert args.country == "pry" and args.wdpa.endswith("nope.geojson")
    with pytest.raises(SystemExit) as e:
        firms_pipeline.cmd_build_context(args)
    assert "data/ext/README.md" in str(e.value)
    monkeypatch.setattr(firms_pipeline.sys, "argv", ["firms_pipeline.py", "build-context"])
    d = firms_pipeline.parse_args()
    assert d.wdpa == "data/raw/ext/derived/protected_areas.geojson" and d.out == "data/app" and d.country == "PRY"


def test_context_real_data():
    import pandas as pd
    cj = ROOT / "data" / "app" / "context.json"
    if not cj.exists():
        pytest.skip("data/app/context.json not present")
    assert cj.stat().st_size < 1_000_000
    text = cj.read_text(encoding="utf-8")
    assert "\ufffd" not in text          # no replacement characters from a bad decode
    assert "\u00d1uguazu" in text        # accents survive (the source had UTF-8 read as latin-1)
    assert "\u00c3" not in text and "\u00c2" not in text   # no mojibake left in any field (name, desig, desig_type, iucn)
    ctx = json.loads(text)
    _walk(ctx)
    meta = ctx["meta"]
    assert meta["source"].startswith("WDPA/WD-OECM") and "no WDPA geometry" in meta["terms"]
    assert meta["through"] >= "2026-01" and "UNEP-WCMC" in meta["citation"]
    assert len(meta["through_day"]) == 10 and meta["through_day"][:7] == meta["through"]
    assert meta["retrieved"] == "2026-11-14"
    names = {a["name"]: a for a in ctx["areas"]}
    assert "Defensores del Chaco" in names
    assert "chaco" in names["Defensores del Chaco"]["regions"]
    assert len({a["id"] for a in ctx["areas"]}) == len(ctx["areas"])
    for a in ctx["areas"]:
        assert set(a) >= {"id", "name", "desig", "iucn", "departments", "regions", "m", "n", "frp"}
        assert len(a["m"]) == len(a["n"]) == len(a["frp"]) and a["m"] == sorted(set(a["m"]))
        assert all(x > 0 or y > 0 for x, y in zip(a["n"], a["frp"]))
    assert {"paraguay", "chaco", "oriental"} <= set(ctx["zones"])
    first = ctx["zones"]["paraguay"]
    # months index m = grid.json months; 2003..2025 = m 6..281
    tot = sum(x for m, x in zip(first["m"], first["n"]) if 6 <= m <= 281)
    s = pd.read_csv(ROOT / "data" / "app" / "series_regions.csv")
    s = s[(s.area == "paraguay") & s.year.between(2003, 2025)]
    share = tot / s.harmonized.sum()
    assert 0.01 < share < 0.60
    for a in ctx["areas"]:   # no area exceeds the union
        assert sum(a["n"]) <= sum(first["n"]) + 1
    # by_zone: the area series inside one department / region; never more than the area, nor than that zone's union, per month
    for a in ctx["areas"]:
        assert isinstance(a["by_zone"], dict) and "paraguay" not in a["by_zone"]
        whole = dict(zip(a["m"], a["n"]))
        for z, s in a["by_zone"].items():
            assert z in ctx["zones"] and len(s["m"]) == len(s["n"]) == len(s["frp"])
            zone = dict(zip(ctx["zones"][z]["m"], ctx["zones"][z]["n"]))
            for m, n in zip(s["m"], s["n"]):
                assert n <= whole.get(m, 0) + 0.11 and n <= zone.get(m, 0) + 0.11


def test_fix_mojibake_repairs_utf8_read_as_latin1_and_keeps_clean_text():
    assert firms_pipeline._fix_mojibake("\u00c3\u0091uguazu") == "\u00d1uguazu"
    assert firms_pipeline._fix_mojibake("Bah\u00c3\u00ada de Asunci\u00c3\u00b3n") == "Bah\u00eda de Asunci\u00f3n"
    assert firms_pipeline._fix_mojibake("Defensores del Chaco") == "Defensores del Chaco"
    assert firms_pipeline._fix_mojibake("Cerro Cor\u00e1") == "Cerro Cor\u00e1"
    assert firms_pipeline._fix_mojibake(None) is None


# ----------------------------------------------------------------------------- anomaly agreement
def test_agreement_stat_without_enough_or_varying_months_has_no_statistic():
    import pandas as pd
    classes = lambda x: pd.cut(x, [-1, .5, 1.5, 3, 1e9], labels=False)
    ok = firms_pipeline.agreement_stat(pd.Series([0.4, 1.0, 2.0, 5.0]), pd.Series([0.5, 1.1, 2.2, 4.0]), classes)
    assert ok["spearman"] == 1.0 and ok["same_class_pct"] == 100.0 and ok["n"] == 4
    assert firms_pipeline.agreement_stat(pd.Series([1.0, 2.0]), pd.Series([1.0, 2.0]), classes) == {"spearman": None, "same_class_pct": None, "n": 2}
    flat = firms_pipeline.agreement_stat(pd.Series([1.0, 1.0, 1.0]), pd.Series([0.9, 1.0, 1.1]), classes)   # constant: Spearman is NaN
    assert flat == {"spearman": None, "same_class_pct": None, "n": 3}
    json.dumps(flat, allow_nan=False)
