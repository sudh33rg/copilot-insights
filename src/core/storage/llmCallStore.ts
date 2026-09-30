import type { DebugSessionLog } from '../debuglog/types';
import type { Database } from './database';

const IDS = 'SELECT value FROM json_each(:ids)';

export class LlmCallStore {
  constructor(private readonly database: Database) {}

  replaceSession(log: DebugSessionLog, file: string, now: number): void {
    const { db } = this.database;
    this.database.transaction(() => {
      db.prepare('DELETE FROM llm_calls WHERE session_id = :id').run({ id: log.sessionId });
      const insert = db.prepare(
        `INSERT INTO llm_calls (session_id, span_id, response_id, started_at, duration_ms, model, debug_name, role,
           input_tokens, output_tokens, cached_tokens, ttft_ms, nano_aiu)
         VALUES (:sessionId, :spanId, :responseId, :startedAt, :durationMs, :model, :debugName, :role,
           :inputTokens, :outputTokens, :cachedTokens, :ttftMs, :nanoAiu)`,
      );
      for (const call of log.calls) insert.run({ ...call });
      db.prepare(
        `INSERT INTO debug_sessions (session_id, copilot_version, vscode_version, file, calls, bad_lines, ingested_at)
         VALUES (:id, :copilot, :vscode, :file, :calls, :bad, :now)
         ON CONFLICT(session_id) DO UPDATE SET copilot_version = excluded.copilot_version,
           vscode_version = excluded.vscode_version, file = excluded.file, calls = excluded.calls,
           bad_lines = excluded.bad_lines, ingested_at = excluded.ingested_at`,
      ).run({
        id: log.sessionId,
        copilot: log.copilotVersion,
        vscode: log.vscodeVersion,
        file,
        calls: log.calls.length,
        bad: log.badLines,
        now,
      });
    });
  }

  deleteSessions(ids: readonly string[]): void {
    const params = { ids: JSON.stringify(ids) };
    this.database.transaction(() => {
      this.database.db.prepare(`DELETE FROM llm_calls WHERE session_id IN (${IDS})`).run(params);
      this.database.db.prepare(`DELETE FROM debug_sessions WHERE session_id IN (${IDS})`).run(params);
    });
  }
}
