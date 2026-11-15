// Pure helpers shared by the two statistics layers of the verdict (protected areas and indigenous territories), so `node --test`
// can run them directly (no React, no @core).

export type LayerNote = "custom" | "late" | "stale" | null;

/**
 * Why a layer has no figures for the selected month, or null when it has them (or when nothing should be said):
 * - nothing for a layer that is not loaded, a month without data, or while the last month's figures wait for the hotspots (`pending`);
 * - "custom" for a hand-drawn area (the layer has figures per country, region and department only);
 * - "late" for a month after the last one the layer covers; "stale" when that last month has newer hotspots than the layer.
 */
export function layerNote(o: { loaded: boolean; noData: boolean; pending: boolean; custom: boolean; month: number; throughIdx: number; stale: boolean }): LayerNote {
  if (!o.loaded || o.noData || o.pending) return null;
  return o.custom ? "custom" : o.month > o.throughIdx ? "late" : o.stale ? "stale" : null;
}

/** "<1" for a share under 1 % (it must not round to "0 %" next to a non-zero count), else the rounded percentage; null without a share. */
export function shareLabel(share: number | null | undefined, locale: string): string | null {
  if (share === null || share === undefined) return null;
  const pct = share * 100;
  return pct > 0 && pct < 1 ? "<1" : Math.round(pct).toLocaleString(locale);
}

/** The rows that carry visible fire (value >= min), at most `n`, in the order given. */
export function topRows<T extends { value: number }>(rows: readonly T[] | undefined, n = 3, min = 0.5): T[] {
  return rows ? rows.filter((r) => r.value >= min).slice(0, n) : [];
}
