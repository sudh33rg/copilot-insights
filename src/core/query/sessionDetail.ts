import type { SessionDetail, TurnDetail } from '../../shared/dto';
import { modelNameFromId } from '../ingest/chatSession';
import { isCaptureLevel } from '../privacy/captureLevel';
import type { Database } from '../storage/database';
import { exact, unavailable, type Measured } from '../../shared/provenance';
import { isRecord } from '../json';
import { contextItemSchema } from '../../shared/dto';
import { SessionLibrary } from '../storage/sessionLibrary';
import { redactSecrets, redactDeep } from '../privacy/redact';
import { groupBy, known, SOURCES, summed, toTurnState } from './measure';
import { routingFor } from './routing';
import { getSessionEfficiency } from './sessionEfficiency';
import { getSessionOutcomes } from './sessionOutcomes';

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
  elapsed_ms: number | null;
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
  reasoning_blocks: number;
  tool_rounds: number;
  compactions: string;
  tool_input_retries: number;
  prompt_composition: string;
  context_items: string;
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
      `SELECT idx, response_id, started_at, elapsed_ms, state, system_initiated, mode, user_text, assistant_text, requested_model,
              resolved_model, selection_mode, model_host, prompt_tokens, completion_tokens, credits,
              reasoning_ms, reasoning_blocks, tool_rounds, tool_input_retries, compactions, prompt_composition,
              context_items, error_code, error_message
         FROM turns WHERE session_id = :id ORDER BY idx`,
    )
    .all({ id }) as unknown as TurnRow[];
  const tools = groupBy(
    db
      .prepare(
        'SELECT turn_idx, call_id, name, status, args, output, origin FROM tool_calls WHERE session_id = :id ORDER BY turn_idx, seq',
      )
      .all({ id }) as unknown as {
      turn_idx: number;
      call_id: string | null;
      output: string | null;
      name: string;
      status: string;
      args: string | null;
      origin: string;
    }[],
    (row) => row.turn_idx,
  );
  const files = groupBy(
    db
      .prepare(
        'SELECT turn_idx, path, action, source FROM file_events WHERE session_id = :id ORDER BY turn_idx, seq',
      )
      .all({ id }) as unknown as { turn_idx: number; path: string; action: string; source: string }[],
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
      contextItems:
        header.capture_level === 'full'
          ? parseJsonArray(row.context_items).flatMap((entry) => {
              const parsed = contextItemSchema.safeParse(redactDeep(entry));
              return parsed.success ? [parsed.data] : [];
            })
          : [],
      index: row.idx,
      startedAt: row.started_at,
      state: toTurnState(row.state),
      systemInitiated: row.system_initiated === 1,
      mode: row.mode,
      userText: row.user_text,
      assistantText: row.assistant_text,
      routing: routingFor([{ mode: row.selection_mode, model }]),
      model: model === null ? null : modelNameFromId(model),
      modelId: model,
      host: row.model_host === 'copilot' || row.model_host === 'byok' ? row.model_host : 'unknown',
      inputTokens: known(row.prompt_tokens, SOURCES.inputTokens),
      outputTokens: known(row.completion_tokens, SOURCES.outputTokens),
      credits: known(row.credits, SOURCES.credits),
      cachedTokens: call ? known(call.cached_tokens, SOURCES.cachedTokens) : unavailable(SOURCES.noDebugLog),
      ttftMs: call ? known(call.ttft_ms, SOURCES.ttftMs) : unavailable(SOURCES.noDebugLog),
      nanoAiu: call ? known(call.nano_aiu, SOURCES.nanoAiu) : unavailable(SOURCES.noDebugLog),
      reasoningMs:
        row.reasoning_blocks > 0
          ? exact(row.reasoning_ms, SOURCES.reasoning)
          : unavailable(`${SOURCES.reasoning}: no reasoning recorded for this turn`),
      toolRounds: exact(row.tool_rounds, SOURCES.toolRounds),
      toolInputRetries: exact(row.tool_input_retries, SOURCES.toolRounds),
      compactions: exact(countJsonArray(row.compactions), SOURCES.compactions),
      contextTokensBefore: largestContextBefore(row.compactions),
      promptComposition: parseComposition(row.prompt_composition),
      elapsedMs: known(row.elapsed_ms, 'chatSessions elapsedMs / result.timings.totalElapsed'),
      toolCalls: (tools.get(row.idx) ?? []).map((call) => ({
        name: call.name,
        callId: call.call_id,
        output: header.capture_level === 'full' && call.output !== null ? safeToolArgs(call.output) : null,
        status: call.status,
        origin: call.origin,
        args: header.capture_level === 'full' && call.args !== null ? safeToolArgs(call.args) : null,
      })),
      fileEvents: (files.get(row.idx) ?? []).map((file) => ({
        path: file.path,
        action: file.action,
        source: file.source,
      })),
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
  const outcomes = getSessionOutcomes(database, id);
  const spans = db
    .prepare(
      'SELECT span_id, response_id, started_at, duration_ms, model, role, input_tokens, output_tokens, cached_tokens FROM llm_calls WHERE session_id = :id ORDER BY started_at, span_id',
    )
    .all({ id }) as unknown as {
    span_id: string;
    response_id: string | null;
    started_at: number;
    duration_ms: number | null;
    model: string | null;
    role: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cached_tokens: number | null;
  }[];
  const artifacts: NonNullable<SessionDetail['promptArtifacts']> = [];
  if (header.capture_level === 'full') {
    const prompt = db
      .prepare('SELECT content, source FROM llm_prompt_files WHERE session_id = :id')
      .get({ id }) as { content: string | null; source: string | null } | undefined;
    if (prompt?.content != null)
      artifacts.push({
        kind: 'instructions',
        name: 'Recorded system instructions',
        content: redactSecrets(prompt.content),
        source: `debug artifact ${prompt.source ?? 'system prompt'} (latest recorded; request association unavailable)`,
      });
    const defs = db
      .prepare(
        'SELECT name, definition FROM llm_tool_defs WHERE session_id = :id AND definition IS NOT NULL ORDER BY name',
      )
      .all({ id }) as unknown as { name: string; definition: string }[];
    for (const def of defs)
      artifacts.push({
        kind: 'tool-definition',
        name: def.name,
        content: safeToolArgs(def.definition) ?? '',
        source: 'debug tools artifact (latest recorded; request association unavailable)',
      });
  }
  return {
    annotation: new SessionLibrary(database).get(id),
    promptArtifacts: artifacts,
    modelCalls: spans.map((span) => ({
      id: span.span_id,
      turnIndex:
        span.response_id === null
          ? null
          : (turnRows.find((row) => row.response_id === span.response_id)?.idx ?? null),
      startedAt: span.started_at,
      durationMs: known(span.duration_ms, 'debug llm_request.duration'),
      model: span.model,
      role: span.role,
      inputTokens: known(span.input_tokens, 'agent debug log llm_request.inputTokens'),
      outputTokens: known(span.output_tokens, 'agent debug log llm_request.outputTokens'),
      cachedTokens: known(span.cached_tokens, SOURCES.cachedTokens),
    })),
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
    outcomes,
    efficiency: getSessionEfficiency(database, turns, id, outcomes),
    baseline: null,
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

function parseJsonArray(text: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The largest context size before any of a turn's compactions, or unavailable when it never compacted. */
function largestContextBefore(json: string): Measured<number> {
  const sizes = parseJsonArray(json).flatMap((entry) =>
    isRecord(entry) && typeof entry.contextLengthBefore === 'number' ? [entry.contextLengthBefore] : [],
  );
  return sizes.length === 0
    ? unavailable(`${SOURCES.compactions}: this turn did not compact`)
    : exact(Math.max(...sizes), SOURCES.compactions);
}

function parseComposition(json: string): TurnDetail['promptComposition'] {
  return parseJsonArray(json).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.category !== 'string' || typeof entry.percent !== 'number')
      return [];
    return [
      {
        category: entry.category,
        label: typeof entry.label === 'string' ? entry.label : '',
        share: exact(entry.percent / 100, 'chatSessions promptTokenDetails'),
      },
    ];
  });
}

function countJsonArray(text: string): number {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** Validate the stored JSON again before it crosses into the webview. */
function safeToolArgs(json: string): string | null {
  try {
    const value: unknown = JSON.parse(json);
    return JSON.stringify(redactDeep(value), null, 2);
  } catch {
    return null;
  }
}
