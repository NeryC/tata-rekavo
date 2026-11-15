/** Arrow navigation follows the chronological months shown in the calendar. */
export function calendarTarget(months: readonly number[], current: number, key: string): number | null {
  const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 12, ArrowDown: -12 };
  if (!(key in delta)) return null;
  const target = current + delta[key];
  return months.includes(target) ? target : current;
}

