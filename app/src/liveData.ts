// Live data store: the daily FIRMS files (current.json, current_hotspots.csv) are published to an object store
// (Cloudflare R2) instead of being committed to the repository. Layout of the store:
//   latest.json                         manifest, short cache: { generated, prefix: "daily/<stamp>/", countries: { PRY: "PRY/", ... } }
//   daily/<stamp>/<ISO3>/current.json   immutable, one folder per run (old runs expire by a lifecycle rule)
// The site's live.json ({ "base": "https://.../" } or { "base": null }) says where the store is.
// Any failure falls back to the files bundled with the site, so the app keeps working without the store.

export interface LiveManifest {
  generated: string;
  prefix: string;
  countries: Record<string, string>;
}

/** The manifest when it has the expected shape, else null (a broken upload must never break the app). */
export function validManifest(j: unknown): LiveManifest | null {
  if (!j || typeof j !== "object") return null;
  const m = j as Record<string, unknown>;
  if (typeof m.generated !== "string" || typeof m.prefix !== "string" || !/^daily\/[\w.-]+\/$/.test(m.prefix)) return null;
  if (!m.countries || typeof m.countries !== "object") return null;
  const countries: Record<string, string> = {};
  for (const [iso3, p] of Object.entries(m.countries as Record<string, unknown>)) {
    if (/^[A-Z]{3}$/.test(iso3) && typeof p === "string" && /^[A-Z]{3}\/$/.test(p)) countries[iso3] = p;
  }
  return { generated: m.generated, prefix: m.prefix, countries };
}

/** Base URL of the store from live.json, normalized to end in "/"; null when unset or not https. */
export function storeBase(j: unknown): string | null {
  const b = j && typeof j === "object" ? (j as Record<string, unknown>).base : null;
  if (typeof b !== "string" || !/^https:\/\/[^\s]+$/.test(b)) return null;
  return b.endsWith("/") ? b : b + "/";
}

/** URL of one of a country's live files, or null when the manifest does not carry that country. */
export function liveFileUrl(base: string, manifest: LiveManifest, iso3: string, file: string): string | null {
  const p = manifest.countries[iso3];
  return p ? `${base}${manifest.prefix}${p}${file}` : null;
}
