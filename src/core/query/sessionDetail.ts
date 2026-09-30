import type { SessionDetail, TurnDetail } from '../../shared/dto';
import { modelNameFromId } from '../ingest/chatSession';
import { isCaptureLevel } from '../privacy/captureLevel';
import type { Database } from '../storage/database';
import { unavailable } from '../../shared/provenance';
import { known, SOURCES, summed, toTurnState } from './measure';
import { routingFor } from './routing';

interface SessionHeader {
  id: string;
  workspace: string;
  title: string | null;
  day: string;
  started_at: number;
  ended_at: number;
  active_ms: number;
  capture_level: string;
}

interface TurnRow {
  idx: number;
  response_id: string | null;
  started_at: number | null;
  state: string;
  system_initiated: number;
  mode: string | null;
  user_text: string | null;
  assistant_text: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  selection_mode: string;
  model_host: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  credits: number | null;
  reasoning_ms: number;
  tool_rounds: number;
  compactions: string;
  error_code: string | null;
  error_message: string | null;
}

export function getSessionDetail(database: Pick<Database, 'db'>, id: string): SessionDetail | null {
  const { db } = database;
  const header = db
    .prepare(
      'SELECT id, workspace, title, day, started_at, ended_at, active_ms, capture_level FROM sessions WHERE id = :id',
    )
    .get({ id }) as unknown as SessionHeader | undefined;
  if (header === undefined) return null;
  const turnRows = db
    .prepare(
      `SELECT idx, response_id, started_at, state, system_initiated, mode, user_text, assistant_text, requested_model,
              resolved_model, selection_mode, model_host, prompt_tokens, completion_tokens, credits,
              reasoning_ms, tool_rounds, compactions, error_code, error_message
         FROM turns WHERE session_id = :id ORDER BY idx`,
    )
    .all({ id }) as unknown as TurnRow[];
  const tools = groupBy(
    db
      .prepare('SELECT turn_idx, name, status FROM tool_calls WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as { turn_idx: number; name: string; status: string }[],
    (row) => row.turn_idx,
  );
  const files = groupBy(
    db
      .prepare('SELECT turn_idx, path, action FROM file_events WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as { turn_idx: number; path: string; action: string }[],
    (row) => row.turn_idx,
  );

  const callRows = db
    .prepare(
      'SELECT response_id, role, cached_tokens, ttft_ms, nano_aiu FROM llm_calls WHERE session_id = :id',
    )
    .all({ id }) as unknown as {
    response_id: string | null;
    role: string;
    cached_tokens: number | null;
    ttft_ms: number | null;
    nano_aiu: number | null;
  }[];
  const byResponse = new Map(
    callRows.flatMap((call) => (call.response_id === null ? [] : [[call.response_id, call] as const])),
  );
  const matchedResponses = new Set<string>();

  const turns = turnRows.map((row): TurnDetail => {
    const model = row.resolved_model ?? row.requested_model;
    const call = row.response_id === null ? undefined : byResponse.get(row.response_id);
    if (call !== undefined && row.response_id !== null) matchedResponses.add(row.response_id);
    return {
      index: row.idx,
      startedAt: row.started_at,
      state: toTurnState(row.state),
      systemInitiated: row.system_initiated === 1,
      mode: row.mode,
      userText: row.user_text,
      assistantText: row.assistant_text,
      routing: routingFor([{ mode: row.selection_mode, model }]),
      model: model === null ? null : modelNameFromId(model),
      host: row.model_host === 'copilot' || row.model_host === 'byok' ? row.model_host : 'unknown',
      inputTokens: known(row.prompt_tokens, SOURCES.inputTokens),
      outputTokens: known(row.completion_tokens, SOURCES.outputTokens),
      credits: known(row.credits, SOURCES.credits),
      cachedTokens: call ? known(call.cached_tokens, SOURCES.cachedTokens) : unavailable(SOURCES.noDebugLog),
      ttftMs: call ? known(call.ttft_ms, SOURCES.ttftMs) : unavailable(SOURCES.noDebugLog),
      nanoAiu: call ? known(call.nano_aiu, SOURCES.nanoAiu) : unavailable(SOURCES.noDebugLog),
      reasoningMs: row.reasoning_ms,
      toolRounds: row.tool_rounds,
      compactions: countJsonArray(row.compactions),
      toolCalls: (tools.get(row.idx) ?? []).map((call) => ({ name: call.name, status: call.status })),
      fileEvents: (files.get(row.idx) ?? []).map((file) => ({ path: file.path, action: file.action })),
      errorCode: row.error_code,
      errorMessage: row.error_message,
    };
  });

  const total = (pick: (row: TurnRow) => number | null, source: string, expected = turnRows.length) => {
    const values = turnRows.map(pick).filter((value): value is number => value !== null);
    return summed(
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0),
      values.length,
      expected,
      source,
    );
  };
  return {
    id: header.id,
    workspace: header.workspace,
    title: header.title,
    day: header.day,
    startedAt: header.started_at,
    endedAt: header.ended_at,
    activeMs: header.active_ms,
    captureLevel: isCaptureLevel(header.capture_level) ? header.capture_level : 'metrics',
    inputTokens: total((row) => row.prompt_tokens, SOURCES.inputTokens),
    outputTokens: total((row) => row.completion_tokens, SOURCES.outputTokens),
    credits: total(
      (row) => row.credits,
      SOURCES.credits,
      turnRows.filter((row) => row.model_host !== 'byok').length,
    ),
    analysis: null,
    debug:
      callRows.length === 0
        ? null
        : {
            calls: callRows.length,
            internalCalls: callRows.filter((call) => call.role === 'COPILOT_INTERNAL').length,
            unmatchedCalls: callRows.filter(
              (call) =>
                call.role !== 'COPILOT_INTERNAL' &&
                (call.response_id === null || !matchedResponses.has(call.response_id)),
            ).length,
          },
    turns,
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const row of rows) {
    const group = result.get(key(row)) ?? [];
    group.push(row);
    result.set(key(row), group);
  }
  return result;
}

function countJsonArray(text: string): number {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
