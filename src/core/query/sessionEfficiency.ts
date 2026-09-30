import type { Efficiency, TurnDetail } from '../../shared/dto';
import { contextBloat } from '../efficiency/contextBloat';
import { costDrivers } from '../efficiency/costDrivers';
import type { Database } from '../storage/database';

/** Everything that explains a session's cost and how to do better; see docs/superpowers/plans (Phase 5). */
export function getSessionEfficiency(
  database: Pick<Database, 'db'>,
  turns: readonly TurnDetail[],
  sessionId: string,
): Efficiency {
  return {
    drivers: costDrivers(turns),
    findings: [...contextFindings(database, turns, sessionId)],
  };
}

function contextFindings(database: Pick<Database, 'db'>, turns: readonly TurnDetail[], sessionId: string) {
  const { db } = database;
  const files = db
    .prepare('SELECT system_prompt_chars, tool_defs_chars FROM llm_prompt_files WHERE session_id = :id')
    .get({ id: sessionId }) as
    { system_prompt_chars: number | null; tool_defs_chars: number | null } | undefined;
  const toolDefs =
    files?.tool_defs_chars == null
      ? null
      : (db
          .prepare('SELECT name, chars FROM llm_tool_defs WHERE session_id = :id')
          .all({ id: sessionId }) as unknown as { name: string; chars: number }[]);
  const used = new Set(
    (
      db
        .prepare('SELECT DISTINCT name FROM tool_calls WHERE session_id = :id')
        .all({ id: sessionId }) as unknown as {
        name: string;
      }[]
    ).map((row) => row.name),
  );
  const llmRequests = (
    db
      .prepare("SELECT count(*) AS n FROM llm_calls WHERE session_id = :id AND role != 'COPILOT_INTERNAL'")
      .get({ id: sessionId }) as { n: number }
  ).n;
  return contextBloat({
    toolDefs,
    systemPromptChars: files?.system_prompt_chars ?? null,
    usedToolNames: used,
    requests: llmRequests > 0 ? llmRequests : turns.length,
  });
}
