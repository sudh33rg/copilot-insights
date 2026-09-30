import type { BreakdownRow, TrendDay } from '../../shared/dto';
import { daysAgo } from '../time';
import type { Database } from '../storage/database';
import { breakdown, periodTotals } from './overview';

export const MAX_RANGE_DAYS = 366;

/** One row per local day, oldest first, ending at `toDay`; days without usage are included (values unavailable). */
export function getTrends(database: Database, toDay: string, days: number): TrendDay[] {
  return Array.from({ length: days }, (_, offset) => {
    const day = daysAgo(toDay, days - 1 - offset);
    const { sessions, turns, inputTokens, outputTokens, credits } = periodTotals(database, day, day);
    return { day, sessions, turns, inputTokens, outputTokens, credits };
  });
}

export function getRangeBreakdown(
  database: Database,
  from: string,
  to: string,
): { byModel: BreakdownRow[]; byWorkspace: BreakdownRow[] } {
  return {
    byModel: breakdown(database, 'model', from, to),
    byWorkspace: breakdown(database, 'workspace', from, to),
  };
}

/** Guards range requests from the webview: ordered days and a bounded span (inclusive). */
export function assertRange(from: string, to: string): void {
  if (from > to) throw new RangeError('The start day must not be after the end day.');
  // Walk forward from `from`; `daysAgo` handles calendar arithmetic, and the bound keeps this loop short.
  let day = from;
  for (let count = 1; count <= MAX_RANGE_DAYS; count++) {
    if (day === to) return;
    day = daysAgo(day, -1);
  }
  throw new RangeError(`Choose a range of at most ${String(MAX_RANGE_DAYS)} days.`);
}
