import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { ObservationStore, type SnapshotInput } from '../storage/observationStore';
import { getSessionOutcomes } from './sessionOutcomes';

const snapshot = (overrides: Partial<SnapshotInput>): SnapshotInput => ({
  sessionId: 'fx-auto-1',
  kind: 'start',
  repoRoot: '/repo',
  head: 'h1',
  takenAt: 10,
  files: [],
  ...overrides,
});

describe('getSessionOutcomes — lines changed', () => {
  it('is unavailable when VS Code never observed the session', () => {
    const { database } = seededStore();
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    expect(outcomes.linesAdded).toEqual({
      value: null,
      provenance: {
        kind: 'unavailable',
        source: 'no git snapshot: VS Code was not observing this session',
      },
    });
    expect(outcomes.linesRemoved.value).toBeNull();
  });

  it('derives growth of the working-tree diff between the first and latest observation', () => {
    const { database } = seededStore();
    const observations = new ObservationStore(database);
    observations.saveSnapshot(snapshot({ files: [{ path: '/repo/a.ts', added: 2, removed: 1 }] }));
    observations.saveSnapshot(
      snapshot({ kind: 'latest', takenAt: 20, files: [{ path: '/repo/a.ts', added: 9, removed: 3 }] }),
    );
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    expect(outcomes.linesAdded.value).toBe(7);
    expect(outcomes.linesRemoved.value).toBe(2);
    expect(outcomes.linesAdded.provenance.kind).toBe('derived');
    expect(outcomes.linesAdded.provenance.source).toContain('new untracked text files');
  });

  it('is unavailable, not zero, when HEAD moved during the session', () => {
    const { database } = seededStore();
    const observations = new ObservationStore(database);
    observations.saveSnapshot(snapshot({}));
    observations.saveSnapshot(snapshot({ kind: 'latest', head: 'h2', takenAt: 20 }));
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    expect(outcomes.linesAdded).toEqual({
      value: null,
      provenance: {
        kind: 'unavailable',
        source: 'HEAD changed during the session; see linked commits',
      },
    });
  });

  it('is unavailable when only the baseline exists', () => {
    const { database } = seededStore();
    new ObservationStore(database).saveSnapshot(snapshot({}));
    expect(getSessionOutcomes(database, 'fx-auto-1').linesAdded.value).toBeNull();
  });
});

describe('getSessionOutcomes — edit outcomes and survival', () => {
  function withEvents(events: [number, string, string][]) {
    const { database } = seededStore();
    database.db.exec('DELETE FROM file_events');
    const insert = database.db.prepare(
      "INSERT INTO file_events (session_id, turn_idx, seq, path, action, source) VALUES ('fx-auto-1', :i, :q, :p, :a, 't')",
    );
    events.forEach(([i, p, a], q) => insert.run({ i, q, p, a }));
    return database;
  }

  it('is unavailable, not zero, when Copilot reported no keep/undo events', () => {
    const outcomes = getSessionOutcomes(withEvents([[1, '/r/a.ts', 'edited']]), 'fx-auto-1');
    for (const measured of [
      outcomes.editsKept,
      outcomes.editsUndone,
      outcomes.editsUserModified,
      outcomes.editKeepRate,
    ]) {
      expect(measured.value).toBeNull();
      expect(measured.provenance).toEqual({
        kind: 'unavailable',
        source: 'Copilot reported no keep/undo events for this session',
      });
    }
  });

  it('counts Copilot’s keep/undo/user-modified events exactly and derives the keep rate', () => {
    const outcomes = getSessionOutcomes(
      withEvents([
        [1, '/r/a.ts', 'edited'],
        [1, '/r/b.ts', 'edited'],
        [1, '/r/c.ts', 'edited'],
        [2, '/r/a.ts', 'kept'],
        [2, '/r/b.ts', 'undone'],
        [2, '/r/c.ts', 'user-modified'],
      ]),
      'fx-auto-1',
    );
    expect(outcomes.editsKept).toEqual({
      value: 1,
      provenance: { kind: 'exact', source: 'chatSessions.editedFileEvents' },
    });
    expect(outcomes.editsUndone.value).toBe(1);
    expect(outcomes.editsUserModified.value).toBe(1);
    expect(outcomes.editKeepRate.value).toBeCloseTo(1 / 3);
    expect(outcomes.editKeepRate.provenance.kind).toBe('derived');
  });

  it('reports later survival from the latest check of each edit, or unavailable without checks', () => {
    const database = withEvents([]);
    expect(getSessionOutcomes(database, 'fx-auto-1').laterSurvival.provenance.kind).toBe('unavailable');
    const observations = new ObservationStore(database);
    const base = { sessionId: 'fx-auto-1', turnIdx: 1, total: 4 };
    observations.saveSurvivalCheck({ ...base, path: '/r/a.ts', checkKind: '1h', checkedAt: 1, present: 4 });
    observations.saveSurvivalCheck({ ...base, path: '/r/a.ts', checkKind: '1d', checkedAt: 2, present: 2 });
    observations.saveSurvivalCheck({ ...base, path: '/r/b.ts', checkKind: '1h', checkedAt: 1, present: 2 });
    const { laterSurvival } = getSessionOutcomes(database, 'fx-auto-1');
    expect(laterSurvival.value).toBe(0.5);
    expect(laterSurvival.provenance).toEqual({
      kind: 'derived',
      source: 'fingerprints of inserted lines still present at the latest check',
    });
  });
});

describe('getSessionOutcomes — terminal and test results', () => {
  const T = 1_790_000_005_000; // inside turn 1 of the fixture session

  function withTerminal(
    calls: { hash: string | null }[],
    runs: Parameters<ObservationStore['addTerminalRun']>[0][],
  ) {
    const { database } = seededStore();
    const insert = database.db.prepare(
      `INSERT INTO tool_calls (session_id, turn_idx, seq, call_id, name, args, origin, status, command_hash)
       VALUES ('fx-auto-1', 1, :seq, :id, 'run_in_terminal', NULL, 'toolCallRound', 'unknown', :hash)`,
    );
    calls.forEach((call, index) =>
      insert.run({ seq: 100 + index, id: `t${String(index)}`, hash: call.hash }),
    );
    const observations = new ObservationStore(database);
    for (const run of runs) observations.addTerminalRun(run);
    return database;
  }
  const run = (
    hash: string,
    exitCode: number | null,
    kind: 'test' | 'build' | 'lint' | 'other' = 'other',
    at = T,
  ) => ({
    startedAt: at - 500,
    endedAt: at,
    exitCode,
    kind,
    commandHash: hash,
  });
  const keys = ['terminalRuns', 'terminalFailures', 'testRuns', 'testFailures', 'lastTestPassed'] as const;

  it('is unavailable when no terminal activity was seen', () => {
    const outcomes = getSessionOutcomes(seededStore().database, 'fx-auto-1');
    for (const key of keys) {
      expect(outcomes[key]).toEqual({
        value: null,
        provenance: { kind: 'unavailable', source: 'no terminal activity observed' },
      });
    }
  });

  it('explains missing exit codes when Copilot ran commands but VS Code did not observe them', () => {
    const outcomes = getSessionOutcomes(withTerminal([{ hash: 'h1' }], []), 'fx-auto-1');
    for (const key of keys) {
      expect(outcomes[key].value).toBeNull();
      expect(outcomes[key].provenance.source).toBe(
        'terminal exit codes are only recorded while VS Code is open with shell integration',
      );
    }
  });

  it('counts matched runs and failures, derived, with no lower bound when every call was observed', () => {
    const outcomes = getSessionOutcomes(
      withTerminal(
        [{ hash: 'h1' }, { hash: 'h2' }],
        [run('h1', 1, 'test', T), run('h2', 0, 'build', T + 1000)],
      ),
      'fx-auto-1',
    );
    expect(outcomes.terminalRuns.value).toBe(2);
    expect(outcomes.terminalFailures.value).toBe(1);
    expect(outcomes.testRuns.value).toBe(1);
    expect(outcomes.testFailures.value).toBe(1);
    expect(outcomes.terminalRuns.provenance.kind).toBe('derived');
    expect(outcomes.terminalRuns.provenance.source).not.toContain('lower bound');
  });

  it('marks counts as a lower bound when fewer runs were observed than Copilot made', () => {
    const outcomes = getSessionOutcomes(
      withTerminal([{ hash: 'h1' }, { hash: 'h2' }], [run('h1', 0)]),
      'fx-auto-1',
    );
    expect(outcomes.terminalRuns.value).toBe(1);
    expect(outcomes.terminalRuns.provenance.source).toContain('lower bound');
  });

  it('counts a run without an exit code as a run but never as a failure', () => {
    const outcomes = getSessionOutcomes(
      withTerminal([{ hash: 'h1' }], [run('h1', null, 'test')]),
      'fx-auto-1',
    );
    expect(outcomes.terminalRuns.value).toBe(1);
    expect(outcomes.terminalFailures.value).toBe(0);
    expect(outcomes.testFailures.value).toBe(0);
    expect(outcomes.lastTestPassed.value).toBeNull();
    expect(outcomes.lastTestPassed.provenance.kind).toBe('unavailable');
  });

  it('reports whether the last test run with a known exit code passed', () => {
    const calls = [{ hash: 'h1' }, { hash: 'h2' }, { hash: 'h3' }];
    const failing = getSessionOutcomes(
      withTerminal(calls, [
        run('h1', 0, 'test', T),
        run('h2', 1, 'test', T + 1000),
        run('h3', null, 'test', T + 2000),
      ]),
      'fx-auto-1',
    );
    expect(failing.lastTestPassed.value).toBe(false);
    const passing = getSessionOutcomes(
      withTerminal(calls, [run('h1', 1, 'test', T), run('h2', 0, 'test', T + 1000)]),
      'fx-auto-1',
    );
    expect(passing.lastTestPassed).toMatchObject({ value: true, provenance: { kind: 'derived' } });
  });
});

describe('getSessionOutcomes — diagnostics delta', () => {
  function withEditedFiles(paths: string[]) {
    const { database } = seededStore();
    database.db.exec('DELETE FROM file_events');
    const insert = database.db.prepare(
      "INSERT INTO file_events (session_id, turn_idx, seq, path, action, source) VALUES ('fx-auto-1', 1, :q, :p, 'edited', 't')",
    );
    paths.forEach((p, q) => insert.run({ q, p }));
    return { database, observations: new ObservationStore(database) };
  }
  const NOT_OBSERVED = 'diagnostics were not observed before and after this session';

  it('is unavailable when diagnostics were never observed', () => {
    const { database } = withEditedFiles(['/r/a.ts']);
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    for (const measured of [outcomes.errorsDelta, outcomes.warningsDelta]) {
      expect(measured).toEqual({ value: null, provenance: { kind: 'unavailable', source: NOT_OBSERVED } });
    }
  });

  it('is unavailable when only the baseline exists', () => {
    const { database, observations } = withEditedFiles(['/r/a.ts']);
    observations.saveDiagnostics('fx-auto-1', 'start', []);
    expect(getSessionOutcomes(database, 'fx-auto-1').errorsDelta.value).toBeNull();
  });

  it('derives the change over edited files, and a clean baseline is a real zero not a missing snapshot', () => {
    const { database, observations } = withEditedFiles(['/r/a.ts']);
    observations.saveDiagnostics('fx-auto-1', 'start', []);
    observations.saveDiagnostics('fx-auto-1', 'latest', [
      { path: '/r/a.ts', errors: 2, warnings: 1 },
      { path: '/r/unrelated.ts', errors: 40, warnings: 0 },
    ]);
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    expect(outcomes.errorsDelta).toEqual({
      value: 2,
      provenance: {
        kind: 'derived',
        source: 'VS Code diagnostics for edited files at first vs latest observation',
      },
    });
    expect(outcomes.warningsDelta.value).toBe(1);
  });

  it('can be negative when the edits fixed problems', () => {
    const { database, observations } = withEditedFiles(['/r/a.ts']);
    observations.saveDiagnostics('fx-auto-1', 'start', [{ path: '/r/a.ts', errors: 3, warnings: 0 }]);
    observations.saveDiagnostics('fx-auto-1', 'latest', []);
    expect(getSessionOutcomes(database, 'fx-auto-1').errorsDelta.value).toBe(-3);
  });

  it('is unavailable when a snapshot was cut short, because missing files would read as zero problems', () => {
    const { database, observations } = withEditedFiles(['/r/a.ts']);
    observations.saveDiagnostics('fx-auto-1', 'start', [], true);
    observations.saveDiagnostics('fx-auto-1', 'latest', []);
    expect(getSessionOutcomes(database, 'fx-auto-1').errorsDelta).toEqual({
      value: null,
      provenance: {
        kind: 'unavailable',
        source: 'a diagnostics snapshot was incomplete (too many files with problems)',
      },
    });
  });

  it('is unavailable when the session edited no files', () => {
    const { database, observations } = withEditedFiles([]);
    observations.saveDiagnostics('fx-auto-1', 'start', []);
    observations.saveDiagnostics('fx-auto-1', 'latest', []);
    expect(getSessionOutcomes(database, 'fx-auto-1').errorsDelta.value).toBeNull();
  });
});

describe('getSessionOutcomes — linked commits', () => {
  const link = (hash: string, committedAt: number) => ({
    hash,
    committedAt,
    overlapFiles: 2,
    editedFiles: 3,
    linkedAt: 1,
  });

  it('is an empty list when no commit was linked', () => {
    expect(getSessionOutcomes(seededStore().database, 'fx-auto-1').commits).toEqual([]);
  });

  it('lists linked commits with the session credits split evenly across them', () => {
    const { database } = seededStore();
    new ObservationStore(database).replaceSessionCommits('fx-auto-1', [link('c1', 10), link('c2', 20)]);
    const { commits } = getSessionOutcomes(database, 'fx-auto-1');
    expect(
      commits.map((commit) => [commit.hash, commit.committedAt, commit.overlapFiles, commit.editedFiles]),
    ).toEqual([
      ['c1', 10, 2, 3],
      ['c2', 20, 2, 3],
    ]);
    expect(commits[0]?.credits.value).toBeCloseTo(1.626141 / 2);
    expect(commits[0]?.credits.provenance).toEqual({
      kind: 'derived',
      source: 'session credits split evenly across the commits each session links to',
    });
  });

  it('has unavailable credits when the session reported none', () => {
    const { database } = seededStore();
    new ObservationStore(database).replaceSessionCommits('fx-byok-1', [link('c1', 10)]);
    const commit = getSessionOutcomes(database, 'fx-byok-1').commits[0];
    expect(commit?.credits.value).toBeNull();
    expect(commit?.credits.provenance.kind).toBe('unavailable');
  });
});
