import type { ToolAnalytics } from '../../shared/dto';
import type { Database } from '../storage/database';
import { buildFilter, type SessionListQuery } from './sessionList';

/** Counts recorded calls; a failed parent turn is not evidence that a particular call failed. */
export function getToolAnalytics(database: Pick<Database, 'db'>, query: SessionListQuery): ToolAnalytics {
  const { where, params } = buildFilter(query);
  const scope = `SELECT s.id FROM sessions s ${where}`;
  const rows = database.db
    .prepare(
      `SELECT name, count(*) AS calls, count(DISTINCT session_id) AS sessions,
    sum(status = 'complete') AS complete, sum(status = 'incomplete') AS incomplete, sum(status = 'unknown') AS unknown
    FROM tool_calls WHERE session_id IN (${scope}) GROUP BY name ORDER BY calls DESC, name`,
    )
    .all(params) as unknown as ToolAnalytics['tools'];
  const failures = database.db
    .prepare(
      `SELECT error_code AS code, count(*) AS turns, count(DISTINCT session_id) AS sessions
    FROM turns WHERE session_id IN (${scope}) AND state = 'failed' GROUP BY error_code ORDER BY turns DESC`,
    )
    .all(params) as unknown as ToolAnalytics['failures'];
  return { tools: rows, failures };
}
