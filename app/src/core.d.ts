// Types for ../../harmonized.js (the reference client logic shared with the pipeline tests).
export interface ClassDef { id: "low" | "normal" | "high" | "extreme"; label: string; max: number | null }
export interface GridMeta {
  grid: { deg: number; lat0: number; lon0: number; rows: number; cols: number };
  months: { first: string; count: number; last: string; viirs_start_index: number };
  /** Paraguay: the river split (no kind); biome countries: kind "biome" and the region ids / labels */
  regions: { river_lat: number[]; river_lon: number[]; chaco_south: number; kind?: string; names?: string[]; labels?: Record<string, string> };
  classes: ClassDef[];
  error_model: { c: number; p: number; sys_by_year: Record<string, number> };
  validation: {
    leave_one_year_out: Record<string, { mdape_pct: number; p90_pct?: number; bias_pct?: number; n?: number }>;
    anomaly_class_agreement?: Record<string, { same_class_pct: number; spearman?: number }>;
  };
  [k: string]: unknown;
}
export interface CurrentMeta {
  from: string; to: string;
  generated: string; source?: string;
  month_coverage: Record<string, number>;
  month_products: Record<string, Record<string, number>>;
  /** "YYYY-MM-DD" days in [from, to] with no FIRMS data yet. */
  days_without_data?: string[];
}
export interface Cell { m: number[]; h: number[]; modis: number[]; viirs: number[] }
/** noData: month indices with no data for this metric (FRP months whose current.json cells carry no FRP); zoneSeries reports NaN there. */
export interface Grid { meta: GridMeta; cells: Map<number, Cell>; nMonths: number; noData?: Set<number> }
export interface Series { harmonized: Float64Array; modis: Float64Array; viirs: Float64Array; naive: Float64Array }
export interface Verdict {
  m: number; label: string; year: number; month: number; value: number; median: number; ratio: number;
  coverage: number; partial: boolean;
  /** true when the month has no data (value and ratio are NaN); `class` is then only a placeholder. */
  noData: boolean;
  class: ClassDef; relativeError: number; yearsCompared: number; rank: number | null;
}
export interface CalendarCell { m: number; value: number; ratio: number | null; class: string | null; relativeError: number; noData?: boolean }
export interface Calendar { rows: { year: number; cells: (CalendarCell | null)[]; total: number }[]; monthlyMedian: number[] }

export function decodeGrid(gridJson: unknown, currentJson?: unknown): Grid;
/** frp.json (+ current.json 4th array) as a Grid in MW; classes/regions come from gridMeta (grid.json meta). */
export function decodeFrp(frpJson: unknown, currentJson?: unknown, gridMeta?: Partial<GridMeta> | null): Grid;
export function monthOf(meta: GridMeta, m: number): { year: number; month: number; label: string };
export function indexOf(meta: GridMeta, year: number, month: number): number;
export function cellCenter(meta: GridMeta, idx: number): [number, number];
export function cellAt(meta: GridMeta, lon: number, lat: number): number;
export function cellsInPolygon(grid: Grid, polygon: number[][] | number[][][]): number[];
export function zoneSeries(grid: Grid, cellIds: number[]): Series;
export function relativeError(meta: GridMeta, m: number, value: number): number;
export function classify(meta: GridMeta, ratio: number): ClassDef;
export function monthCoverage(meta: GridMeta, m: number, current?: CurrentMeta | string | null): number;
export function verdict(grid: Grid, series: Float64Array, m: number, coverage?: number): Verdict;
export interface DepartmentDef { id: string; name: string; cells: number[] }
export interface DepartmentRow {
  id: string; name: string; value: number; median: number; ratio: number;
  classId: ClassDef["id"]; relativeError: number; lowSignal: boolean; partial: boolean;
}
/** lowSignalMedian: a department whose typical month is below it is ranked by value, not ratio (default 10; 100 for fire power in MW). */
export function departmentRanking(grid: Grid, departments: DepartmentDef[], m: number, coverage?: number, lowSignalMedian?: number): DepartmentRow[];
/** area: "country" for the whole country, otherwise the factor region id ("chaco", a biome id) */
export interface ValidationRow { area: string; mdapePct: number; classAgreementPct: number | null; p90Pct?: number }
export interface ValidationSummary { rows: ValidationRow[]; spearman: number | null; nMonths: number }
/** countryArea: the country's area id, the key of the country row in frp.json (default "paraguay") */
export function validationSummary(meta: Partial<GridMeta>, countryArea?: string): ValidationSummary;
/** data/app/context.json: fire statistics per protected area (WDPA); sparse monthly series, no geometry. */
export interface ProtectedSeries { m: number[]; n: number[]; frp: number[] }
export interface ProtectedAreaRecord extends ProtectedSeries {
  id: string; name: string; desig: string; desig_type: string; iucn: string;
  departments: string[]; regions: ("chaco" | "oriental")[];
  /** the area's own series restricted to one department or region (inside the area AND the zone); only zones where it is not empty */
  by_zone: Record<string, ProtectedSeries>;
}
export interface ContextFile {
  meta: {
    source: string; citation: string; terms: string; through: string; first: string; generated: string; unit: string; overlap_note: string;
    /** last day of data behind the figures, "YYYY-MM-DD" */
    through_day?: string;
    /** when the WDPA release was downloaded, "YYYY-MM-DD" */
    retrieved: string;
  };
  areas: ProtectedAreaRecord[];
  zones: Record<string, ProtectedSeries>;
}
export interface ProtectedAreaRow {
  id: string; name: string; desig: string; value: number;
  /** median of the same calendar month in previous years, scaled by coverage; null when the area has no previous year */
  median: number | null;
  /** null when there is no history or the median is 0 */
  ratio: number | null;
  classId: ClassDef["id"] | null;
  /** ratio is null, or the median is below opts.lowSignalMedian: do not show ratio or class */
  lowSignal: boolean;
}
export interface ProtectedSummary {
  /** the zone's value for the month, union of the areas (each hotspot once); the areas can add up to more */
  inside: number;
  /** inside / opts.zoneValue, null when no zoneValue was given */
  share: number | null;
  areas: ProtectedAreaRow[];
}
/** null for a zone without figures (custom area) and for a month later than context.meta.through. */
export function protectedSummary(context: ContextFile, zoneId: string, m: number, metric?: "count" | "frp", coverage?: number,
  opts?: { classes?: ClassDef[]; zoneValue?: number; lowSignalMedian?: number }): ProtectedSummary | null;
export function calendar(grid: Grid, series: Float64Array): Calendar;
export function seriesToCSV(grid: Grid, s: Series, opts?: { metric?: "count" | "frp" }): string;

export interface SeasonClimatology { p10: ArrayLike<number>; p50: ArrayLike<number>; p90: ArrayLike<number> }
export interface SeasonStatus {
  /** cum / p50 at the day; 0 when cum is 0, Infinity when p50 is 0 and cum > 0. */
  ratio: number;
  band: "below" | "within" | "above";
  /** Days ahead of the median (positive = early, negative = late); null if undefined. */
  leadDays: number | null;
  /** doy < 15: too early in the year to compare. */
  early: boolean;
}
/** Cumulative hotspots by DOY (1..365, Feb 29 merged into DOY 59) for `year`; hotspots need a "YYYY-MM-DD" `date`. */
export function currentCumulative(hotspots: { date: string }[], year: number): Float64Array;
/** Season status at `doy` (1-based) against one area's season.json climatology. */
export function seasonStatus(cum: ArrayLike<number>, clim: SeasonClimatology, doy: number): SeasonStatus;
