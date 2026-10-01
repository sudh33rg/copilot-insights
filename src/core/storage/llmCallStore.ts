import { redactPayload } from '../privacy/captureLevel';
import { redactSecrets } from '../privacy/redact';
import type { DebugSessionLog } from '../debuglog/types';
import type { Database } from './database';

const IDS = 'SELECT value FROM json_each(:ids)';

export class LlmCallStore {
  constructor(private readonly database: Database) {}

  replaceSession(log: DebugSessionLog, file: string, now: number): void {
    const { db } = this.database;
    this.database.transaction(() => {
      const tombstone = db
        .prepare('SELECT kind FROM tombstones WHERE session_id = :id')
        .get({ id: log.sessionId }) as { kind: string } | undefined;
      if (tombstone?.kind === 'deleted') return;
      const cleared = tombstone?.kind === 'content-cleared';
      db.prepare('DELETE FROM llm_calls WHERE session_id = :id').run({ id: log.sessionId });
      db.prepare('DELETE FROM llm_tool_defs WHERE session_id = :id').run({ id: log.sessionId });
      const insertTool = db.prepare(
        'INSERT OR REPLACE INTO llm_tool_defs (session_id, name, chars) VALUES (:id, :name, :chars)',
      );
      for (const def of log.toolDefs ?? [])
        insertTool.run({ id: log.sessionId, name: def.name, chars: def.chars });
      db.prepare(
        `INSERT INTO llm_prompt_files (session_id, system_prompt_chars, tool_defs_chars)
         VALUES (:id, :system, :tools)
         ON CONFLICT(session_id) DO UPDATE SET system_prompt_chars = excluded.system_prompt_chars,
           tool_defs_chars = excluded.tool_defs_chars`,
      ).run({
        id: log.sessionId,
        system: log.systemPromptChars,
        tools: log.toolDefs === null ? null : log.toolDefs.reduce((total, def) => total + def.chars, 0),
      });
      db.prepare(
        'UPDATE llm_prompt_files SET content = :content, source = :source WHERE session_id = :id',
      ).run({
        id: log.sessionId,
        content: cleared || log.systemPromptContent == null ? null : redactSecrets(log.systemPromptContent),
        source: log.systemPromptFile,
      });
      if (!cleared)
        for (const def of log.toolDefinitions ?? [])
          db.prepare(
            'UPDATE llm_tool_defs SET definition = :content WHERE session_id = :id AND name = :name',
          ).run({ id: log.sessionId, name: def.name, content: redactPayload(def.content) });
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

  /** Tool names with definition sizes, or null when the tools file was not read. */
  getToolDefs(sessionId: string): { name: string; chars: number }[] | null {
    const { db } = this.database;
    const files = db
      .prepare('SELECT tool_defs_chars FROM llm_prompt_files WHERE session_id = :id')
      .get({ id: sessionId }) as { tool_defs_chars: number | null } | undefined;
    if (files?.tool_defs_chars == null) return null;
    return db
      .prepare('SELECT name, chars FROM llm_tool_defs WHERE session_id = :id ORDER BY name')
      .all({ id: sessionId }) as unknown as { name: string; chars: number }[];
  }

  getPromptFiles(sessionId: string): { systemPromptChars: number | null; toolDefsChars: number | null } {
    const row = this.database.db
      .prepare('SELECT system_prompt_chars, tool_defs_chars FROM llm_prompt_files WHERE session_id = :id')
      .get({ id: sessionId }) as
      { system_prompt_chars: number | null; tool_defs_chars: number | null } | undefined;
    return {
      systemPromptChars: row?.system_prompt_chars ?? null,
      toolDefsChars: row?.tool_defs_chars ?? null,
    };
  }

  deleteSessions(ids: readonly string[]): void {
    const params = { ids: JSON.stringify(ids) };
    this.database.transaction(() => {
      this.database.db.prepare(`DELETE FROM llm_calls WHERE session_id IN (${IDS})`).run(params);
      this.database.db.prepare(`DELETE FROM debug_sessions WHERE session_id IN (${IDS})`).run(params);
      this.database.db.prepare(`DELETE FROM llm_tool_defs WHERE session_id IN (${IDS})`).run(params);
      this.database.db.prepare(`DELETE FROM llm_prompt_files WHERE session_id IN (${IDS})`).run(params);
    });
  }
}
