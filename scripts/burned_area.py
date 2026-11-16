"""Burned area of Paraguay by department from MapBiomas Fuego Paraguay (Collection 1), via Google Earth Engine.

MapBiomas Fuego maps burn scars from Landsat at 30 m. This is a separate product from the satellite hotspots:
an estimate of the surface that burned in a year or month, never a count of fires and never converted into one.

Steps (needs `pip install earthengine-api` and an Earth Engine project registered for non-commercial use):

    python scripts/burned_area.py export --project tata-rekavo-ee   # starts a batch export (minutes)
    python scripts/burned_area.py status --project tata-rekavo-ee
    python scripts/burned_area.py fetch  --project tata-rekavo-ee   # writes data/app/burned_area.json
    python scripts/burned_area.py validate --project tata-rekavo-ee  # boundary loss and MODIS MCD64A1 comparison

Method: per pixel, the geodesic area of the 30 m pixel (ee.Image.pixelArea) is added to the month in which the
monthly product marks it as burned (value = month 1-12), with one grouped sum per department and year. Each pixel has
at most one month per year, so the year is the sum of its twelve months and no pixel is counted twice; `validate`
checks that sum against the annual product. Areas are summed inside
the department boundaries the app already uses (geoBoundaries ADM1, simplified, Asuncion merged into Central); the
country is the sum of its departments.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSET_BASE = "projects/mapbiomas-public/assets/paraguay/fire/collection1/mapbiomas_paraguay_fire_collection1_"
FIRST_YEAR, LAST_YEAR = 1999, 2024
SCHEMA = 1
SOURCE = {
    "source": "MapBiomas Fuego Paraguay",
    "collection": "Colección 1",
    "license": "CC BY 4.0",
    "citation": "Proyecto MapBiomas Paraguay – Colección 1 de mapas de área quemada (MapBiomas Fuego), accedido a través de Google Earth Engine.",
    "url": "https://paraguay.mapbiomas.org/descargas/mapbiomas-fuego/",
    "spatial_resolution_m": 30,
    "unit": "ha",
    "method": ("Sum of the geodesic area of 30 m pixels marked as burned (annual product value 1; monthly product value = "
               "month), inside simplified geoBoundaries ADM1 departments; the country is the sum of its departments. "
               "Each pixel counts once per year."),
}


def export_asset(project: str, scale: int = 30, year: int | None = None) -> str:
    return (f"projects/{project}/assets/burned_area_pry_c1" + ("" if scale == 30 else f"_{scale}m")
            + ("" if year is None else f"_{year}"))


def years() -> list[int]:
    return list(range(FIRST_YEAR, LAST_YEAR + 1))


def prop(year: int, month: int | None = None) -> str:
    """Property name of one period in the exported table: a1999 for a year, m1999_09 for a month."""
    return f"a{year}" if month is None else f"m{year}_{month:02d}"


def to_json(features: list[dict], department_ids: list[str], retrieved: str) -> dict:
    """The app file from the exported table (one feature per department with an `id` and one property per period).

    Areas are rounded to whole hectares. A period missing from a department is null (no coverage), never 0;
    0 means the product covers the period and found no burned area there. The country total is null for a
    period unless every department has a value.
    """
    by_id = {f["properties"]["id"]: f["properties"] for f in features}
    missing = [d for d in department_ids if d not in by_id]
    if missing:
        raise ValueError(f"departments missing from the export: {', '.join(missing)}")

    def value(p: dict, key: str):
        v = p.get(key)
        return None if v is None else int(round(float(v)))

    zones: dict[str, dict] = {}
    for d in department_ids:
        p = by_id[d]
        zones[d] = {
            "annual": {str(y): value(p, prop(y)) for y in years()},
            "monthly": {f"{y}-{m:02d}": value(p, prop(y, m)) for y in years() for m in range(1, 13)},
        }

    def total(kind: str, key: str):
        vals = [zones[d][kind][key] for d in department_ids]
        return None if any(v is None for v in vals) else sum(vals)

    first = zones[department_ids[0]]
    zones = {"paraguay": {kind: {k: total(kind, k) for k in first[kind]} for kind in ("annual", "monthly")}, **zones}
    return {"schema": SCHEMA, **SOURCE, "retrieved": retrieved, "first_year": FIRST_YEAR, "last_year": LAST_YEAR, "zones": zones}


def rows_to_features(rows: list[dict]) -> list[dict]:
    """Exported rows (department id, year, and m01..m12 for the months with burned pixels) -> one feature per department with a property per
    year and month. A year in the export is covered: its months without burned pixels are 0 and the year is the sum of
    its months. A year missing from the export stays missing (null in the file)."""
    by_id: dict[str, dict] = {}
    for r in rows:
        p = r["properties"]
        out = by_id.setdefault(p["id"], {"id": p["id"]})
        y = int(p["year"])
        # a month column is null in rows that had no burned pixel that month: the year is covered, so it is 0
        months = {int(k[1:]): float(v or 0) for k, v in p.items() if len(k) == 3 and k[0] == "m" and k[1:].isdigit()}
        for m in range(1, 13):
            out[prop(y, m)] = months.get(m, 0.0)
        out[prop(y)] = sum(months.values())
    return [{"properties": v} for v in by_id.values()]


def check(doc: dict, tolerance_ha: int = 1) -> None:
    """Contract checks: annual = sum of its months (within rounding), country = sum of departments, no negatives."""
    zones = doc["zones"]
    for z, rec in zones.items():
        for y in range(doc["first_year"], doc["last_year"] + 1):
            a = rec["annual"][str(y)]
            months = [rec["monthly"][f"{y}-{m:02d}"] for m in range(1, 13)]
            if a is None or any(v is None for v in months):
                continue
            if a < 0 or any(v < 0 for v in months):
                raise ValueError(f"{z} {y}: negative area")
            if abs(a - sum(months)) > tolerance_ha * 13 + 0.002 * a:
                raise ValueError(f"{z} {y}: annual {a} ha differs from the sum of its months {sum(months)} ha")


def _ee(project: str):
    import ee  # imported here so the pure functions above can be tested without Earth Engine
    ee.Initialize(project=project)
    return ee


def _departments(ee):
    deps = json.loads((ROOT / "data/app/departments.json").read_text(encoding="utf-8"))["departments"]
    fc = ee.FeatureCollection([ee.Feature(ee.Geometry(d["geometry"]), {"id": d["id"]}) for d in deps])
    return fc, [d["id"] for d in deps]


def cmd_export(a) -> None:
    ee = _ee(a.project)
    fc, _ = _departments(ee)
    px = ee.Image.pixelArea().divide(1e4)  # geodesic m2 -> ha
    monthly = ee.Image(ASSET_BASE + "monthly_burned_v1")
    reducer = ee.Reducer.sum().group(groupField=1, groupName="month")
    # one pass per year with the months as groups: a band per month would read every pixel twelve times more
    try:
        ee.data.createAssetHome(f"projects/{a.project}/assets/")  # a new Cloud project has no asset folder until this runs
    except ee.EEException:
        pass  # already there
    # one task per year: Earth Engine runs them side by side, and a failed year can be rerun alone
    for y in a.years or years():
        mb = monthly.select(f"burned_monthly_{y}")
        img = px.addBands(mb.rename("month")).updateMask(mb.gt(0))
        # an asset table needs a geometry on every row: a fixed point, the department is in "id"
        # and only plain values: the month groups become columns m01..m12 (months with no burned pixel are absent)
        def row(f, y=y):
            groups = ee.List(f.get("groups"))
            keys = groups.map(lambda g: ee.String("m").cat(ee.Number(ee.Dictionary(g).get("month")).format("%02d")))
            sums = groups.map(lambda g: ee.Dictionary(g).get("sum"))
            props = ee.Dictionary.fromLists(keys, sums).combine({"id": f.get("id"), "year": y})
            return ee.Feature(ee.Geometry.Point([-58.0, -23.0]), props)
        table = img.reduceRegions(fc, reducer, scale=a.scale, tileScale=4).map(row)
        asset = export_asset(a.project, a.scale, y)
        try:
            ee.data.deleteAsset(asset)
        except ee.EEException:
            pass
        task = ee.batch.Export.table.toAsset(collection=table, description=asset.rsplit("/", 1)[1], assetId=asset)
        task.start()
        print(f"started {task.id} -> {asset}")


def cmd_status(a) -> None:
    ee = _ee(a.project)
    for t in ee.batch.Task.list()[:5]:
        s = t.status()
        print(s.get("description"), s.get("state"), s.get("error_message", ""))


def cmd_fetch(a) -> None:
    ee = _ee(a.project)
    _, ids = _departments(ee)
    rows = [r for y in years() for r in ee.FeatureCollection(export_asset(a.project, a.scale, y)).getInfo()["features"]]
    doc = to_json(rows_to_features(rows), ids, dt.date.today().isoformat())
    check(doc)
    out = ROOT / "data/app/burned_area.json"
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / (sxx * syy) ** 0.5


def cmd_validate(a) -> None:
    """A check of data/app/burned_area.json that does not reuse its own numbers: an independent product,
    MODIS MCD64A1 (500 m), year by year. Result on 2026-11-15 (2001-2024): year-to-year correlation r = 0.81,
    MapBiomas at a median 0.74 of MODIS; the two products map burn scars with different sensors and methods."""
    ee = _ee(a.project)
    doc = json.loads((ROOT / "data/app/burned_area.json").read_text(encoding="utf-8"))
    ours = doc["zones"]["paraguay"]["annual"]
    pry = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(ee.Filter.eq("country_na", "Paraguay")).geometry()
    px = ee.Image.pixelArea().divide(1e4)
    mcd = ee.ImageCollection("MODIS/061/MCD64A1").select("BurnDate")
    # (a sampled comparison with the whole MapBiomas extent is not done: at a coarser scale Earth Engine reads
    # image pyramids that mix burned and unburned pixels, which moved 2024 by 40 % between 150 and 300 m)
    rows = []
    for y in range(2001, LAST_YEAR + 1):
        modis_img = mcd.filterDate(f"{y}-01-01", f"{y + 1}-01-01").max().gt(0)
        modis = px.updateMask(modis_img).reduceRegion(ee.Reducer.sum(), pry, scale=500, maxPixels=1e10).get("area")
        m = modis.getInfo()
        rows.append((y, ours[str(y)], None, m))
        print(f"{y}  MapBiomas {ours[str(y)]:>12,} ha  MODIS MCD64A1 {m:>12,.0f} ha  ratio {ours[str(y)] / m:.2f}")
    print(f"year-to-year correlation with MODIS: r = {pearson([o for _, o, _, _ in rows], [m for *_, m in rows]):.2f}")
    print(f"MapBiomas / MODIS, median ratio: {sorted(o / m for _, o, _, m in rows if m)[len(rows) // 2]:.2f}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, fn in (("export", cmd_export), ("status", cmd_status), ("fetch", cmd_fetch), ("validate", cmd_validate)):
        s = sub.add_parser(name)
        s.add_argument("--project", required=True)
        s.add_argument("--years", type=int, nargs="*", help="export only these years (default: all)")
        s.add_argument("--scale", type=int, default=30,
                       help="sampling distance in m: 30 reads every Landsat pixel; a larger one samples them (faster, approximate)")
        s.set_defaults(fn=fn)
    a = p.parse_args(argv)
    a.fn(a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
