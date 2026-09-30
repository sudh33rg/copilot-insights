import type { StatementSync } from 'node:sqlite';
import type { NormalizedSession, NormalizedTurn } from '../ingest/types';
import { SUMMARY_LIMITS, type CaptureLevel } from '../privacy/captureLevel';
import { localDay } from '../time';
import type { Database, SqlValue } from './database';
import { OBSERVATION_SESSION_TABLES } from './observationStore';

export interface SessionFilter {
  fromDay?: string;
  toDay?: string;
  workspace?: string;
}

export interface StoredToolCall {
  name: string;
  args: unknown;
  origin: string;
  status: string;
}

export interface StoredFileEvent {
  path: string;
  action: string;
  source: string;
}

export interface StoredTurn {
  index: number;
  day: string | null;
  state: string;
  systemInitiated: boolean;
  userText: string | null;
  assistantText: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  selectionMode: string;
  modelHost: string;
  promptTokens: number | null;
  completionTokens: number | null;
  credits: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  toolCalls: StoredToolCall[];
  fileEvents: StoredFileEvent[];
}

export interface StoredSession {
  id: string;
  workspace: string;
  title: string | null;
  day: string;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  captureLevel: string;
  turns: StoredTurn[];
}

const SESSION_COLUMNS = [
  'id',
  'source_file',
  'workspace',
  'workspace_path',
  'title',
  'location',
  'started_at',
  'ended_at',
  'active_ms',
  'day',
  'capture_level',
  'unknown_part_kinds',
  'unknown_request_keys',
  'invalid_requests',
  'ingested_at',
] as const;
const TURN_COLUMNS = [
  'session_id',
  'idx',
  'request_id',
  'response_id',
  'started_at',
  'ended_at',
  'elapsed_ms',
  'day',
  'state',
  'system_initiated',
  'hidden',
  'mode',
  'user_text',
  'assistant_text',
  'requested_model',
  'resolved_model',
  'resolved_model_source',
  'selection_mode',
  'selection_source',
  'model_host',
  'prompt_tokens',
  'completion_tokens',
  'credits',
  'prompt_composition',
  'reasoning_blocks',
  'reasoning_ms',
  'tool_rounds',
  'tool_input_retries',
  'max_tool_calls_exceeded',
  'compactions',
  'error_code',
  'error_message',
] as const;
const TOOL_COLUMNS = [
  'session_id',
  'turn_idx',
  'seq',
  'call_id',
  'name',
  'args',
  'origin',
  'status',
  'command_hash',
] as const;
const FILE_COLUMNS = ['session_id', 'turn_idx', 'seq', 'path', 'action', 'source'] as const;
const FINGERPRINT_COLUMNS = ['session_id', 'turn_idx', 'path', 'hashes'] as const;

type Row<C extends readonly string[]> = Record<C[number], SqlValue>;

// Pass id lists as one JSON parameter: no dynamic SQL, no parameter-count limits.
const IDS = 'SELECT value FROM json_each(:ids)';

export class SessionStore {
  private readonly statements: {
    deleteSession: StatementSync;
    insertSession: StatementSync;
    insertTurn: StatementSync;
    insertTool: StatementSync;
    insertFile: StatementSync;
    insertFingerprints: StatementSync;
  };

  constructor(private readonly database: Database) {
    const { db } = database;
    this.statements = {
      deleteSession: db.prepare('DELETE FROM sessions WHERE id = :id'),
      insertSession: db.prepare(insertSql('sessions', SESSION_COLUMNS)),
      insertTurn: db.prepare(insertSql('turns', TURN_COLUMNS)),
      insertTool: db.prepare(insertSql('tool_calls', TOOL_COLUMNS)),
      insertFile: db.prepare(insertSql('file_events', FILE_COLUMNS)),
      insertFingerprints: db.prepare(insertSql('edit_fingerprints', FINGERPRINT_COLUMNS)),
    };
  }

  /** Inserts or fully replaces a session (turns, tool calls and file events cascade). */
  replaceSession(session: NormalizedSession, captureLevel: CaptureLevel, ingestedAt: number): void {
    this.database.transaction(() => {
      this.statements.deleteSession.run({ id: session.id });
      this.statements.insertSession.run(sessionRow(session, captureLevel, ingestedAt));
      for (const turn of session.turns) {
        this.statements.insertTurn.run(turnRow(session.id, turn));
        for (const [seq, call] of turn.toolCalls.entries()) {
          const row: Row<typeof TOOL_COLUMNS> = {
            session_id: session.id,
            turn_idx: turn.index,
            seq,
            call_id: call.callId,
            name: call.name,
            args: call.args === null ? null : JSON.stringify(call.args),
            origin: call.origin,
            status: call.status,
            command_hash: call.commandHash,
          };
          this.statements.insertTool.run(row);
        }
        for (const [seq, event] of turn.fileEvents.entries()) {
          const row: Row<typeof FILE_COLUMNS> = {
            session_id: session.id,
            turn_idx: turn.index,
            seq,
            path: event.path,
            action: event.action,
            source: event.source,
          };
          this.statements.insertFile.run(row);
        }
        for (const entry of turn.editFingerprints) {
          const row: Row<typeof FINGERPRINT_COLUMNS> = {
            session_id: session.id,
            turn_idx: turn.index,
            path: entry.path,
            hashes: JSON.stringify(entry.hashes),
          };
          this.statements.insertFingerprints.run(row);
        }
      }
    });
  }

  getSession(id: string): StoredSession | null {
    const { db } = this.database;
    // node:sqlite rows are Record<string, SQLOutputValue>; row interfaces describe our schema.
    const session = db.prepare('SELECT * FROM sessions WHERE id = :id').get({ id }) as unknown as
      SessionRow | undefined;
    if (session === undefined) return null;
    const turns = db
      .prepare('SELECT * FROM turns WHERE session_id = :id ORDER BY idx')
      .all({ id }) as unknown as TurnRow[];
    const tools = db
      .prepare('SELECT * FROM tool_calls WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as ToolRow[];
    const files = db
      .prepare('SELECT * FROM file_events WHERE session_id = :id ORDER BY turn_idx, seq')
      .all({ id }) as unknown as FileRow[];
    return {
      id: session.id,
      workspace: session.workspace,
      title: session.title,
      day: session.day,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      activeMs: session.active_ms,
      captureLevel: session.capture_level,
      turns: turns.map((turn) => ({
        index: turn.idx,
        day: turn.day,
        state: turn.state,
        systemInitiated: turn.system_initiated === 1,
        userText: turn.user_text,
        assistantText: turn.assistant_text,
        requestedModel: turn.requested_model,
        resolvedModel: turn.resolved_model,
        selectionMode: turn.selection_mode,
        modelHost: turn.model_host,
        promptTokens: turn.prompt_tokens,
        completionTokens: turn.completion_tokens,
        credits: turn.credits,
        errorCode: turn.error_code,
        errorMessage: turn.error_message,
        toolCalls: tools
          .filter((tool) => tool.turn_idx === turn.idx)
          .map((tool) => ({
            name: tool.name,
            args: tool.args === null ? null : (JSON.parse(tool.args) as unknown),
            origin: tool.origin,
            status: tool.status,
          })),
        fileEvents: files
          .filter((file) => file.turn_idx === turn.idx)
          .map((file) => ({ path: file.path, action: file.action, source: file.source })),
      })),
    };
  }

  listSessionIds(filter: SessionFilter = {}): string[] {
    const where: string[] = [];
    const params: Record<string, SqlValue> = {};
    if (filter.fromDay !== undefined) {
      where.push('day >= :fromDay');
      params.fromDay = filter.fromDay;
    }
    if (filter.toDay !== undefined) {
      where.push('day <= :toDay');
      params.toDay = filter.toDay;
    }
    if (filter.workspace !== undefined) {
      where.push('workspace = :workspace');
      params.workspace = filter.workspace;
    }
    const sql = `SELECT id FROM sessions${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at`;
    return (this.database.db.prepare(sql).all(params) as unknown as { id: string }[]).map((row) => row.id);
  }

  deleteSessions(ids: readonly string[]): void {
    this.database.db.prepare(`DELETE FROM sessions WHERE id IN (${IDS})`).run({ ids: JSON.stringify(ids) });
  }

  /** Removes all conversation content; telemetry, models and file paths remain. */
  clearContent(ids: readonly string[]): void {
    const { db } = this.database;
    const params = { ids: JSON.stringify(ids) };
    this.database.transaction(() => {
      db.prepare(
        `UPDATE turns SET user_text = NULL, assistant_text = NULL, error_message = NULL WHERE session_id IN (${IDS})`,
      ).run(params);
      db.prepare(`UPDATE tool_calls SET args = NULL, command_hash = NULL WHERE session_id IN (${IDS})`).run(
        params,
      );
      db.prepare(`DELETE FROM edit_fingerprints WHERE session_id IN (${IDS})`).run(params);
      db.prepare(`DELETE FROM session_analysis WHERE session_id IN (${IDS})`).run(params);
      db.prepare(`UPDATE sessions SET title = NULL, capture_level = 'metrics' WHERE id IN (${IDS})`).run(
        params,
      );
    });
  }

  /**
   * Applies a lower capture level to content already stored, including sessions whose Copilot source file
   * no longer exists (a re-scan cannot reach those).
   */
  downgradeStoredContent(level: CaptureLevel): void {
    if (level === 'full') return;
    if (level === 'metrics') {
      const ids = (
        this.database.db
          .prepare("SELECT id FROM sessions WHERE capture_level <> 'metrics'")
          .all() as unknown as { id: string }[]
      ).map((row) => row.id);
      this.clearContent(ids);
      return;
    }
    const cut = (column: string, limit: number): string =>
      `${column} = CASE WHEN length(${column}) > ${limit} THEN substr(${column}, 1, ${limit - 1}) || '…' ELSE ${column} END`;
    const full = "SELECT id FROM sessions WHERE capture_level = 'full'";
    this.database.transaction(() => {
      const { db } = this.database;
      db.exec(
        `UPDATE turns SET ${cut('user_text', SUMMARY_LIMITS.user)}, ${cut('assistant_text', SUMMARY_LIMITS.assistant)}, ${cut('error_message', SUMMARY_LIMITS.error)} WHERE session_id IN (${full})`,
      );
      db.exec(`UPDATE tool_calls SET args = NULL WHERE session_id IN (${full})`);
      db.exec(`DELETE FROM session_analysis WHERE session_id IN (${full})`);
      db.exec(
        `UPDATE sessions SET ${cut('title', SUMMARY_LIMITS.title)}, capture_level = 'summaries' WHERE capture_level = 'full'`,
      );
    });
  }

  /** Deletes sessions whose day is before `day`; returns how many were removed. */
  purgeBefore(day: string): number {
    const params = { day };
    const { db } = this.database;
    db.prepare('DELETE FROM llm_calls WHERE session_id IN (SELECT id FROM sessions WHERE day < :day)').run(
      params,
    );
    db.prepare(
      'DELETE FROM debug_sessions WHERE session_id IN (SELECT id FROM sessions WHERE day < :day)',
    ).run(params);
    for (const table of ['llm_tool_defs', 'llm_prompt_files']) {
      db.prepare(`DELETE FROM ${table} WHERE session_id IN (SELECT id FROM sessions WHERE day < :day)`).run(
        params,
      );
    }
    for (const table of OBSERVATION_SESSION_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE session_id IN (SELECT id FROM sessions WHERE day < :day)`).run(
        params,
      );
    }
    return Number(db.prepare('DELETE FROM sessions WHERE day < :day').run(params).changes);
  }

  counts(): { sessions: number; turns: number } {
    const row = this.database.db
      .prepare('SELECT (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM turns) AS turns')
      .get() as { sessions: number; turns: number };
    return { sessions: row.sessions, turns: row.turns };
  }
}

function insertSql(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => `:${column}`).join(', ')})`;
}

function bit(value: boolean): number {
  return value ? 1 : 0;
}

function sessionRow(
  session: NormalizedSession,
  captureLevel: CaptureLevel,
  ingestedAt: number,
): Row<typeof SESSION_COLUMNS> {
  return {
    id: session.id,
    source_file: session.sourceFile,
    workspace: session.workspace,
    workspace_path: session.workspacePath,
    title: session.title,
    location: session.location,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    active_ms: session.activeMs,
    day: localDay(session.startedAt),
    capture_level: captureLevel,
    unknown_part_kinds: JSON.stringify(session.diagnostics.unknownPartKinds),
    unknown_request_keys: JSON.stringify(session.diagnostics.unknownRequestKeys),
    invalid_requests: session.diagnostics.invalidRequests,
    ingested_at: ingestedAt,
  };
}

function turnRow(sessionId: string, turn: NormalizedTurn): Row<typeof TURN_COLUMNS> {
  return {
    session_id: sessionId,
    idx: turn.index,
    request_id: turn.requestId,
    response_id: turn.responseId,
    started_at: turn.startedAt,
    ended_at: turn.endedAt,
    elapsed_ms: turn.elapsedMs,
    day: turn.startedAt === null ? null : localDay(turn.startedAt),
    state: turn.state,
    system_initiated: bit(turn.systemInitiated),
    hidden: bit(turn.hidden),
    mode: turn.mode,
    user_text: turn.userText,
    assistant_text: turn.assistantText,
    requested_model: turn.requestedModel,
    resolved_model: turn.resolvedModel,
    resolved_model_source: turn.resolvedModelSource,
    selection_mode: turn.selectionMode,
    selection_source: turn.selectionSource,
    model_host: turn.modelHost,
    prompt_tokens: turn.promptTokens,
    completion_tokens: turn.completionTokens,
    credits: turn.credits,
    prompt_composition: JSON.stringify(turn.promptComposition),
    reasoning_blocks: turn.reasoningBlocks,
    reasoning_ms: turn.reasoningMs,
    tool_rounds: turn.toolRounds,
    tool_input_retries: turn.toolInputRetries,
    max_tool_calls_exceeded: bit(turn.maxToolCallsExceeded),
    compactions: JSON.stringify(turn.compactions),
    error_code: turn.errorCode,
    error_message: turn.errorMessage,
  };
}

interface SessionRow {
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
  day: string | null;
  state: string;
  system_initiated: number;
  user_text: string | null;
  assistant_text: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  selection_mode: string;
  model_host: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  credits: number | null;
  error_code: string | null;
  error_message: string | null;
}

interface ToolRow {
  turn_idx: number;
  name: string;
  args: string | null;
  origin: string;
  status: string;
}

interface FileRow {
  turn_idx: number;
  path: string;
  action: string;
  source: string;
}
