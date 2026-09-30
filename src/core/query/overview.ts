import type { BreakdownRow, Overview, PeriodTotals } from '../../shared/dto';
import { derived, unavailable } from '../../shared/provenance';
import { modelNameFromId } from '../ingest/chatSession';
import type { Database } from '../storage/database';
import { getInternalUsage } from './internalUsage';
import { SOURCES, summed } from './measure';

interface SumRow {
  sessions: number;
  turns: number;
  in_sum: number | null;
  in_known: number;
  out_sum: number | null;
  out_known: number;
  credit_sum: number | null;
  credit_known: number;
  billable: number;
}

const SUMS = `count(DISTINCT t.session_id) AS sessions, count(*) AS turns,
  sum(t.prompt_tokens) AS in_sum, count(t.prompt_tokens) AS in_known,
  sum(t.completion_tokens) AS out_sum, count(t.completion_tokens) AS out_known,
  sum(t.credits) AS credit_sum, count(t.credits) AS credit_known,
  coalesce(sum(t.model_host <> 'byok'), 0) AS billable`;

/** `today` is a local YYYY-MM-DD day; the month runs from the 1st of that day's month through `today`. */
export function getOverview(database: Pick<Database, 'db'>, today: string): Overview {
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    today: periodTotals(database, today, today),
    month: periodTotals(database, monthStart, today),
    failureRate: failureRate(database, monthStart, today),
    byModel: breakdown(database, 'model', monthStart, today),
    byWorkspace: breakdown(database, 'workspace', monthStart, today),
    hostSplit: hostSplit(database, monthStart, today),
    internal: getInternalUsage(database, monthStart, today),
  };
}

function measures(row: SumRow) {
  return {
    sessions: row.sessions,
    turns: row.turns,
    inputTokens: summed(row.in_sum, row.in_known, row.turns, SOURCES.inputTokens),
    outputTokens: summed(row.out_sum, row.out_known, row.turns, SOURCES.outputTokens),
    credits: summed(row.credit_sum, row.credit_known, row.billable, SOURCES.credits),
  };
}

function periodTotals(database: Pick<Database, 'db'>, from: string, to: string): PeriodTotals {
  const row = database.db
    .prepare(`SELECT ${SUMS} FROM turns t WHERE t.day >= :from AND t.day <= :to`)
    .get({ from, to }) as unknown as SumRow;
  return { from, to, ...measures(row) };
}

function failureRate(database: Pick<Database, 'db'>, from: string, to: string) {
  const row = database.db
    .prepare(
      `SELECT coalesce(sum(state = 'failed'), 0) AS failed, coalesce(sum(state IN ('complete', 'failed')), 0) AS finished
         FROM turns WHERE system_initiated = 0 AND day >= :from AND day <= :to`,
    )
    .get({ from, to }) as unknown as { failed: number; finished: number };
  const source = 'turns.state (failed ÷ finished user-initiated turns; cancelled and system turns excluded)';
  return row.finished === 0 ? unavailable<number>(source) : derived(row.failed / row.finished, source);
}

function breakdown(
  database: Pick<Database, 'db'>,
  by: 'model' | 'workspace',
  from: string,
  to: string,
): BreakdownRow[] {
  const keyExpr = by === 'model' ? "coalesce(t.resolved_model, t.requested_model, 'unknown')" : 's.workspace';
  const hostExpr = by === 'model' ? 't.model_host' : 'NULL';
  const rows = database.db
    .prepare(
      `SELECT ${keyExpr} AS group_key, ${hostExpr} AS host, ${SUMS}
         FROM turns t JOIN sessions s ON s.id = t.session_id
        WHERE t.day >= :from AND t.day <= :to
        GROUP BY group_key, host
        ORDER BY turns DESC, group_key`,
    )
    .all({ from, to }) as unknown as (SumRow & { group_key: string; host: string | null })[];
  return rows.map((row) => ({
    key: row.group_key,
    label:
      by === 'model'
        ? row.group_key === 'unknown'
          ? 'Unknown model'
          : modelNameFromId(row.group_key)
        : row.group_key,
    host: row.host === 'copilot' || row.host === 'byok' ? row.host : row.host === null ? null : 'unknown',
    ...measures(row),
  }));
}

function hostSplit(database: Pick<Database, 'db'>, from: string, to: string): Overview['hostSplit'] {
  const rows = database.db
    .prepare(
      `SELECT model_host AS host, count(*) AS turns, count(DISTINCT session_id) AS sessions
         FROM turns WHERE day >= :from AND day <= :to GROUP BY model_host ORDER BY model_host`,
    )
    .all({ from, to }) as unknown as { host: string; turns: number; sessions: number }[];
  return rows.map((row) => ({
    host: row.host === 'copilot' || row.host === 'byok' ? row.host : 'unknown',
    turns: row.turns,
    sessions: row.sessions,
  }));
}
