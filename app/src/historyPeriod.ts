/** Format the recorded coverage without guessing when metadata is missing or invalid. */
export function historyPeriodLabel(period: string, monthLabel: (year: number, month: number) => string): string | null {
  const match = /^(\d{4})-(\d{2})\.\.(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const [, sy, sm, ey, em] = match;
  const startYear = Number(sy), startMonth = Number(sm), endYear = Number(ey), endMonth = Number(em);
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12 || startYear * 12 + startMonth > endYear * 12 + endMonth) return null;
  return `${monthLabel(startYear, startMonth)} – ${monthLabel(endYear, endMonth)}`;
}
