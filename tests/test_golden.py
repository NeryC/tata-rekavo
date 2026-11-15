"""Paraguay golden outputs: the pipeline commands are run end to end on the raw archives (data/raw, gitignored)
into a temporary directory and compared with tests/golden/pry_golden.json.

Slow (a few minutes): skipped by default, run with `pytest tests -m slow`.
Regenerate the golden file (only when an output change is intended): `python tests/test_golden.py --write`.
"""
import gzip
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "tests" / "golden" / "pry_golden.json"
RAW = ROOT / "data" / "raw"
EXT = ROOT / "data" / "ext"
COUNTRY_ARGS: list = []   # extra arguments passed to every command

# (subcommand, arguments) in dependency order: validate and build-regions read grid.json, build-season reads departments.json
COMMANDS = [
    ("build", ["--data", str(RAW)]),
    ("validate", ["--data", str(RAW)]),
    ("build-regions", ["--ext", str(EXT)]),
    ("build-season", ["--data", str(RAW)]),
    ("build-frp", ["--data", str(RAW)]),
    ("export-hotspots", ["--data", str(RAW)]),
]
SERIES_RTOL = 0.001   # 0.1 %
SERIES_ATOL = 0.1     # one rounding unit of the CSV


def sha(obj):
    """sha256 of bytes, or of the compact JSON of any other object."""
    if not isinstance(obj, bytes):
        obj = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(obj).hexdigest()


def without(d, *keys):
    return {k: v for k, v in d.items() if k not in keys}


def run_pipeline(out, extra=None):
    extra = COUNTRY_ARGS if extra is None else extra
    timings = {}
    for cmd, args in COMMANDS:
        t0 = time.time()
        subprocess.run([sys.executable, str(ROOT / "firms_pipeline.py"), cmd, *args, "--out", str(out), *extra],
                       cwd=ROOT, check=True, capture_output=True)
        timings[cmd] = round(time.time() - t0, 1)
    return timings


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def summarize(out):
    """Small, timestamp-free summary of every output (hashes + the key numbers)."""
    out = Path(out)
    s = {}
    sr = pd.read_csv(out / "series_regions.csv")
    s["series_regions"] = {
        "sha256": sha((out / "series_regions.csv").read_bytes()),
        "rows": int(len(sr)),
        "first": "%04d-%02d" % tuple(sr.iloc[0][["year", "month"]]),
        "areas": list(dict.fromkeys(sr.area)),
        "harmonized": {a: g.harmonized.tolist() for a, g in sr.groupby("area", sort=False)},
        "raw_sha256": sha(sr[["area", "year", "month", "modis_raw", "viirs_snpp_raw"]].to_csv(index=False).encode()),
    }
    m = load(out / "metrics.json")
    s["metrics"] = {k: m[k] for k in ["leave_one_year_out", "anomaly_class_agreement", "error_model"]}
    s["metrics"]["sha256_rest"] = sha(without(m, "leave_one_year_out", "anomaly_class_agreement", "error_model"))
    g = load(out / "grid.json")
    s["grid"] = {"cells_sha256": sha(g["cells"]), "n_cells": len(g["cells"]), "factors": g["meta"]["factors"],
                 "meta_sha256": sha(without(g["meta"], "generated")), "grid": g["meta"]["grid"], "months": g["meta"]["months"]}
    se = load(out / "season.json")
    s["season"] = {"areas_sha256": sha(se["areas"]), "areas": list(se["areas"]),
                   "meta_sha256": sha(without(se["meta"], "generated"))}
    fr = load(out / "frp.json")
    s["frp"] = {"cells_sha256": sha(fr["cells"]), "n_cells": len(fr["cells"]), "validation": fr["meta"]["validation"],
                "experimental": fr["meta"]["experimental"], "meta_sha256": sha(without(fr["meta"], "generated"))}
    de = load(out / "departments.json")
    s["departments"] = {"cells": {d["id"]: {"n": len(d["cells"]), "sha256": sha(d["cells"])} for d in de["departments"]},
                        "sha256": sha(de["departments"]), "meta_sha256": sha(without(de["meta"], "retrieved"))}
    s["files_sha256"] = {n: sha((out / n).read_bytes())
                         for n in ["gaps.json", "grid_monthly.csv", "burn_history.json", "mask.json", "hotspots/index.json"]}
    hs = hashlib.sha256()   # gzip headers carry a timestamp: hash the decompressed blocks
    for f in sorted((out / "hotspots").glob("*.csv.gz")):
        hs.update(f.name.encode())
        with gzip.open(f, "rb") as fh:
            hs.update(fh.read())
    s["files_sha256"]["hotspots/*.csv.gz"] = hs.hexdigest()
    return s


def _have_inputs():
    return bool(list(RAW.glob("modis_*_Paraguay.csv"))) and (EXT / "pry_adm1.geojson").exists()


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    if not _have_inputs():
        pytest.skip("raw Paraguay archives (data/raw) or data/ext/pry_adm1.geojson not present")
    out = tmp_path_factory.mktemp("golden_pry")
    timings = run_pipeline(out)
    print("timings (s):", timings)
    return summarize(out), load(GOLDEN)


pytestmark = pytest.mark.slow


def test_series_regions_within_tolerance(result):
    got, want = result[0]["series_regions"], result[1]["series_regions"]
    assert {k: got[k] for k in ["rows", "first", "areas", "raw_sha256"]} == {k: want[k] for k in ["rows", "first", "areas", "raw_sha256"]}
    for area, w in want["harmonized"].items():
        g = got["harmonized"][area]
        assert len(g) == len(w)
        bad = [(i, a, b) for i, (a, b) in enumerate(zip(g, w)) if abs(a - b) > max(SERIES_RTOL * abs(b), SERIES_ATOL)]
        assert not bad, (area, bad[:5])


def test_metrics_exact(result):
    got, want = result[0]["metrics"], result[1]["metrics"]
    assert got["leave_one_year_out"]["country"]["mdape_pct"] == want["leave_one_year_out"]["country"]["mdape_pct"]
    assert got == want


def test_grid_exact(result):
    got, want = result[0]["grid"], result[1]["grid"]
    assert got["factors"] == want["factors"]
    assert got == want


def test_season_exact(result):
    assert result[0]["season"] == result[1]["season"]


def test_frp_exact(result):
    assert result[0]["frp"] == result[1]["frp"]


def test_departments_exact(result):
    assert result[0]["departments"] == result[1]["departments"]


def test_other_outputs_exact(result):
    assert result[0]["files_sha256"] == result[1]["files_sha256"]


if __name__ == "__main__":
    if "--write" not in sys.argv:
        sys.exit("usage: python tests/test_golden.py --write   (regenerates tests/golden/pry_golden.json)")
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        timings = run_pipeline(d)
        summary = summarize(d)
    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    body = ",\n".join(f"{json.dumps(k)}:{json.dumps(v, separators=(',', ':'), ensure_ascii=False)}" for k, v in summary.items())
    with open(GOLDEN, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("{\n" + body + "\n}\n")
    print("wrote", GOLDEN, "timings (s):", timings)
