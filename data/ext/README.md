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

## bol_adm1.geojson

Bolivia first-level administrative boundaries (9 departments).

- Source: geoBoundaries gbOpen, BOL ADM1, `simplifiedGeometryGeoJSON` file (the link returned by the API), kept as downloaded
  by `fetch_boundaries` (1,003,986 bytes; properties `shapeName`, `shapeISO`, `shapeID`, `shapeGroup`, `shapeType`).
- API: https://www.geoboundaries.org/api/current/gbOpen/BOL/ADM1/
- Retrieved: 2026-11-15
- License: Creative Commons Attribution 4.0 International (CC BY 4.0).
- Attribution: Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries.
  PLoS ONE 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866

Derived files, built with `python firms_pipeline.py build-regions --country BOL --out data/app/BOL`:

- `data/app/BOL/departments.json`: display names with accents (`Potosí`) and ASCII slugs as ids (`potosi`, `santa-cruz`) from the
  `departments` block of `countries.json`; coordinates rounded to 3 decimals; each 0.25-degree grid cell assigned to the department
  containing its centre, centres just outside the simplified outline going to the nearest department (every cell is assigned).
- `data/app/BOL/regions.json` (not from geoBoundaries: from `biomes_latam.npz`, below): the grid cells of each factor region (biome),
  used by the app for the region presets. A cell belongs to the biome of most of its 25 0.05-degree raster cells.

## ecu_adm1.geojson

Ecuador first-level administrative boundaries (24 provinces, Galápagos included in the file).

- Source: geoBoundaries gbOpen, ECU ADM1, `simplifiedGeometryGeoJSON` file (the link returned by the API), kept as downloaded
  by `fetch_boundaries` (410,945 bytes; properties `shapeName`, `shapeISO`, `shapeID`, `shapeGroup`, `shapeType`).
- API: https://www.geoboundaries.org/api/current/gbOpen/ECU/ADM1/
- Retrieved: 2026-11-15
- License: Creative Commons Attribution 4.0 International (CC BY 4.0).
- Attribution: Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries.
  PLoS ONE 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866

Derived files, built with `python firms_pipeline.py build-regions --country ECU --out data/app/ECU`: `departments.json` (23 mainland
provinces: Galápagos is left out through `departments.drop` in `countries.json`, the islands lie outside the grid; display names with
accents, ASCII slugs as ids; with `departments.mask_cells` every 0.1-degree grid cell that holds a cell of the country mask is assigned to
the province containing its centre, so provinces add up to the country when current.json brings hotspots to a cell the archives never saw)
and `regions.json` (from `biomes_latam.npz`: moist forests, dry forests, highlands, mangroves).

## per_adm1.geojson

Peru first-level administrative boundaries (26 features: 24 departments, El Callao and the Metropolitan Municipality of Lima).

- Source: geoBoundaries gbOpen, PER ADM1, `simplifiedGeometryGeoJSON` file (the link returned by the API), kept as downloaded
  by `fetch_boundaries` (326,575 bytes; properties `shapeName`, `shapeISO`, `shapeID`, `shapeGroup`, `shapeType`).
- API: https://www.geoboundaries.org/api/current/gbOpen/PER/ADM1/
- Retrieved: 2026-11-15
- License: Creative Commons Attribution 4.0 International (CC BY 4.0).
- Attribution: Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries.
  PLoS ONE 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866

Derived files, built with `python firms_pipeline.py build-regions --country PER --out data/app/PER`: `departments.json` (24 departments:
`El Callao` and `Municipalidad Metropolitana de Lima` are merged into `Lima` through `departments.merge` in `countries.json`; display names
with accents, ASCII slugs as ids, each 0.25-degree grid cell assigned to the department containing its centre, every cell assigned) and
`regions.json` (from `biomes_latam.npz`: moist forests, dry forests, highlands, coastal desert).

## ury_adm1.geojson

Uruguay first-level administrative boundaries (19 departments).

- Source: geoBoundaries gbOpen, URY ADM1, `simplifiedGeometryGeoJSON` file (the link returned by the API), kept as downloaded
  by `fetch_boundaries` (425,451 bytes; properties `shapeName`, `shapeISO`, `shapeID`, `shapeGroup`, `shapeType`).
- API: https://www.geoboundaries.org/api/current/gbOpen/URY/ADM1/
- Retrieved: 2026-11-15
- License: Creative Commons Attribution 4.0 International (CC BY 4.0).
- Attribution: Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries.
  PLoS ONE 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866

Derived files, built with `python firms_pipeline.py build-regions --country URY --out data/app/URY`: `departments.json` (display names
with accents, ASCII slugs as ids, each 0.1-degree grid cell assigned to the department containing its centre, every cell assigned) and
`regions.json` (from `biomes_latam.npz`: one region, the grassland biome, which covers the whole country).

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

## LandMark indigenous territories (private, not committed) and `data/app/**/indigenous.json`

Indigenous Peoples' and Local Community Lands and Territories, LandMark v202606 (polygon layer, 327,379 polygons worldwide; Web Mercator, EPSG:3857).

- Source: https://landmarkmap.org (download of "Indigenous Peoples' and Local Community Lands and Territories"), unzipped to
  `data/raw/ext/landmark/Indigenous_comm_lands_public_202606/` (`shp/LandMark_IP_LC_poly_public_v202606.shp` + `.dbf`, 1.8 GB each). Retrieved: 2026-11-15.
- License: CC BY-SA 4.0. LandMark Terms of Service (26 Aug 2024): content may be copied, adapted and distributed under CC BY-SA 4.0; use it responsibly,
  protecting the rights of Indigenous Peoples. `indigenous.json` is distributed under the same license.
- Citation (required): LandMark: The Global Platform of Indigenous and Community Lands (2026), Indigenous Peoples' and Local Community Lands and
  Territories, v202606, https://landmarkmap.org
- Only fire statistics per territory (plus the id, name, identity, category and ethnicity) are published. The polygons, bounding boxes and centroids are NOT
  in this repository or the site: `data/raw/ext/` and `data/raw/ext/derived/` are gitignored, and tests check that `indigenous.json` has no geometry key.
- Kept: `download = Yes` and `layer` in (`Indigenous Lands`, `Community Lands`): Paraguay 678, Bolivia 321, Peru 2,530, Ecuador 754 territories.
  Uruguay has none in LandMark, so it ships no file and the app asks for none.

Steps, per country (PRY, BOL, PER, ECU), with the FIRMS archives in `data/raw` (Paraguay) or `data/raw/<ISO3>` and `departments.json` / `current_hotspots.csv` up to date:

```
python firms_pipeline.py extract-landmark --country BOL
python firms_pipeline.py build-context --layer indigenous --country BOL --data data/raw/BOL --out data/app/BOL
```

`extract-landmark` streams the shapefile (the DBF is read record by record, then only the country's shapes), converts Web Mercator metres to lon/lat and
writes `data/raw/ext/derived/indigenous_<ISO3>.geojson` (id = `landmark_i`, name, identity, category, ethnicity = `ethncty_1`, data_src, data_ctrb). The DBF says
UTF-8 but some strings are latin-1: each string is decoded as UTF-8 when valid and as latin-1 otherwise. `build-context --layer indigenous` uses the same method
as protected areas (below) and writes `indigenous.json`; Paraguay's `context.json` is produced by the same code with `--layer protected` (the default) and is unchanged.
`meta.contributors` lists the distinct `data_ctrb` / `data_src` values of the country's territories. Size: Paraguay 0.39 MB, Bolivia 0.62 MB, Ecuador 0.25 MB, Peru 1.25 MB
(2,530 territories; about 0.25 MB gzipped).

## biomes_latam.npz

Biomes of Latin America on a 0.05-degree raster, used as the factor regions of every country whose `regions.kind` is
`"biome"` in `countries.json` (Paraguay keeps its Chaco / Oriental river split).

- Source: RESOLVE Ecoregions 2017, `Ecoregions2017.zip` (shapefile, 846 ecoregions in 14 biomes).
- URL: https://storage.googleapis.com/teow2016/Ecoregions2017.zip (linked from https://ecoregions.appspot.com/);
  149,248,653 bytes, MD5 5d568e0d7b25602a12bba18baf0b03ba (as published by the bucket, Last-Modified 2019-05-07).
- Retrieved: 2026-11-15
- License: Creative Commons Attribution 4.0 International (CC BY 4.0).
- Citation: Dinerstein, E., Olson, D., Joshi, A., Vynne, C., Burgess, N. D., Wikramanayake, E., et al. (2017).
  An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm. BioScience 67(6): 534-545.
  https://doi.org/10.1093/biosci/bix014

Preparation (the zip unzipped in `data/raw/ext/resolve/`, gitignored), mapshaper 0.6.102: clip to the Latin America box
(lon -118..-34, lat -56..33) and dissolve the ecoregions into biomes:

```
cd data/raw/ext/resolve
npx --yes mapshaper@0.6.102 -i Ecoregions2017.shp -clip bbox=-118,-56,-34,33 -dissolve BIOME_NUM copy-fields=BIOME_NAME \
  -o precision=0.0001 format=geojson derived/biomes_latam.geojson
cd ../../../..
python firms_pipeline.py build-biomes --geojson data/raw/ext/resolve/derived/biomes_latam.geojson --out data/ext/biomes_latam.npz
```

`build-biomes` gives each 0.05-degree cell (origin lat -56, lon -118; 1780 rows x 1680 columns) the biome whose polygon
contains the cell centre (matplotlib point-in-polygon, holes excluded; 0 = no ecoregion, i.e. sea and large lakes).
The file holds `codes` (uint8, row-major, row = floor((lat+56)/0.05), col = floor((lon+118)/0.05)), the grid
(`deg`, `lat0`, `lon0`, `rows`, `cols`) and the table `biome_code` -> `biome_name` (RESOLVE `BIOME_NUM` / `BIOME_NAME`).
Inside the box `BIOME_NUM` 11 holds only "Rock and Ice" (Patagonian ice fields, `BIOME_NAME` "N/A") and the South Georgia
tundra, so it is named "Tundra; Rock and Ice".

Use in the pipeline: a hotspot belongs to the biome of its raster cell; cells with code 0 (coast, lakes) take the nearest
biome cell. Factor region ids are slugs of the biome names (e.g. `tropical-subtropical-moist-broadleaf-forests`). A
biome-month in which S-NPP or the MODIS sensor of the ratio has fewer than 500 hotspots on clean overlap days uses the
country factor of that calendar month (`regions.min_hotspots`); the months that fell back are listed in `grid.json`
`meta.factor_fallback`.
