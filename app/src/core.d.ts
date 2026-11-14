// Types for ../../harmonized.js (the reference client logic shared with the pipeline tests).
export interface ClassDef { id: "low" | "normal" | "high" | "extreme"; label: string; max: number | null }
export interface GridMeta {
  grid: { deg: number; lat0: number; lon0: number; rows: number; cols: number };
  months: { first: string; count: number; last: string; viirs_start_index: number };
  regions: { river_lat: number[]; river_lon: number[]; chaco_south: number };
  classes: ClassDef[];
  error_model: { c: number; p: number; sys_by_year: Record<string, number> };
  validation: {
    leave_one_year_out: Record<string, { mdape_pct: number }>;
    anomaly_class_agreement: Record<string, { same_class_pct: number }>;
  };
  [k: string]: unknown;
}
export interface CurrentMeta {
  from: string; to: string;
  generated: string; source?: string;
  month_coverage: Record<string, number>;
  month_products: Record<string, Record<string, number>>;
}
export interface Cell { m: number[]; h: number[]; modis: number[]; viirs: number[] }
export interface Grid { meta: GridMeta; cells: Map<number, Cell>; nMonths: number }
export interface Series { harmonized: Float64Array; modis: Float64Array; viirs: Float64Array; naive: Float64Array }
export interface Verdict {
  m: number; label: string; year: number; month: number; value: number; median: number; ratio: number;
  coverage: number; partial: boolean; class: ClassDef; relativeError: number; yearsCompared: number; rank: number | null;
}
export interface CalendarCell { m: number; value: number; ratio: number | null; class: string | null; relativeError: number }
export interface Calendar { rows: { year: number; cells: (CalendarCell | null)[]; total: number }[]; monthlyMedian: number[] }

export function decodeGrid(gridJson: unknown, currentJson?: unknown): Grid;
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
export function calendar(grid: Grid, series: Float64Array): Calendar;
export function seriesToCSV(grid: Grid, s: Series): string;
