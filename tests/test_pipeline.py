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
