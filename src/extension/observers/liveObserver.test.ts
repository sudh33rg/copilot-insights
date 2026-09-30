import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import type { GitPort, GitRepo } from '../../core/git/types';
import { saltedHash } from '../../core/privacy/fingerprint';
import { ObservationStore } from '../../core/storage/observationStore';
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

function setup(ports: { repos: () => Promise<GitRepo[]> }) {
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
});
