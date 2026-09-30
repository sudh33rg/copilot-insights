import { describe, expect, it } from 'vitest';
import { Database } from './database';
import { ObservationStore, type SnapshotInput } from './observationStore';

function newStore(now = 1000) {
  const database = new Database(':memory:');
  return { database, store: new ObservationStore(database, () => now) };
}

function snapshot(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    sessionId: 'a',
    kind: 'start',
    repoRoot: '/repo',
    head: 'abc123',
    takenAt: 10,
    files: [
      { path: '/repo/src/x.ts', added: 3, removed: 1 },
      { path: '/repo/src/y.ts', added: 0, removed: 4 },
    ],
    ...overrides,
  };
}

function count(database: Database, table: string): number {
  return (database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('ObservationStore', () => {
  it('round-trips snapshots with files; replacing latest leaves start untouched', () => {
    const { store } = newStore();
    store.saveSnapshot(snapshot());
    store.saveSnapshot(snapshot({ kind: 'latest', takenAt: 20, head: 'def456' }));
    store.saveSnapshot(
      snapshot({ kind: 'latest', takenAt: 30, files: [{ path: '/repo/src/z.ts', added: 9, removed: 0 }] }),
    );
    expect(store.getSnapshots('a', 'start')).toEqual([
      {
        repoRoot: '/repo',
        head: 'abc123',
        takenAt: 10,
        files: [
          { path: '/repo/src/x.ts', added: 3, removed: 1 },
          { path: '/repo/src/y.ts', added: 0, removed: 4 },
        ],
      },
    ]);
    const latest = store.getSnapshots('a', 'latest');
    expect(latest).toHaveLength(1);
    expect(latest[0]?.takenAt).toBe(30);
    expect(latest[0]?.files).toEqual([{ path: '/repo/src/z.ts', added: 9, removed: 0 }]);
  });

  it('groups files under the longest matching repo root', () => {
    const { store } = newStore();
    store.saveSnapshot(
      snapshot({ repoRoot: '/repo', files: [{ path: '/repo/top.ts', added: 1, removed: 0 }] }),
    );
    store.saveSnapshot(
      snapshot({ repoRoot: '/repo/nested', files: [{ path: '/repo/nested/deep.ts', added: 2, removed: 0 }] }),
    );
    const byRoot = Object.fromEntries(
      store.getSnapshots('a', 'start').map((s) => [s.repoRoot, s.files.map((f) => f.path)]),
    );
    expect(byRoot['/repo/nested']).toEqual(['/repo/nested/deep.ts']);
    expect(byRoot['/repo']).toEqual(['/repo/top.ts']);
  });

  it('round-trips diagnostics per kind', () => {
    const { store } = newStore();
    store.saveDiagnostics('a', 'start', [{ path: '/repo/x.ts', errors: 2, warnings: 1 }]);
    store.saveDiagnostics('a', 'latest', [{ path: '/repo/x.ts', errors: 0, warnings: 1 }]);
    store.saveDiagnostics('a', 'latest', [{ path: '/repo/x.ts', errors: 0, warnings: 0 }]);
    expect(store.getDiagnostics('a', 'start')).toEqual([{ path: '/repo/x.ts', errors: 2, warnings: 1 }]);
    expect(store.getDiagnostics('a', 'latest')).toEqual([{ path: '/repo/x.ts', errors: 0, warnings: 0 }]);
  });

  it('remembers that a diagnostics snapshot was taken even when it was empty (a clean workspace)', () => {
    const { store } = newStore();
    expect(store.hasDiagnostics('a', 'start')).toBe(false);
    store.saveDiagnostics('a', 'start', []);
    expect(store.hasDiagnostics('a', 'start')).toBe(true);
    expect(store.hasDiagnostics('a', 'latest')).toBe(false);
    expect(store.getDiagnostics('a', 'start')).toEqual([]);
    store.deleteSessions(['a']);
    expect(store.hasDiagnostics('a', 'start')).toBe(false);
  });

  it('returns terminal runs inclusive of both bounds and ordered by end time', () => {
    const { store } = newStore();
    const run = (endedAt: number, hash: string) => ({
      startedAt: endedAt - 1,
      endedAt,
      exitCode: 0,
      kind: 'test' as const,
      commandHash: hash,
    });
    store.addTerminalRun(run(30, 'c'));
    store.addTerminalRun(run(10, 'a'));
    store.addTerminalRun(run(20, 'b'));
    store.addTerminalRun(run(40, 'd'));
    expect(store.terminalRunsBetween(10, 30).map((r) => r.commandHash)).toEqual(['a', 'b', 'c']);
  });

  it('stores survival checks and session commits', () => {
    const { store } = newStore();
    const check = {
      sessionId: 'a',
      turnIdx: 0,
      path: '/repo/x.ts',
      checkKind: '1h' as const,
      checkedAt: 5,
      present: 3,
      total: 4,
    };
    store.saveSurvivalCheck(check);
    store.saveSurvivalCheck({ ...check, present: 2 });
    expect(store.survivalChecks('a')).toEqual([{ ...check, present: 2 }]);
    const link = { hash: 'h1', committedAt: 7, overlapFiles: 1, editedFiles: 2, linkedAt: 8 };
    store.replaceSessionCommits('a', [link]);
    store.replaceSessionCommits('a', [link, { ...link, hash: 'h2' }]);
    expect(store.sessionCommits('a').map((c) => c.hash)).toEqual(['h1', 'h2']);
  });

  it('deleteSessions removes only the named sessions rows', () => {
    const { store, database } = newStore();
    for (const id of ['a', 'b']) {
      store.saveSnapshot(snapshot({ sessionId: id }));
      store.saveDiagnostics(id, 'start', [{ path: '/repo/x.ts', errors: 1, warnings: 0 }]);
      store.saveSurvivalCheck({
        sessionId: id,
        turnIdx: 0,
        path: 'p',
        checkKind: '1h',
        checkedAt: 1,
        present: 1,
        total: 1,
      });
      store.replaceSessionCommits(id, [
        { hash: 'h', committedAt: 1, overlapFiles: 1, editedFiles: 1, linkedAt: 1 },
      ]);
    }
    store.deleteSessions(['a']);
    expect(store.getSnapshots('a', 'start')).toEqual([]);
    expect(store.getDiagnostics('a', 'start')).toEqual([]);
    expect(store.survivalChecks('a')).toEqual([]);
    expect(store.sessionCommits('a')).toEqual([]);
    expect(store.getSnapshots('b', 'start')).toHaveLength(1);
    expect(store.getDiagnostics('b', 'start')).toHaveLength(1);
    expect(store.survivalChecks('b')).toHaveLength(1);
    expect(store.sessionCommits('b')).toHaveLength(1);
    expect(count(database, 'git_snapshot_files')).toBe(2);
  });

  it('deleteAll also empties terminal runs', () => {
    const { store, database } = newStore();
    store.addTerminalRun({ startedAt: null, endedAt: 5, exitCode: null, kind: 'other', commandHash: 'h' });
    store.saveSnapshot(snapshot());
    store.deleteAll();
    expect(count(database, 'terminal_runs')).toBe(0);
    expect(count(database, 'git_snapshots')).toBe(0);
    expect(count(database, 'git_snapshot_files')).toBe(0);
  });

  it('pruneBefore drops terminal runs older than the cutoff', () => {
    const { store } = newStore();
    const run = (endedAt: number) => ({
      startedAt: null,
      endedAt,
      exitCode: 0,
      kind: 'build' as const,
      commandHash: String(endedAt),
    });
    store.addTerminalRun(run(5));
    store.addTerminalRun(run(15));
    store.pruneBefore(10);
    expect(store.terminalRunsBetween(0, 100).map((r) => r.endedAt)).toEqual([15]);
  });

  it('tracks the last change time, defaulting to zero', () => {
    const { store } = newStore();
    expect(store.lastChangeAt()).toBe(0);
    store.touch(5);
    expect(store.lastChangeAt()).toBe(5);
  });

  it('touches on every mutation using the injected clock', () => {
    const mutations: ((s: ObservationStore) => void)[] = [
      (s) => {
        s.saveSnapshot(snapshot());
      },
      (s) => {
        s.saveDiagnostics('a', 'start', []);
      },
      (s) => {
        s.addTerminalRun({ startedAt: null, endedAt: 1, exitCode: 0, kind: 'test', commandHash: 'h' });
      },
      (s) => {
        s.saveSurvivalCheck({
          sessionId: 'a',
          turnIdx: 0,
          path: 'p',
          checkKind: '1h',
          checkedAt: 1,
          present: 1,
          total: 1,
        });
      },
      (s) => {
        s.replaceSessionCommits('a', []);
      },
      (s) => {
        s.deleteSessions(['a']);
      },
      (s) => {
        s.deleteAll();
      },
      (s) => {
        s.pruneBefore(1);
      },
    ];
    for (const mutate of mutations) {
      const { store } = newStore(777);
      mutate(store);
      expect(store.lastChangeAt()).toBe(777);
    }
  });
});
