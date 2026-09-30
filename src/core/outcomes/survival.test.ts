import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { saltedHash } from '../privacy/fingerprint';
import { ObservationStore } from '../storage/observationStore';
import type { GitPort, GitRepo } from '../git/types';
import { DUE, GRACE, SurvivalChecker, presentFraction } from './survival';

const SALT = 'salt';
const T = 1_800_000_000_000;
const LINE_A = 'const a = computeSomethingLong();';
const LINE_B = 'const b = computeSomethingElse();';
const HASHES = [saltedHash(SALT, LINE_A), saltedHash(SALT, LINE_B)];

describe('presentFraction', () => {
  it('counts fingerprints whose line is still in the file', () => {
    expect(presentFraction(HASHES, `  ${LINE_A}  \nother\n`, SALT)).toEqual({ present: 1, total: 2 });
  });
  it('counts a missing file as nothing present, not as an error', () => {
    expect(presentFraction(HASHES, null, SALT)).toEqual({ present: 0, total: 2 });
  });
  it('handles an edit without fingerprints', () => {
    expect(presentFraction([], 'anything', SALT)).toEqual({ present: 0, total: 0 });
  });
});

function setup(files: Record<string, string | Error> = { '/repo/a.ts': `${LINE_A}\n` }) {
  const { database } = seededStore();
  database.db
    .prepare('UPDATE turns SET ended_at = :t WHERE session_id = :id AND idx = 1')
    .run({ t: T, id: 'fx-auto-1' });
  database.db
    .prepare(
      "INSERT INTO edit_fingerprints (session_id, turn_idx, path, hashes) VALUES ('fx-auto-1', 1, '/repo/a.ts', :h)",
    )
    .run({ h: JSON.stringify(HASHES) });
  const observations = new ObservationStore(database);
  const fileAtCommitCalls: [string, string][] = [];
  const repo: GitRepo = {
    root: '/repo',
    head: () => Promise.resolve('h'),
    workingTreeNumstat: () => Promise.resolve([]),
    commitsSince: () => Promise.resolve([{ hash: 'c1', committedAt: T + 1000, files: ['/repo/a.ts'] }]),
    fileAtCommit: (hash, path) => {
      fileAtCommitCalls.push([hash, path]);
      return Promise.resolve(`${LINE_A}\n${LINE_B}\n`);
    },
  };
  const git: GitPort = { repos: () => Promise.resolve([repo]) };
  let now = T;
  const checker = new SurvivalChecker({
    database,
    observations,
    git,
    readFile: (path) => {
      const value = files[path];
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve(value ?? null);
    },
    salt: () => SALT,
    now: () => now,
  });
  return {
    database,
    observations,
    checker,
    fileAtCommitCalls,
    at: (ms: number) => {
      now = T + ms;
    },
  };
}

const kinds = (observations: ObservationStore) =>
  observations.survivalChecks('fx-auto-1').map((check) => check.checkKind);

describe('SurvivalChecker.run', () => {
  it('writes nothing before the first check is due', async () => {
    const { checker, observations, at } = setup();
    at(30 * 60_000);
    expect(await checker.run()).toBe(0);
    expect(observations.survivalChecks('fx-auto-1')).toEqual([]);
  });

  it('writes the 1h check once it is due and never repeats it', async () => {
    const { checker, observations, at } = setup();
    at(2 * 3_600_000);
    expect(await checker.run()).toBe(1);
    expect(observations.survivalChecks('fx-auto-1')).toEqual([
      {
        sessionId: 'fx-auto-1',
        turnIdx: 1,
        path: '/repo/a.ts',
        checkKind: '1h',
        checkedAt: T + 7_200_000,
        present: 1,
        total: 2,
      },
    ]);
    expect(await checker.run()).toBe(0);
  });

  it('writes the 1d check but skips a 1h check that is past its grace period', async () => {
    const { checker, observations, at } = setup();
    at(3 * 86_400_000);
    await checker.run();
    expect(kinds(observations)).toEqual(['1d']);
  });

  it('stops checking edits older than a week', async () => {
    const { checker, observations, at } = setup();
    at(10 * 86_400_000);
    expect(await checker.run()).toBe(0);
    expect(observations.survivalChecks('fx-auto-1')).toEqual([]);
  });

  it('checks the file as committed when the session led to a later commit, once', async () => {
    const { checker, observations, fileAtCommitCalls, at } = setup();
    observations.replaceSessionCommits('fx-auto-1', [
      { hash: 'c1', committedAt: T + 1000, overlapFiles: 1, editedFiles: 1, linkedAt: T + 2000 },
    ]);
    at(30 * 60_000);
    expect(await checker.run()).toBe(1);
    expect(await checker.run()).toBe(0);
    expect(fileAtCommitCalls).toEqual([['c1', 'a.ts']]);
    expect(observations.survivalChecks('fx-auto-1')[0]).toMatchObject({
      checkKind: 'commit',
      present: 2,
      total: 2,
    });
  });

  it('records a deleted file as zero present (file gone is an outcome, not an error)', async () => {
    const { checker, observations, at } = setup({});
    at(2 * 3_600_000);
    await checker.run();
    expect(observations.survivalChecks('fx-auto-1')[0]).toMatchObject({ present: 0, total: 2 });
  });

  it('skips a file that cannot be read, without recording it as deleted, and still checks the others', async () => {
    const { checker, observations, database, at } = setup({
      '/repo/a.ts': new Error('EACCES'),
      '/repo/b.ts': `${LINE_B}\n`,
    });
    database.db
      .prepare(
        "INSERT INTO edit_fingerprints (session_id, turn_idx, path, hashes) VALUES ('fx-auto-1', 1, '/repo/b.ts', :h)",
      )
      .run({ h: JSON.stringify([HASHES[1]]) });
    at(2 * 3_600_000);
    expect(await checker.run()).toBe(1);
    const byPath = Object.fromEntries(
      observations.survivalChecks('fx-auto-1').map((c) => [c.path, c.present]),
    );
    // The unreadable file is left for a later tick instead of being recorded as deleted.
    expect(byPath).toEqual({ '/repo/b.ts': 1 });
  });

  it('exposes its schedule', () => {
    expect(DUE).toEqual({ '1h': 3_600_000, '1d': 86_400_000 });
    expect(GRACE).toEqual({ '1h': 86_400_000, '1d': 604_800_000 });
  });
});
