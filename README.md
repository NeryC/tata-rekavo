# Tata Rekavo — harmonized MODIS + VIIRS fire record for Paraguay

**NASA Space Apps Challenge 2026 · Asunción · Challenge: _Harmonization of MODIS and VIIRS Hot Spots_**

**Live app: https://tata-rekavo.vercel.app** (English / Español)

*Tata Rekavo* means "fire tracker" in Guaraní.

Satellites have counted fire hotspots over Paraguay since 2000, but the record is split in two: MODIS (Terra, Aqua) since 2000 and VIIRS (Suomi NPP, NOAA-20) since 2012. VIIRS has a finer pixel (375 m vs 1 km) and detects about **3.4 times more hotspots** over Paraguay. Stitching the raw records together makes burning appear to jump **×2.8 after 2012**, and that jump comes from the change of sensor, not from more fire. This repository turns both records into **one consistent monthly series in a single unit: VIIRS S-NPP-equivalent hotspots**, validated against real VIIRS observations, with a measured error for every value.

![validation](data/app/validation.png)

## Method

1. **Data.** NASA FIRMS yearly country archives for Paraguay, standard processing: MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20). Vegetation fires only (`type = 0`). 3,982,768 hotspots, Nov 2000 – Dec 2025.
2. **Common unit.** We translate MODIS **toward** VIIRS, not the other way around. VIIRS is the operational sensor and the finer one, so current months are read as observed.
3. **Calibration.** For each region (Chaco / Oriental) and calendar month:
   `f(region, month) = VIIRS S-NPP hotspots ÷ MODIS Aqua hotspots`, over the overlap Feb 2012 – Dec 2025.
   - **Aqua, not Terra + Aqua.** Aqua crosses at ~13:30 like S-NPP. The Terra/Aqua mix changes over time (Aqua/Terra fell from 2.5 in 2003 to ~1.5 after 2011). Aqua-based factors extrapolate back in time with near-zero bias.
   - **Region × month.** The factor ranges from ~4.4 in the dry-season peak (large fires seen by both sensors) to ~9 in the wet season (small fires that only VIIRS resolves). A single factor leaves +12 % / −14 % regional biases.
4. **Reconstruction.** Before Feb 2012: Aqua hotspots × f. From Feb 2012: VIIRS S-NPP observed. The record starts in **Jul 2002**, the first full month with Aqua.
5. **Sensor outages.** Days where one sensor delivered nothing while its twin saw fire are excluded from calibration and filled with the twin sensor:
   - S-NPP gaps are filled with NOAA-20 (S-NPP/NOAA-20 monthly ratio: median 1.02).
   - Aqua gaps are filled with Terra × its own factor.

   41 S-NPP outage days and 50 Aqua outage days were detected, e.g. 27 Jul – 5 Aug 2022, in the middle of the fire season. Every filled day is listed in `gaps.json`.
6. **Uncertainty.** For translated months, the median relative error depends on how many hotspots a zone has. It was fitted on held-out data across all aggregation levels:
   `rel(n) = 1.252 · n^-0.334` (n = harmonized hotspots in the zone-month).
   A systematic term (0–11 % by year, from comparing Aqua-based and Terra+Aqua-based reconstructions) is added in quadrature. Observed VIIRS months carry no translation error.
7. **Verdict.** Value ÷ median of the same calendar month in previous years:
   - below normal < 0.5
   - normal 0.5–1.5
   - high 1.5–3
   - extreme > 3

   For a month still in progress, the median is scaled to the elapsed share of the month.

## Validation

**Leave-one-year-out.** Calibrate on 13 years, predict the held-out year from MODIS Aqua, and compare with VIIRS S-NPP:

| Level | Median error | 90th pct error | Bias |
|---|---|---|---|
| Paraguay × month | 7.0 % | 19.1 % | 0.0 % |
| Chaco × month | 6.7 % | 21.4 % | 0.0 % |
| Oriental × month | 9.8 % | 28.7 % | 0.0 % |
| 1° block (~110 km) × month | 19.6 % | 52.9 % | 0.0 % |
| 0.5° cell (~55 km) × month | 25.6 % | 69.6 % | 0.0 % |
| 0.25° cell (~28 km) × month | 32.8 % | 84.1 % | 0.0 % |
| 0.1° cell (~11 km) × month | 46.7 % | 100 % | 0.0 % |

**Back-extrapolation.** Calibrate on 2019–2025 and predict 2012–2018. Yearly bias: +1.2, 0.0, −0.3, −3.2, +5.9, +0.2, +2.4 %.

**Does the verdict class match the one VIIRS would give?** Paraguay 95 %, Chaco 91 %, Oriental 86 %, 1° blocks 76 % of months.

**Effect.** Mean 2013–2025 vs mean 2003–2011: naive record ×2.78, harmonized ×0.76. MODIS alone, with no sensor change, gives ×0.82.

The approach follows the same principle used in the literature to bridge the MODIS → VIIRS transition: regional statistical calibration over the overlap period.
- NASA VIIRS burned area product (VNP64A1), *Remote Sensing of Environment* — anticipates the need for regional-scale statistical calibration between VIIRS and MODIS to provide a single long-term record: https://geog.umd.edu/sites/geog.umd.edu/files/pubs/1-s2.0-S0034425725004109-main.pdf
- GFED5NRT (Chen et al., 2026, *Earth System Science Data*) — region- and biome-specific lookup tables to keep VIIRS consistent with the MODIS-era record: https://essd.copernicus.org/articles/18/7535/2026/
- Boschetti, *Harmonization of the NASA MODIS and VIIRS fire product record*, MODIS Science Team Meeting 2023: https://modis.gsfc.nasa.gov/sci_team/meetings/202305/presentations/boschetti.pdf

## Data products (`data/app/`)

| File | Content |
|---|---|
| `grid.json` | Harmonized record on a 0.1° grid, monthly, Jul 2002 – Dec 2025 (3,632 cells, 305k cell-months, ~1 MB gzipped). Includes factors, error model and validation in `meta` |
| `current.json` | 2026 months from the FIRMS Area API, clipped to Paraguay. For each day it uses the best VIIRS product available: S-NPP first, NOAA-20 / NOAA-21 when S-NPP has no data, standard processing before near-real-time. Includes per-month coverage and the products used |
| `current_hotspots.csv` | The 2026 hotspots themselves |
| `burn_history.json` | ~1 km rasters: last year each cell burned, and number of years it burned (2002–2025) |
| `series_regions.csv` | Monthly harmonized / raw MODIS / raw VIIRS for Paraguay, Chaco, Oriental |
| `grid_monthly.csv` | Same as `grid.json` in long CSV form |
| `hotspots/*.csv.gz` | Individual hotspots Jul 2002 – Dec 2025, one gzip CSV per 1° block (~46 MB in total), with `harmonized_weight`, plus `index.json` |
| `gaps.json` | Detected sensor outages and the days filled |
| `mask.json` | ~5 km country mask (cells with any hotspot in the Paraguay archives), used to clip API data |
| `metrics.json` | Full validation results |
| `validation.png` | Naive vs harmonized record + hold-out validation |

`grid.json` cell entry: `[cell_index, month_indices[], harmonized[], modis_raw_terra_aqua[], viirs_snpp_raw[]]`, with
`cell_index = row * 88 + col`, `row = floor((lat + 28) / 0.1)`, `col = floor((lon + 63) / 0.1)`, `m = (year − 2002)·12 + (month − 7)`.

`harmonized.js` implements everything the web app needs, with no dependencies:
- `decodeGrid`, `cellsInPolygon`, `zoneSeries`
- `verdict`, `monthCoverage`, `calendar`, `relativeError`
- `decodeBurnHistory`, `seriesToCSV`

`test_contract.mjs` checks it against the pipeline output.

## Web app (`app/`)

**Is this fire normal?** Pick an area, a month and a date range:

- **Area:** Paraguay, the Chaco, the Oriental region, any polygon drawn on the map, or a point (latitude / longitude) with a radius.
- **Verdict:** the selected month against the median of the same month in previous years, with its error band. A month still in progress is compared with the same share of a typical month.
- **Date range analytics:** total hotspots (± error), ratio to the usual for those months, peak month, months above or below normal, and hotspots in new places. Presets: this year, last 12 months, fire season (Jul–Oct), all.
- **Burning calendar:** years × months, in two modes.
  - *vs normal* (diverging, ratio to the usual level).
  - *Hotspots* (sequential counts, with a "typical year" row that shows when the fire season happens).

  Months reconstructed from MODIS are hatched. The tooltip includes a field-validation hint ("Modo Catador") that turns the model uncertainty into guidance for checking imagery.
- **Hotspots per year:** a toggle between the harmonized record and the raw sensors stitched together, which shows the false 2012 jump.
- **Map:** hotspots per ~11 km cell for the month, plus the individual VIIRS hotspots for 2026.
- **Fire in new places:** 2026 hotspots with no hotspot from any sensor within ~1 km (same or neighbouring 0.01° cell) from July 2002 to December 2025. That is about 2% of them. They are highlighted on the map and flagged in the CSV (`new_place`). Comparing exact cells instead would flag ~10%, which mostly reflects pixel geolocation offsets, so the neighbourhood is required. Hotspots right at the border may be over-flagged, because the history only covers Paraguay.
- **Downloads for the area and date range:**
  - The monthly harmonized series (CSV).
  - Every individual hotspot (CSV: 2002–2025 from the archives plus 2026 from the API, with `harmonized_weight` and `new_place`). The app fetches only the 1° blocks the search touches (`data/app/hotspots/`).
  - A PNG report with the calendar, the yearly chart and the analytics.
- **English / Spanish** interface (EN/ES toggle; it follows the browser language by default).

Stack: React + TypeScript + Vite + MapLibre GL. It is a static site with no backend. It reads `data/app/` and uses the same `harmonized.js` the pipeline tests run against.

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in app/dist (deploy app/ on Vercel or any static host)
```

## Run it

```bash
pip install -r requirements.txt
python firms_pipeline.py download                    # ~300 MB of FIRMS archives into data/raw (resumable)
python firms_pipeline.py build                       # data/app/*.json, *.csv
python firms_pipeline.py validate                    # metrics.json, validation.png, error model into grid.json
python firms_pipeline.py export-hotspots             # data/app/hotspots: individual hotspots in 1-degree gzip blocks
FIRMS_MAP_KEY=... python firms_pipeline.py fetch-current --start 2026-01-01   # free key: https://firms.modaps.eosdis.nasa.gov/api/map_key/
node test_contract.mjs data/app
```

Never commit the MAP_KEY. Pass it through the environment only.

## Limitations

- **2002–2011 cannot be checked directly**, because there is no VIIRS for those years. The closest evidence is the back-extrapolation test above.
- **Factors are specific to Paraguay.** The method transfers to other regions, but the factors must be recomputed there.
- **The Chaco / Oriental split is approximate.** It uses a polyline that follows the Paraguay River, not an official boundary.
- **Small zones are noisy.** A single ~11 km cell has ~47 % median error in translated months. The app shows the error band and should favour zones of tens of cells or more.
- **A hotspot is not a fire.** It is a ~375 m–1 km pixel that contains at least one active fire at overpass time. Cloud cover and fires that start and end between overpasses are missed by both sensors.
- **2026 data is partly near-real-time.** It comes from the FIRMS API, and its NRT portion is later replaced by standard processing.
- **S-NPP stopped delivering.** On 14 Nov 2026, FIRMS listed VIIRS S-NPP near-real-time data only up to 2 Nov 2026, while NOAA-20 and NOAA-21 continued. From 3 Nov the record uses NOAA-20, which over 2018–2025 detected almost the same as S-NPP (monthly S-NPP/NOAA-20 median 1.02, 5th–95th percentile 0.86–1.09). This is the same kind of sensor transition the project is built to absorb.

## NASA data

- NASA FIRMS — Fire Information for Resource Management System: https://www.earthdata.nasa.gov/data/tools/firms
- FIRMS country archives and Area API: https://firms.modaps.eosdis.nasa.gov/
- MODIS Collection 6.1 Active Fire (Terra MOD14, Aqua MYD14) and VIIRS 375 m Active Fire (S-NPP VNP14IMG, NOAA-20 VJ114IMG) as distributed by FIRMS.

## Use of AI

The data pipeline, the validation analysis, the reference client module, the figures and parts of this README were produced with the assistance of an AI tool (a large language model) and reviewed by the team. AI-assisted figures carry a note in their caption. No NASA logos or branding are used.

## Team

Tata Rekavo — Jesús Emanuel Fernández Sosa, Mario Salvador Maldonado Cañete, Nery Alberto Cano Ortigoza.
