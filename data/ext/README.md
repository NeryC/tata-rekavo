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
