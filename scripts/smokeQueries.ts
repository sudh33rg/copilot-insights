// Loads normalized real sessions into an IN-MEMORY index and checks the query layer against totals computed
// directly from the parsed turns. Prints AGGREGATES ONLY (counts); never titles, text, paths or workspaces.
import type { NormalizedSession } from '../src/core/ingest/types';
import { applyCaptureLevel, type CaptureLevel } from '../src/core/privacy/captureLevel';
import { InsightsQueries } from '../src/core/query/insightsQueries';
import { Database } from '../src/core/storage/database';
import { SessionStore } from '../src/core/storage/sessionStore';
import type { SessionRow } from '../src/shared/dto';

function build(sessions: readonly NormalizedSession[], level: CaptureLevel): InsightsQueries {
  const database = new Database(':memory:');
  const store = new SessionStore(database);
  for (const session of sessions) store.replaceSession(applyCaptureLevel(session, level), level, 1);
  return new InsightsQueries(database);
}

function allRows(queries: InsightsQueries): SessionRow[] {
  const rows: SessionRow[] = [];
  for (;;) {
    const page = queries.listSessions({ offset: rows.length, limit: 100 });
    rows.push(...page.rows);
    if (page.rows.length === 0 || rows.length >= page.total) return rows;
  }
}

const kinds = (measures: readonly { provenance: { kind: string } }[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const measure of measures)
    counts[measure.provenance.kind] = (counts[measure.provenance.kind] ?? 0) + 1;
  return counts;
};

/** Returns a list of failures; an empty list means the query layer agrees with the parsed data. */
export function checkQueryLayer(parsed: readonly NormalizedSession[]): string[] {
  // A session id present in two files is stored once (last wins), exactly like the real index.
  const unique = [...new Map(parsed.map((session) => [session.id, session])).values()];
  const failures: string[] = [];
  const queries = build(unique, 'summaries');
  const rows = allRows(queries);

  if (rows.length !== unique.length)
    failures.push(`list has ${String(rows.length)} rows for ${String(unique.length)} sessions`);
  const turns = unique.flatMap((session) => session.turns);
  const expected = {
    input: turns.reduce((sum, turn) => sum + (turn.promptTokens ?? 0), 0),
    output: turns.reduce((sum, turn) => sum + (turn.completionTokens ?? 0), 0),
    credits: turns.reduce((sum, turn) => sum + (turn.credits ?? 0), 0),
  };
  const sum = (pick: (row: SessionRow) => number | null): number =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  if (sum((row) => row.inputTokens.value) !== expected.input)
    failures.push('input token totals differ from parsed turns');
  if (sum((row) => row.outputTokens.value) !== expected.output)
    failures.push('output token totals differ from parsed turns');
  if (Math.abs(sum((row) => row.credits.value) - expected.credits) > 1e-6)
    failures.push('credit totals differ from parsed turns');
  if (rows.some((row) => row.credits.provenance.kind === 'exact' && row.credits.value === null)) {
    failures.push('a row claims exact credits without a value');
  }

  const detailIds = rows.slice(0, 25).map((row) => row.id);
  const intents: Record<string, number> = {};
  for (const id of detailIds) {
    const detail = queries.getSession(id);
    if (detail === null) failures.push('a listed session could not be loaded');
    const intent = detail?.analysis?.intent.value ?? 'unavailable';
    intents[intent] = (intents[intent] ?? 0) + 1;
  }
  const metrics = build(unique, 'metrics');
  for (const id of detailIds) {
    const leaked = metrics
      .getSession(id)
      ?.turns.some((turn) => turn.userText !== null || turn.assistantText !== null);
    if (leaked === true) failures.push('conversation text present at the metrics capture level');
  }

  console.log(
    JSON.stringify(
      {
        queryLayer: {
          sessions: rows.length,
          inputTokenProvenance: kinds(rows.map((row) => row.inputTokens)),
          creditProvenance: kinds(rows.map((row) => row.credits)),
          intentHistogram: intents,
        },
      },
      null,
      2,
    ),
  );
  return failures;
}
