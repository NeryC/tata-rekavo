# External data

## pry_adm1.geojson

Paraguay first-level administrative boundaries (17 departments + Asuncion capital district, 18 units).

- Source: geoBoundaries gbOpen, PRY ADM1, `simplifiedGeometryGeoJSON` file, kept as downloaded.
- API: https://www.geoboundaries.org/api/current/gbOpen/PRY/ADM1/
- File: https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/PRY/ADM1/geoBoundaries-PRY-ADM1_simplified.geojson
- Retrieved: 2026-11-14
- License: Creative Commons Attribution 4.0 International (CC BY 4.0).
- Original source: Direccion General de Estadistica, Encuestas y Censos (DGEEC), Paraguay.
- Attribution: Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries.
  PLoS ONE 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866

Derived file: `data/app/departments.json`, built with `python firms_pipeline.py build-regions --out data/app`
(Asuncion merged into Central; coordinates rounded to 3 decimals; each 0.1-degree grid cell assigned to the
department containing its centre, with centres just outside the simplified outline going to the nearest department).

## protected_areas.geojson (private, not committed) and `data/app/context.json`

Protected areas of Paraguay from the WDPA / WD-OECM (November 2026 release, 137 polygons, all STATUS = Designated).

- Citation (required): UNEP-WCMC and IUCN (2026), Protected Planet: The World Database on Protected Areas (WDPA) and World Database on
  Other Effective Area-based Conservation Measures (WD-OECM) [Online], November 2026, Cambridge, UK: UNEP-WCMC and IUCN.
  Available at: www.protectedplanet.net.
- Terms: http://www.protectedplanet.net/terms (non-commercial use; no redistribution or sub-licensing of the data; materials may be
  published, including on-line, provided the data are not downloadable and the attribution is visible).
- Therefore the WDPA geometry is NOT in this repository or in the site: `data/raw/ext/` and `data/raw/ext/derived/` are gitignored.
  Only fire statistics per protected area (plus the area name, designation and IUCN category) are published, in `data/app/context.json`;
  it contains no geometry, coordinates, bounding boxes, centroids or cell fractions.

Preparation (once; the three WDPA shapefile parts `part0`, `part1`, `part2` unzipped in `data/raw/ext/`), mapshaper 0.6.102:

```
cd data/raw/ext
mkdir -p derived
npx --yes mapshaper@0.6.102 -i part0/*.shp part1/*.shp part2/*.shp combine-files encoding=latin1 -merge-layers name=pa \
  -filter "STATUS!='Proposed'" -filter-fields NAME,DESIG_ENG,DESIG_TYPE,IUCN_CAT,SITE_ID \
  -simplify 8% keep-shapes -o precision=0.001 format=geojson derived/protected_areas.geojson
```

(`encoding=latin1` because mapshaper 0.6.102 mis-decodes the UTF-8 DBF names; `build-context` undoes the latin1 reading.
The simplified polygons are only used locally to count hotspots; they are never published.)

Then, with the FIRMS archives in `data/raw` and `data/app/departments.json` / `current_hotspots.csv` up to date:

```
python firms_pipeline.py build-context --wdpa data/raw/ext/derived/protected_areas.geojson --data data/raw --out data/app --country PRY
```

Method: every hotspot (harmonized count weight and harmonized FRP weight, as in `build` / `build-frp`; 2026 months from
`current_hotspots.csv`, weight 1, observed FRP) is tested against each polygon (exact point-in-polygon, holes excluded) and counts in
every area that contains it. `zones` (country, regions, departments) total the union of the areas, each hotspot once.
Several designations overlap (Ramsar sites, UNESCO-MAB biosphere reserves over national parks), so the areas must not be summed.
An area lists a department / region when at least one 0.1-degree grid-cell centre of it lies inside the area or at least one hotspot
inside the area falls in it.
