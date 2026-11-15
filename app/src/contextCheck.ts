import type { ContextFile } from "@core";

const MONTH = /^[0-9]{4}-[0-9]{2}$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** {m, n, frp}: three arrays of the same length holding finite numbers. */
function isSeries(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const s = x as { m?: unknown; n?: unknown; frp?: unknown };
  if (!Array.isArray(s.m) || !Array.isArray(s.n) || !Array.isArray(s.frp)) return false;
  return s.m.length === s.n.length && s.m.length === s.frp.length
    && s.m.every((v) => Number.isInteger(v) && v >= 0) && s.n.every(isNum) && s.frp.every(isNum);
}

/**
 * context.json -> ContextFile, or null when it is not what the app reads (wrong shape, formats, or arrays of different lengths).
 * Everything the app indexes into is checked, so a bad file hides the block instead of breaking the page.
 */
export function validateContext(j: unknown): ContextFile | null {
  if (!j || typeof j !== "object") return null;
  const c = j as { meta?: Record<string, unknown>; areas?: unknown; zones?: unknown };
  const meta = c.meta;
  if (!meta || !isStr(meta.through) || !MONTH.test(meta.through) || !isStr(meta.first) || !MONTH.test(meta.first)) return null;
  if (!isStr(meta.citation) || !isStr(meta.source) || !isStr(meta.generated)) return null;
  if (!isStr(meta.retrieved) || !DAY.test(meta.retrieved)) return null;
  if (meta.through_day !== undefined && !(isStr(meta.through_day) && DAY.test(meta.through_day))) return null;
  if (!Array.isArray(c.areas) || !c.zones || typeof c.zones !== "object" || Array.isArray(c.zones)) return null;
  for (const a of c.areas as Record<string, unknown>[]) {
    if (!a || !isStr(a.id) || !isStr(a.name)) return null;
    if (!Array.isArray(a.departments) || !a.departments.every(isStr) || !Array.isArray(a.regions) || !a.regions.every(isStr)) return null;
    if (!isSeries(a)) return null;
    const bz = a.by_zone;
    if (!bz || typeof bz !== "object" || Array.isArray(bz) || !Object.values(bz).every(isSeries)) return null;
  }
  if (!Object.values(c.zones as Record<string, unknown>).every(isSeries)) return null;
  return j as ContextFile;
}

/**
 * true when the figures of the context's last month are older than the data the app shows for it: the daily workflow refreshes
 * current.json but cannot rebuild context.json (it needs the private WDPA geometry), so the last month's figures can lag.
 * - with meta.through_day: stale when a hotspot is dated after it (lastHotspotDate = latest date in current_hotspots.csv);
 * - older files without it: stale when context.json was generated before current.json.
 */
export function isContextStale(context: ContextFile, lastHotspotDate: string | null, currentGenerated: string | null | undefined): boolean {
  const day = context.meta.through_day;
  if (day) return !!lastHotspotDate && lastHotspotDate > day;
  const g = Date.parse(context.meta.generated), cg = currentGenerated ? Date.parse(currentGenerated) : NaN;
  return Number.isFinite(g) && Number.isFinite(cg) && g < cg;
}
