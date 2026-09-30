import type { Diagnostics } from '../../shared/dto';
import type { Database } from '../storage/database';
import { CatalogStore } from '../storage/catalogStore';

export type ScanDiagnostics = Diagnostics['scan'];

/** Everything except the environment-dependent fields (`versions`, `debugLogging`), which the extension adds. */
export function getDiagnostics(
  database: Database,
  scan: ScanDiagnostics,
): Omit<Diagnostics, 'versions' | 'debugLogging'> {
  const { db } = database;
  const strings = (sql: string): string[] =>
    (db.prepare(sql).all() as unknown as { value: string }[]).map((row) => row.value);
  const index = db
    .prepare(
      `SELECT (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM turns) AS turns,
              (SELECT coalesce(sum(invalid_requests), 0) FROM sessions) AS invalid`,
    )
    .get() as unknown as { sessions: number; turns: number; invalid: number };
  const logs = db
    .prepare(
      'SELECT (SELECT count(*) FROM debug_sessions) AS sessions, (SELECT count(*) FROM llm_calls) AS calls',
    )
    .get() as unknown as { sessions: number; calls: number };
  const unknownNames = db
    .prepare(
      `SELECT coalesce(debug_name, '(unnamed)') AS name, count(*) AS count FROM llm_calls
        WHERE role = 'UNKNOWN' GROUP BY name ORDER BY count DESC, name`,
    )
    .all() as unknown as { name: string; count: number }[];
  return {
    scan,
    index: { sessions: index.sessions, turns: index.turns, invalidRequests: index.invalid },
    drift: {
      unknownPartKinds: strings(
        'SELECT DISTINCT j.value AS value FROM sessions s, json_each(s.unknown_part_kinds) j ORDER BY value',
      ),
      unknownRequestKeys: strings(
        'SELECT DISTINCT j.value AS value FROM sessions s, json_each(s.unknown_request_keys) j ORDER BY value',
      ),
    },
    debugLog: {
      sessionsWithLogs: logs.sessions,
      llmCalls: logs.calls,
      unknownDebugNames: unknownNames,
      copilotVersionsSeen: strings(
        'SELECT DISTINCT copilot_version AS value FROM debug_sessions WHERE copilot_version IS NOT NULL ORDER BY value',
      ),
    },
    catalog: new CatalogStore(database).stats(),
  };
}
