// Estimated burned surface (MapBiomas Fuego Paraguay), a product separate from the hotspots: hectares that
// burned in a year or month, never a number of fires. Pure helpers (no React, no @core) for `node --test`.

type Series = Record<string, number | null>;
export interface BurnedAreaFile {
  schema: 1; source: string; collection: string; license: string; citation: string; url: string; retrieved: string;
  spatial_resolution_m: number; unit: "ha"; method: string; first_year: number; last_year: number;
  /** "paraguay" and the department ids of departments.json */
  zones: Record<string, { annual: Series; monthly: Series }>;
}

const isSeries = (s: unknown): s is Series => !!s && typeof s === "object"
  && Object.values(s as object).every((v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0));

/** The file when it follows the contract (schema 1, hectares, non-negative values or null); null otherwise. */
export function validateBurnedArea(j: unknown): BurnedAreaFile | null {
  if (!j || typeof j !== "object") return null;
  const d = j as Partial<BurnedAreaFile>;
  if (d.schema !== 1 || d.unit !== "ha" || typeof d.source !== "string" || typeof d.license !== "string"
    || !Number.isInteger(d.first_year) || !Number.isInteger(d.last_year) || (d.first_year as number) > (d.last_year as number)
    || !d.zones || typeof d.zones !== "object" || !d.zones.paraguay) return null;
  for (const z of Object.values(d.zones)) if (!z || !isSeries(z.annual) || !isSeries(z.monthly)) return null;
  return d as BurnedAreaFile;
}

export type BurnedStatus = "ok" | "before" | "after" | "no-zone";
/** Hectares burned in a zone in a year and in one of its months. null = no data (outside the collection, an area
 *  the file does not cover, or a period without coverage); 0 = covered and nothing burned. */
export function burnedFigures(d: BurnedAreaFile, zone: string, year: number, month: number):
  { status: BurnedStatus; year: number | null; month: number | null } {
  const z = d.zones[zone];
  if (!z) return { status: "no-zone", year: null, month: null };
  if (year < d.first_year) return { status: "before", year: null, month: null };
  if (year > d.last_year) return { status: "after", year: null, month: null };
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return { status: "ok", year: z.annual[String(year)] ?? null, month: z.monthly[key] ?? null };
}
