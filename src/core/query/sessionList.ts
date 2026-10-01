import type { SessionListParams, SessionRow } from '../../shared/dto';
import type { Database, SqlValue } from '../storage/database';
import { SOURCES, summed, toTurnState } from './measure';
import { routingFor, type RoutingEntry } from './routing';

export type SessionListQuery = SessionListParams;

interface ListRow {
  preview: string | null;
  bookmarked: number;
  active_ms: number;
  id: string;
  day: string;
  started_at: number;
  workspace: string;
  title: string | null;
  turns: number;
  failed_turns: number;
  in_sum: number | null;
  in_known: number;
  out_sum: number | null;
  out_known: number;
  credit_sum: number | null;
  credit_known: number;
  billable: number;
  last_state: string | null;
}

export function listSessions(
  database: Pick<Database, 'db'>,
  query: SessionListQuery,
): { rows: SessionRow[]; total: number } {
  const { db } = database;
  const filter = buildFilter(query);
  const total = (
    db.prepare(`SELECT count(*) AS n FROM sessions s ${filter.where}`).get(filter.params) as unknown as {
      n: number;
    }
  ).n;
  const list = db
    .prepare(
      `SELECT s.id, s.day, s.started_at, s.workspace, s.title, s.active_ms,
              (SELECT user_text FROM turns pt WHERE pt.session_id = s.id AND pt.system_initiated = 0 AND pt.user_text IS NOT NULL ORDER BY pt.idx LIMIT 1) AS preview,
              coalesce((SELECT bookmarked FROM session_annotations a WHERE a.session_id = s.id), 0) AS bookmarked,
              count(t.idx) AS turns,
              coalesce(sum(t.state = 'failed'), 0) AS failed_turns,
              sum(t.prompt_tokens) AS in_sum, count(t.prompt_tokens) AS in_known,
              sum(t.completion_tokens) AS out_sum, count(t.completion_tokens) AS out_known,
              sum(t.credits) AS credit_sum, count(t.credits) AS credit_known,
              coalesce(sum(t.model_host <> 'byok'), 0) AS billable,
              (SELECT lt.state FROM turns lt WHERE lt.session_id = s.id ORDER BY lt.idx DESC LIMIT 1) AS last_state
         FROM sessions s LEFT JOIN turns t ON t.session_id = s.id
         ${filter.where}
        GROUP BY s.id
        ORDER BY ${{ newest: 's.started_at DESC', oldest: 's.started_at ASC', tokens: '(sum(t.prompt_tokens) + coalesce(sum(t.completion_tokens), 0)) DESC NULLS LAST', credits: 'sum(t.credits) DESC NULLS LAST', duration: 's.active_ms DESC' }[query.sort ?? 'newest']}, s.id
        LIMIT :limit OFFSET :offset`,
    )
    .all({ ...filter.params, limit: query.limit, offset: query.offset }) as unknown as ListRow[];
  const routing = routingBySession(
    database,
    list.map((row) => row.id),
  );
  const rows = list.map((row): SessionRow => ({
    preview: row.preview === null ? null : row.preview.slice(0, 220),
    bookmarked: row.bookmarked === 1,
    activeMs: {
      value: row.active_ms,
      provenance: { kind: 'derived', source: 'sum of recorded turn elapsed times' },
    },
    id: row.id,
    day: row.day,
    startedAt: row.started_at,
    workspace: row.workspace,
    title: row.title,
    outcome: null,
    routing: routingFor(routing.get(row.id) ?? []),
    state: toTurnState(row.last_state),
    turns: row.turns,
    failedTurns: row.failed_turns,
    inputTokens: summed(row.in_sum, row.in_known, row.turns, SOURCES.inputTokens),
    outputTokens: summed(row.out_sum, row.out_known, row.turns, SOURCES.outputTokens),
    // Credits exist only for Copilot-hosted requests; BYOK turns are not expected to report any.
    credits: summed(row.credit_sum, row.credit_known, row.billable, SOURCES.credits),
  }));
  return { rows, total };
}

/** Escapes LIKE wildcards so user text always matches literally (paired with `ESCAPE '\'`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function buildFilter(query: SessionListQuery): { where: string; params: Record<string, SqlValue> } {
  const clauses: string[] = [];
  const params: Record<string, SqlValue> = {};
  if (query.fromDay !== undefined) {
    clauses.push('s.day >= :fromDay');
    params.fromDay = query.fromDay;
  }
  if (query.toDay !== undefined) {
    clauses.push('s.day <= :toDay');
    params.toDay = query.toDay;
  }
  if (query.workspace !== undefined) {
    clauses.push('s.workspace = :workspace');
    params.workspace = query.workspace;
  }
  if (query.failedOnly === true) {
    clauses.push("EXISTS (SELECT 1 FROM turns ft WHERE ft.session_id = s.id AND ft.state = 'failed')");
  }
  if (query.model) {
    clauses.push(
      "EXISTS (SELECT 1 FROM turns mt WHERE mt.session_id = s.id AND lower(coalesce(mt.resolved_model, mt.requested_model, '')) LIKE :model ESCAPE '\\')",
    );
    params.model = `%${escapeLike(query.model.toLowerCase())}%`;
  }
  if (query.tool) {
    clauses.push('EXISTS (SELECT 1 FROM tool_calls tc WHERE tc.session_id = s.id AND tc.name = :tool)');
    params.tool = query.tool;
  }
  if (query.file) {
    clauses.push(
      "EXISTS (SELECT 1 FROM file_events fe WHERE fe.session_id = s.id AND lower(fe.path) LIKE :file ESCAPE '\\')",
    );
    params.file = `%${escapeLike(query.file.toLowerCase())}%`;
  }
  if (query.state) {
    clauses.push('EXISTS (SELECT 1 FROM turns st WHERE st.session_id = s.id AND st.state = :state)');
    params.state = query.state;
  }
  if (query.bookmarkedOnly)
    clauses.push(
      'EXISTS (SELECT 1 FROM session_annotations a WHERE a.session_id = s.id AND a.bookmarked = 1)',
    );
  const text = query.q?.trim().toLowerCase();
  if (text !== undefined && text !== '') {
    params.q = `%${escapeLike(text)}%`;
    clauses.push(
      `(lower(coalesce(s.title, '')) LIKE :q ESCAPE '\\'
        OR lower(s.workspace) LIKE :q ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM turns qt WHERE qt.session_id = s.id
             AND (lower(coalesce(qt.user_text, '')) LIKE :q ESCAPE '\\'
               OR lower(coalesce(qt.assistant_text, '')) LIKE :q ESCAPE '\\'
               OR lower(coalesce(qt.error_code, '')) LIKE :q ESCAPE '\\'
               OR lower(qt.context_items) LIKE :q ESCAPE '\\'
               OR lower(coalesce(qt.resolved_model, qt.requested_model, '')) LIKE :q ESCAPE '\\'))
        OR EXISTS (SELECT 1 FROM tool_calls tc WHERE tc.session_id = s.id AND (lower(tc.name) LIKE :q ESCAPE '\\' OR lower(coalesce(tc.args, '')) LIKE :q ESCAPE '\\' OR lower(coalesce(tc.output, '')) LIKE :q ESCAPE '\\'))
        OR EXISTS (SELECT 1 FROM file_events fe WHERE fe.session_id = s.id AND lower(fe.path) LIKE :q ESCAPE '\\'))`,
    );
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function routingBySession(
  database: Pick<Database, 'db'>,
  ids: readonly string[],
): Map<string, RoutingEntry[]> {
  const result = new Map<string, RoutingEntry[]>();
  if (ids.length === 0) return result;
  const rows = database.db
    .prepare(
      `SELECT session_id, selection_mode AS mode, coalesce(resolved_model, requested_model) AS model
         FROM turns
        WHERE session_id IN (SELECT value FROM json_each(:ids))
        GROUP BY session_id, selection_mode, coalesce(resolved_model, requested_model)
        ORDER BY session_id, min(idx)`,
    )
    .all({ ids: JSON.stringify(ids) }) as unknown as {
    session_id: string;
    mode: string;
    model: string | null;
  }[];
  for (const row of rows) {
    const entries = result.get(row.session_id) ?? [];
    entries.push({ mode: row.mode, model: row.model });
    result.set(row.session_id, entries);
  }
  return result;
}
