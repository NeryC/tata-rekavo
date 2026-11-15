/** Region presets of a biome country: the ids in the order of meta.regions.names (all regions of regions.json without it)
 *  and the region of each cell. A single region is the country itself (Uruguay: one biome above the hotspot threshold),
 *  so it offers no preset of its own; its cells still know their region (factors, validation). */
export interface RegionCellsLike { regions: { id: string; cells: number[] }[] }

export function biomePresets(names: string[] | undefined, regionCells: RegionCellsLike): { ids: string[]; of: Map<number, string> } {
  const order = Array.isArray(names) ? names : regionCells.regions.map((x) => x.id);
  const ids = order.filter((id) => regionCells.regions.some((x) => x.id === id));
  const of = new Map<number, string>();
  for (const reg of regionCells.regions) if (ids.includes(reg.id)) for (const c of reg.cells) of.set(c, reg.id);
  return { ids: ids.length > 1 ? ids : [], of };
}
