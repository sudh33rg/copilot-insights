import type { Measured } from '../../shared/provenance';
import type { Database } from '../storage/database';
import { SOURCES, summed } from './measure';

/**
 * Copilot's own per-request credits summed per session. Exact when every Copilot-hosted turn reported them, a
 * derived lower bound when only some did, unavailable when none did (never zero).
 */
export function getSessionCredits(
  database: Pick<Database, 'db'>,
  sessionId: string | null = null,
): Map<string, Measured<number>> {
  const rows = database.db
    .prepare(
      `SELECT session_id, SUM(credits) AS total, COUNT(credits) AS reported,
              SUM(CASE WHEN model_host != 'byok' THEN 1 ELSE 0 END) AS expected
         FROM turns WHERE :id IS NULL OR session_id = :id GROUP BY session_id`,
    )
    .all({ id: sessionId }) as unknown as {
    session_id: string;
    total: number | null;
    reported: number;
    expected: number;
  }[];
  return new Map(
    rows.map((row) => [row.session_id, summed(row.total, row.reported, row.expected, SOURCES.credits)]),
  );
}
