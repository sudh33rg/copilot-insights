import type { Outcomes } from '../../shared/dto';
import { derived, exact, unavailable, type Measured } from '../../shared/provenance';
import { diffSnapshots } from '../git/snapshots';
import { TERMINAL_TOOL } from '../ingest/toolNames';
import { attributeEditOutcomes } from '../outcomes/editOutcomes';
import { matchTerminalRuns, SLACK_AFTER_MS, SYSTEM_LEAD_MS, type MatchTurn } from '../outcomes/terminalMatch';
import type { Database } from '../storage/database';
import { ObservationReader, type StoredSnapshot, type SurvivalCheck } from '../storage/observationStore';

const GIT_SOURCE =
  'git working-tree diff between first and latest observation while VS Code was open (tracked files only)';

/** Everything the extension observed about what a session achieved. Missing evidence is `unavailable`, never 0. */
export function getSessionOutcomes(database: Pick<Database, 'db'>, id: string): Outcomes {
  const observations = new ObservationReader(database);
  const lines = linesChanged(observations.getSnapshots(id, 'start'), observations.getSnapshots(id, 'latest'));
  const edits = editOutcomes(database, id);
  return {
    linesAdded: lineCount(lines, 'added'),
    linesRemoved: lineCount(lines, 'removed'),
    ...edits,
    laterSurvival: laterSurvival(observations.survivalChecks(id)),
    ...terminalOutcomes(database, observations, id),
  };
}

const NO_EDIT_EVENTS = 'Copilot reported no keep/undo events for this session';
const EDIT_SOURCE = 'chatSessions.editedFileEvents';

/** Copilot only emits keep/undo events when the user acted, so "none" is unknown rather than zero. */
function editOutcomes(
  database: Pick<Database, 'db'>,
  id: string,
): Pick<Outcomes, 'editsKept' | 'editsUndone' | 'editsUserModified' | 'editKeepRate'> {
  const turns = database.db
    .prepare('SELECT idx FROM turns WHERE session_id = :id ORDER BY idx')
    .all({ id }) as unknown as { idx: number }[];
  const events = database.db
    .prepare('SELECT turn_idx, path, action FROM file_events WHERE session_id = :id ORDER BY turn_idx, seq')
    .all({ id }) as unknown as { turn_idx: number; path: string; action: string }[];
  const outcomes = attributeEditOutcomes(
    turns.map((turn) => ({
      index: turn.idx,
      model: null,
      fileEvents: events.filter((event) => event.turn_idx === turn.idx),
    })),
  );
  if (outcomes.length === 0) {
    const none = <T>() => unavailable<T>(NO_EDIT_EVENTS);
    return { editsKept: none(), editsUndone: none(), editsUserModified: none(), editKeepRate: none() };
  }
  const count = (kind: string) => outcomes.filter((outcome) => outcome.outcome === kind).length;
  return {
    editsKept: exact(count('kept'), EDIT_SOURCE),
    editsUndone: exact(count('undone'), EDIT_SOURCE),
    editsUserModified: exact(count('user-modified'), EDIT_SOURCE),
    editKeepRate: derived(
      count('kept') / outcomes.length,
      'kept ÷ (kept + undone + user-modified) from Copilot editedFileEvents',
    ),
  };
}

/** Share of inserted lines still present, from each edit's most recent check. */
function laterSurvival(checks: readonly SurvivalCheck[]): Measured<number> {
  const latest = new Map<string, SurvivalCheck>();
  for (const check of checks) {
    const key = `${String(check.turnIdx)}\0${check.path}`;
    const seen = latest.get(key);
    if (seen === undefined || check.checkedAt >= seen.checkedAt) latest.set(key, check);
  }
  let present = 0;
  let total = 0;
  for (const check of latest.values()) {
    present += check.present;
    total += check.total;
  }
  return total === 0
    ? unavailable('no survival check has run for this session yet')
    : derived(present / total, 'fingerprints of inserted lines still present at the latest check');
}

type Lines = { added: number; removed: number } | { unavailable: string };

function lineCount(lines: Lines, field: 'added' | 'removed'): Measured<number> {
  return 'unavailable' in lines ? unavailable(lines.unavailable) : derived(lines[field], GIT_SOURCE);
}

function linesChanged(start: readonly StoredSnapshot[], latest: readonly StoredSnapshot[]): Lines {
  if (start.length === 0) return { unavailable: 'no git snapshot: VS Code was not observing this session' };
  if (latest.length === 0) return { unavailable: 'only one git observation so far' };
  const diff = diffSnapshots(start, latest);
  if (diff !== null) return diff;
  const headMoved = start.some((from) =>
    latest.some((to) => to.repoRoot === from.repoRoot && to.head !== from.head),
  );
  return {
    unavailable: headMoved
      ? 'HEAD changed during the session; see linked commits'
      : 'no repository was observed at both the start and the latest check',
  };
}

type TerminalOutcomes = Pick<
  Outcomes,
  'terminalRuns' | 'terminalFailures' | 'testRuns' | 'testFailures' | 'lastTestPassed'
>;

function terminalOutcomes(
  database: Pick<Database, 'db'>,
  observations: ObservationReader,
  id: string,
): TerminalOutcomes {
  const turns = matchTurns(database, id);
  const starts = turns.flatMap((turn) => (turn.startedAt === null ? [] : [turn.startedAt]));
  const ends = turns.flatMap((turn) => (turn.endedAt === null ? [] : [turn.endedAt]));
  const runs =
    starts.length === 0 || ends.length === 0
      ? []
      : observations.terminalRunsBetween(
          Math.min(...starts) - SYSTEM_LEAD_MS,
          Math.max(...ends) + SLACK_AFTER_MS,
        );
  const { matched, terminalCallCount } = matchTerminalRuns(turns, runs);

  if (terminalCallCount === 0 && matched.length === 0)
    return allTerminal(unavailable('no terminal activity observed'));
  if (matched.length === 0) {
    return allTerminal(
      unavailable('terminal exit codes are only recorded while VS Code is open with shell integration'),
    );
  }
  const partial = matched.length < terminalCallCount;
  const source = `terminal runs observed by VS Code shell integration and matched to this session; a run without an exit code counts as a run, never as a failure${
    partial
      ? ` (lower bound: ${String(matched.length)} of ${String(terminalCallCount)} terminal tool calls were observed)`
      : ''
  }`;
  const failed = (run: { exitCode: number | null }) => run.exitCode !== null && run.exitCode !== 0;
  const all = matched.map((entry) => entry.run);
  const tests = all.filter((run) => run.kind === 'test');
  const lastKnownTest = [...tests].reverse().find((run) => run.exitCode !== null);
  return {
    terminalRuns: derived(all.length, source),
    terminalFailures: derived(all.filter(failed).length, source),
    testRuns: derived(tests.length, source),
    testFailures: derived(tests.filter(failed).length, source),
    lastTestPassed:
      lastKnownTest === undefined
        ? unavailable('no test run with a known exit code was observed')
        : derived(lastKnownTest.exitCode === 0, source),
  };
}

function allTerminal(none: Measured<never>): TerminalOutcomes {
  return {
    terminalRuns: none,
    terminalFailures: none,
    testRuns: none,
    testFailures: none,
    lastTestPassed: none,
  };
}

function matchTurns(database: Pick<Database, 'db'>, id: string): MatchTurn[] {
  const turns = database.db
    .prepare(
      'SELECT idx, started_at, ended_at, system_initiated FROM turns WHERE session_id = :id ORDER BY idx',
    )
    .all({ id }) as unknown as {
    idx: number;
    started_at: number | null;
    ended_at: number | null;
    system_initiated: number;
  }[];
  const calls = database.db
    .prepare(
      'SELECT turn_idx, name, command_hash FROM tool_calls WHERE session_id = :id ORDER BY turn_idx, seq',
    )
    .all({ id }) as unknown as { turn_idx: number; name: string; command_hash: string | null }[];
  return turns.map((turn) => ({
    index: turn.idx,
    startedAt: turn.started_at,
    endedAt: turn.ended_at,
    systemInitiated: turn.system_initiated === 1,
    terminalCalls: calls
      .filter((call) => call.turn_idx === turn.idx && TERMINAL_TOOL.test(call.name))
      .map((call) => ({ commandHash: call.command_hash })),
  }));
}
