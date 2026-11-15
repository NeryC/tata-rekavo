// Writes data/app/countries.json, the index of the countries the app can show, from countries.json (repository root).
// Paraguay stays at the site root (path ""), every other country is served from data/app/<ISO3>/ (path "<ISO3>/").
// Only countries whose data folder holds a grid.json are listed. Usage: node countries_index.mjs [data/app]
// test_contract.mjs checks that the written file is in sync with countries.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_ISO3 = "PRY";
// display extras the pipeline config does not carry: Spanish name (when it differs), time zone of the "updated" line,
// the example point of the coordinates form, and pilot (country median error above the 15 % gate: tagged in the selector)
const EXTRA = {
  PRY: { tz: "America/Asuncion", tzCity: "Asunción", example: [-22.35, -60.03] },
  BOL: { tz: "America/La_Paz", tzCity: "La Paz", example: [-16.37, -60.96] },
  ECU: { tz: "America/Guayaquil", tzCity: "Guayaquil", example: [-0.9, -77.8], pilot: true },
  PER: { nameEs: "Perú", tz: "America/Lima", tzCity: "Lima", example: [-9.0, -74.5] },
  URY: { tz: "America/Montevideo", tzCity: "Montevideo", example: [-31.7, -55.98], pilot: true },
};

export function countryPath(iso3) {
  return iso3 === DEFAULT_ISO3 ? "" : `${iso3}/`;
}

export function buildIndex(config, dataDir) {
  const countries = [];
  for (const [iso3, c] of Object.entries(config)) {
    const path = countryPath(iso3);
    if (!existsSync(join(dataDir, path, "grid.json"))) continue;
    const x = EXTRA[iso3] ?? {};
    countries.push({
      iso3, path, area: c.area, name: { en: c.name, es: x.nameEs ?? c.name }, bbox: c.bbox,
      ...(x.tz ? { tz: x.tz, tzCity: x.tzCity } : {}), ...(x.example ? { example: x.example } : {}), ...(x.pilot ? { pilot: true } : {}),
      // optional files the country ships, so the app never asks for one it does not have
      files: {
        burnHistory: existsSync(join(dataDir, path, "burn_history.json")),
        hotspotArchive: existsSync(join(dataDir, path, "hotspots", "index.json")),
        context: existsSync(join(dataDir, path, "context.json")),
        indigenous: existsSync(join(dataDir, path, "indigenous.json")),
      },
    });
  }
  countries.sort((a, b) => (a.iso3 === DEFAULT_ISO3 ? -1 : b.iso3 === DEFAULT_ISO3 ? 1 : a.iso3.localeCompare(b.iso3)));
  return { default: DEFAULT_ISO3, countries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.argv[2] || "data/app";
  const config = JSON.parse(readFileSync("countries.json", "utf8"));
  const index = buildIndex(config, dataDir);
  writeFileSync(join(dataDir, "countries.json"), JSON.stringify(index, null, 1) + "\n");
  console.log(`${join(dataDir, "countries.json")}: ${index.countries.map((c) => c.iso3).join(", ")}`);
}
