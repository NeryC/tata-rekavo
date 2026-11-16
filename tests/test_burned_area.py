import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import burned_area as ba  # noqa: E402


def feature(dep_id, annual=None, monthly=None):
    props = {"id": dep_id}
    for y in ba.years():
        props[ba.prop(y)] = (annual or {}).get(y, 0.0)
        for m in range(1, 13):
            props[ba.prop(y, m)] = (monthly or {}).get((y, m), 0.0)
    return {"properties": props}


def test_country_is_the_sum_of_departments_and_areas_are_whole_hectares():
    feats = [feature("a", {2024: 100.4}, {(2024, 9): 100.4}), feature("b", {2024: 50.6}, {(2024, 8): 50.6})]
    doc = ba.to_json(feats, ["a", "b"], "2026-11-15")
    assert doc["zones"]["a"]["annual"]["2024"] == 100
    assert doc["zones"]["b"]["annual"]["2024"] == 51
    assert doc["zones"]["paraguay"]["annual"]["2024"] == 151
    assert doc["zones"]["paraguay"]["monthly"]["2024-09"] == 100
    assert doc["unit"] == "ha" and doc["license"] == "CC BY 4.0"
    assert doc["first_year"] == 1999 and doc["last_year"] == 2024


def test_zero_is_kept_and_a_missing_period_is_null_not_zero():
    feats = [feature("a"), feature("b")]
    del feats[1]["properties"][ba.prop(2010)]
    doc = ba.to_json(feats, ["a", "b"], "2026-11-15")
    assert doc["zones"]["a"]["annual"]["2010"] == 0
    assert doc["zones"]["b"]["annual"]["2010"] is None
    assert doc["zones"]["paraguay"]["annual"]["2010"] is None  # not a partial sum


def test_years_after_the_collection_are_not_in_the_file():
    doc = ba.to_json([feature("a")], ["a"], "2026-11-15")
    assert "2025" not in doc["zones"]["a"]["annual"]
    assert "2025-01" not in doc["zones"]["a"]["monthly"]


def test_a_department_missing_from_the_export_is_an_error():
    with pytest.raises(ValueError, match="b"):
        ba.to_json([feature("a")], ["a", "b"], "2026-11-15")


def test_check_accepts_months_adding_up_to_the_year_and_rejects_double_counting():
    ok = ba.to_json([feature("a", {2024: 300}, {(2024, 8): 100, (2024, 9): 200})], ["a"], "x")
    ba.check(ok)
    bad = ba.to_json([feature("a", {2024: 300}, {(2024, 8): 300, (2024, 9): 200})], ["a"], "x")
    with pytest.raises(ValueError, match="sum of its months"):
        ba.check(bad)


def test_pearson():
    assert ba.pearson([1, 2, 3], [2, 4, 6]) == pytest.approx(1.0)
    assert ba.pearson([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)


def test_grouped_rows_become_one_feature_per_department_with_years_as_the_sum_of_months():
    rows = [
        {"properties": {"id": "a", "year": 2024, "m09": 200.0, "m08": 100.0}},
        {"properties": {"id": "a", "year": 2023}},
        {"properties": {"id": "b", "year": 2024, "m01": 5.0}},
    ]
    feats = {f["properties"]["id"]: f["properties"] for f in ba.rows_to_features(rows)}
    assert feats["a"][ba.prop(2024)] == 300.0
    assert feats["a"][ba.prop(2024, 9)] == 200.0
    assert feats["a"][ba.prop(2024, 1)] == 0.0  # the year is covered: a month without burned pixels is 0
    assert feats["a"][ba.prop(2023)] == 0.0
    assert ba.prop(2022) not in feats["a"]  # a year missing from the export stays missing (null later), not 0
    assert feats["b"][ba.prop(2024, 1)] == 5.0
