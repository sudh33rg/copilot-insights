import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import type { GitPort, GitRepo } from '../../core/git/types';
import { saltedHash } from '../../core/privacy/fingerprint';
import { ObservationStore, type DiagEntry } from '../../core/storage/observationStore';
import { LiveObserver } from './liveObserver';

const NOW = 2_000_000_000_000;

function fakeRepo(state: { head: string; added: number }): GitRepo {
  return {
    root: '/repo',
    head: () => Promise.resolve(state.head),
    workingTreeNumstat: () => Promise.resolve([{ path: '/repo/a.ts', added: state.added, removed: 0 }]),
    commitsSince: () => Promise.resolve([]),
    fileAtCommit: () => Promise.resolve(null),
  };
}

function setup(
  ports: { repos: () => Promise<GitRepo[]> },
  diagnostics: { current: DiagEntry[] } = { current: [] },
) {
  const { database } = seededStore();
  // Make fx-auto-1 a live session whose first turn began a second ago; fx-byok-1 is long finished.
  database.db.prepare('UPDATE sessions SET ended_at = :t WHERE id = :id').run({ t: NOW, id: 'fx-auto-1' });
  database.db
    .prepare('UPDATE turns SET started_at = :t + idx WHERE session_id = :id')
    .run({ t: NOW - 1000, id: 'fx-auto-1' });
  database.db.prepare('UPDATE sessions SET ended_at = :t WHERE id = :id').run({ t: 5, id: 'fx-byok-1' });
  const observations = new ObservationStore(database);
  const warnings: string[] = [];
  let now = NOW;
  const git: GitPort = ports;
  const observer = new LiveObserver({
    database,
    observations,
    git,
    readFile: () => Promise.resolve('const a = computeSomethingLong();\n'),
    salt: () => 'salt',
    diagnostics: () => diagnostics.current,
    now: () => now,
    log: { warn: (message) => warnings.push(message) },
  });
  return {
    database,
    observations,
    observer,
    warnings,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('LiveObserver.tick', () => {
  it('writes a start baseline, then latest snapshots as the working tree changes', async () => {
    const state = { head: 'h1', added: 1 };
    const { observer, observations, advance } = setup({ repos: () => Promise.resolve([fakeRepo(state)]) });
    await observer.tick();
    expect(observations.getSnapshots('fx-auto-1', 'start')[0]).toMatchObject({ head: 'h1', takenAt: NOW });
    expect(observations.getSnapshots('fx-auto-1', 'latest')).toEqual([]);
    advance(60_000);
    state.added = 8;
    await observer.tick();
    const latest = observations.getSnapshots('fx-auto-1', 'latest')[0];
    expect(latest?.files).toEqual([{ path: '/repo/a.ts', added: 8, removed: 0 }]);
    expect(observations.getSnapshots('fx-auto-1', 'start')[0]?.files[0]?.added).toBe(1);
  });

  it('never snapshots sessions that are not live, or whose start was missed', async () => {
    const state = { head: 'h1', added: 1 };
    const { observer, observations, database, advance } = setup({
      repos: () => Promise.resolve([fakeRepo(state)]),
    });
    advance(3_600_000);
    database.db
      .prepare('UPDATE sessions SET ended_at = :t WHERE id = :id')
      .run({ t: NOW + 3_600_000, id: 'fx-auto-1' });
    await observer.tick();
    expect(observations.getSnapshots('fx-auto-1', 'start')).toEqual([]);
    expect(observations.getSnapshots('fx-auto-1', 'latest')).toEqual([]);
    expect(observations.getSnapshots('fx-byok-1', 'start')).toEqual([]);
  });

  it('writes nothing and does not throw when no repository is available', async () => {
    const { observer, observations, warnings } = setup({ repos: () => Promise.resolve([]) });
    await observer.tick();
    expect(observations.getSnapshots('fx-auto-1', 'start')).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('catches and logs a failing git port', async () => {
    const { observer, warnings } = setup({ repos: () => Promise.reject(new Error('git exploded')) });
    await expect(observer.tick()).resolves.toBeUndefined();
    expect(warnings).toEqual(['Live observation failed: git exploded']);
  });

  it('ignores a tick that starts while another is still running', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { observer } = setup({
      repos: async () => {
        calls++;
        await gate;
        return [];
      },
    });
    const first = observer.tick();
    await observer.tick();
    release();
    await first;
    expect(calls).toBe(1);
  });

  it('runs survival checks on every tick, even when git observation fails', async () => {
    const { observer, observations, database, advance } = setup({
      repos: () => Promise.reject(new Error('git exploded')),
    });
    const hash = saltedHash('salt', 'const a = computeSomethingLong();');
    database.db
      .prepare('UPDATE turns SET ended_at = :t WHERE session_id = :id AND idx = 1')
      .run({ t: NOW, id: 'fx-auto-1' });
    database.db
      .prepare(
        "INSERT INTO edit_fingerprints (session_id, turn_idx, path, hashes) VALUES ('fx-auto-1', 1, '/repo/a.ts', :h)",
      )
      .run({ h: JSON.stringify([hash]) });
    advance(2 * 3_600_000);
    await observer.tick();
    expect(observations.survivalChecks('fx-auto-1')).toEqual([
      expect.objectContaining({ checkKind: '1h', present: 1, total: 1 }),
    ]);
  });

  describe('diagnostics', () => {
    it('saves start diagnostics with the baseline and latest ones on a later tick', async () => {
      const diagnostics = { current: [{ path: '/repo/a.ts', errors: 3, warnings: 1 }] };
      const { observer, observations, advance } = setup({ repos: () => Promise.resolve([]) }, diagnostics);
      await observer.tick();
      expect(observations.getDiagnostics('fx-auto-1', 'start')).toEqual(diagnostics.current);
      expect(observations.hasDiagnostics('fx-auto-1', 'latest')).toBe(false);
      advance(60_000);
      diagnostics.current = [];
      await observer.tick();
      expect(observations.hasDiagnostics('fx-auto-1', 'latest')).toBe(true);
      expect(observations.getDiagnostics('fx-auto-1', 'latest')).toEqual([]);
      expect(observations.getDiagnostics('fx-auto-1', 'start')).toHaveLength(1);
    });

    it('records nothing for a session whose start was missed', async () => {
      const { observer, observations, database, advance } = setup({ repos: () => Promise.resolve([]) });
      advance(3_600_000);
      database.db
        .prepare('UPDATE sessions SET ended_at = :t WHERE id = :id')
        .run({ t: NOW + 3_600_000, id: 'fx-auto-1' });
      await observer.tick();
      expect(observations.hasDiagnostics('fx-auto-1', 'start')).toBe(false);
      expect(observations.hasDiagnostics('fx-auto-1', 'latest')).toBe(false);
    });

    it('still records diagnostics when git is unavailable', async () => {
      const { observer, observations } = setup({ repos: () => Promise.reject(new Error('no git')) });
      await observer.tick();
      expect(observations.hasDiagnostics('fx-auto-1', 'start')).toBe(true);
    });
  });

  describe('commit linking', () => {
    const COMMIT_AT = NOW - 1000;

    function commitSetup(options: { fail?: boolean } = {}) {
      const calls: number[] = [];
      const repo: GitRepo = {
        ...fakeRepo({ head: 'h1', added: 1 }),
        commitsSince: (since) => {
          calls.push(since);
          if (options.fail) return Promise.reject(new Error('git log exploded'));
          return Promise.resolve([
            { hash: 'c1', committedAt: COMMIT_AT, files: ['/repo/a.ts', '/repo/other.ts'] },
            { hash: 'c2', committedAt: COMMIT_AT, files: ['/repo/unrelated.ts'] },
          ]);
        },
      };
      const harness = setup({ repos: () => Promise.resolve([repo]) });
      harness.database.db.exec('DELETE FROM file_events');
      harness.database.db.exec(
        "INSERT INTO file_events (session_id, turn_idx, seq, path, action, source) VALUES ('fx-auto-1', 1, 0, '/repo/a.ts', 'edited', 't')",
      );
      return { ...harness, calls };
    }

    it('links commits that touched an edited file and stores them', async () => {
      const { observer, observations } = commitSetup();
      await observer.tick();
      expect(observations.sessionCommits('fx-auto-1')).toEqual([
        { hash: 'c1', committedAt: COMMIT_AT, overlapFiles: 1, editedFiles: 1, linkedAt: NOW },
      ]);
    });

    it('does not ask git again within the throttle window, but does after it', async () => {
      const { observer, calls, advance } = commitSetup();
      await observer.tick();
      advance(60_000);
      await observer.tick();
      expect(calls).toHaveLength(1);
      advance(5 * 60_000);
      await observer.tick();
      expect(calls).toHaveLength(2);
    });

    it('does not rewrite identical links, so cached analyses are not invalidated needlessly', async () => {
      const { observer, observations, advance, calls } = commitSetup();
      await observer.tick();
      advance(6 * 60_000);
      await observer.tick();
      expect(calls).toHaveLength(2);
      // A rewrite would have moved linkedAt to the later tick.
      expect(observations.sessionCommits('fx-auto-1')).toEqual([
        { hash: 'c1', committedAt: COMMIT_AT, overlapFiles: 1, editedFiles: 1, linkedAt: NOW },
      ]);
    });

    it('stores nothing and does not throw when there is no repository', async () => {
      const { observer, observations, database, warnings } = commitSetup();
      database.db.exec("UPDATE file_events SET path = '/elsewhere/a.ts'");
      await observer.tick();
      expect(observations.sessionCommits('fx-auto-1')).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('skips sessions that edited no files', async () => {
      const { observer, calls, database } = commitSetup();
      database.db.exec('DELETE FROM file_events');
      await observer.tick();
      expect(calls).toEqual([]);
    });

    it('catches a failing git log per session and keeps going', async () => {
      const { observer, observations, warnings } = commitSetup({ fail: true });
      await observer.tick();
      expect(observations.sessionCommits('fx-auto-1')).toEqual([]);
      expect(warnings).toEqual(['Could not link commits for session fx-auto-1: git log exploded']);
    });
  });
});
