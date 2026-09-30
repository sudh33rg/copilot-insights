import type { Database } from '../storage/database';
import { getSessionDetail } from './sessionDetail';

/** The session that ended most recently, reduced to what the live status needs. Null for an empty index. */
export function getActiveSession(database: Pick<Database, 'db'>): {
  endedAt: number;
  turns: { index: number; inputTokens: number | null; credits: number | null; compactions: number }[];
} | null {
  const row = database.db.prepare('SELECT id FROM sessions ORDER BY ended_at DESC LIMIT 1').get() as
    { id: string } | undefined;
  const detail = row === undefined ? null : getSessionDetail(database, row.id);
  if (detail === null) return null;
  return {
    endedAt: detail.endedAt,
    turns: detail.turns.map((turn) => ({
      index: turn.index,
      inputTokens: turn.inputTokens.value,
      credits: turn.credits.value,
      compactions: turn.compactions.value ?? 0,
    })),
  };
}
