export interface MonthProjection {
  daysInMonth: number;
  /** Days of the month that have started, today included. */
  daysElapsed: number;
  spent: number;
  /** Linear projection: spent ÷ daysElapsed × daysInMonth. An estimate, not a measurement. */
  projected: number;
  /** over: already at or past the budget; watch: on course to pass it; ok otherwise. */
  status: 'ok' | 'watch' | 'over';
}

/** Calendar length of the month containing `today` (YYYY-MM-DD), leap years included. */
export function daysInMonth(today: string): number {
  const [year, month] = today.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
}

/** Where this month is heading against a budget. Null when no positive budget is set. */
export function projectMonth(input: {
  today: string;
  spent: number;
  budget: number;
}): MonthProjection | null {
  if (!Number.isFinite(input.budget) || input.budget <= 0) return null;
  const length = daysInMonth(input.today);
  const dayOfMonth = Number(input.today.slice(8, 10));
  const elapsed = Math.min(Math.max(dayOfMonth, 1), length);
  const projected = (input.spent / elapsed) * length;
  return {
    daysInMonth: length,
    daysElapsed: elapsed,
    spent: input.spent,
    projected,
    status: input.spent >= input.budget ? 'over' : projected > input.budget ? 'watch' : 'ok',
  };
}
