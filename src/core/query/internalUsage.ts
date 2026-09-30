import type { Overview } from '../../shared/dto';
import { derived, unavailable } from '../../shared/provenance';
import type { Database } from '../storage/database';

export type InternalUsage = Overview['internal'];

const SOURCE = 'agent debug log (lower bound: only sessions with agent debug logging are observable)';
const LOCAL_DAY = "date(started_at / 1000, 'unixepoch', 'localtime')";

export function getInternalUsage(
  database: Pick<Database, 'db'>,
  fromDay: string,
  toDay: string,
): InternalUsage {
  const { db } = database;
  const logged = (db.prepare('SELECT count(*) AS n FROM debug_sessions').get() as unknown as { n: number }).n;
  const totals = db
    .prepare(
      `SELECT count(*) AS calls, sum(input_tokens) AS input, sum(output_tokens) AS output, sum(nano_aiu) AS aiu
         FROM llm_calls WHERE role = 'COPILOT_INTERNAL' AND ${LOCAL_DAY} >= :fromDay AND ${LOCAL_DAY} <= :toDay`,
    )
    .get({ fromDay, toDay }) as unknown as {
    calls: number;
    input: number | null;
    output: number | null;
    aiu: number | null;
  };
  const byName = db
    .prepare(
      `SELECT coalesce(debug_name, '(unnamed)') AS name, role, count(*) AS calls, sum(input_tokens) AS input,
              count(input_tokens) AS input_known
         FROM llm_calls WHERE ${LOCAL_DAY} >= :fromDay AND ${LOCAL_DAY} <= :toDay
        GROUP BY name, role ORDER BY calls DESC, name`,
    )
    .all({ fromDay, toDay }) as unknown as {
    name: string;
    role: 'USER_FACING' | 'COPILOT_INTERNAL' | 'UNKNOWN';
    calls: number;
    input: number | null;
    input_known: number;
  }[];
  const measure = (value: number | null) =>
    logged === 0 || value === null ? unavailable<number>(SOURCE) : derived(value, SOURCE);
  return {
    sessionsWithLogs: logged,
    calls: totals.calls,
    inputTokens: measure(totals.input),
    outputTokens: measure(totals.output),
    nanoAiu: measure(totals.aiu),
    byName: byName.map((row) => ({
      name: row.name,
      role: row.role,
      calls: row.calls,
      inputTokens: measure(row.input_known === 0 ? null : row.input),
    })),
  };
}
