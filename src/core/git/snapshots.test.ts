import { describe, expect, it } from 'vitest';
import { LIVE_START_MS, diffSnapshots, shouldBaseline, takeSnapshot } from './snapshots';
import type { GitRepo } from './types';

const snap = (head: string | null, files: [string, number, number][], root = '/r') => ({
  repoRoot: root,
  head,
  takenAt: 1,
  files: files.map(([path, added, removed]) => ({ path, added, removed })),
});

describe('diffSnapshots', () => {
  it('sums positive per-file growth of the working-tree diff', () => {
    const start = [snap('h1', [['/r/a.ts', 5, 1]])];
    const latest = [
      snap('h1', [
        ['/r/a.ts', 12, 3],
        ['/r/b.ts', 4, 0],
      ]),
    ];
    expect(diffSnapshots(start, latest)).toEqual({ added: 11, removed: 2 });
  });
  it('never goes negative when the user reverted changes', () => {
    expect(diffSnapshots([snap('h1', [['/r/a.ts', 9, 9]])], [snap('h1', [])])).toEqual({
      added: 0,
      removed: 0,
    });
  });
  it('is not computable when HEAD moved', () => {
    expect(diffSnapshots([snap('h1', [])], [snap('h2', [])])).toBeNull();
  });
  it('is not computable without a baseline or without a matching repo', () => {
    expect(diffSnapshots([], [snap('h1', [])])).toBeNull();
    expect(diffSnapshots([snap('h1', [], '/a')], [snap('h1', [], '/b')])).toBeNull();
  });
});

describe('shouldBaseline', () => {
  it('baselines only when the first turn just started and no start exists', () => {
    const now = 1_000_000;
    expect(shouldBaseline({ hasStart: false, firstTurnStartedAt: now - 1000, now })).toBe(true);
    expect(shouldBaseline({ hasStart: true, firstTurnStartedAt: now - 1000, now })).toBe(false);
    expect(shouldBaseline({ hasStart: false, firstTurnStartedAt: now - LIVE_START_MS - 1, now })).toBe(false);
    expect(shouldBaseline({ hasStart: false, firstTurnStartedAt: null, now })).toBe(false);
  });
});

describe('takeSnapshot', () => {
  it('captures head and numstat', async () => {
    const repo: GitRepo = {
      root: '/r',
      head: () => Promise.resolve('abc'),
      workingTreeNumstat: () => Promise.resolve([{ path: '/r/a.ts', added: 1, removed: 0 }]),
      commitsSince: () => Promise.resolve([]),
      fileAtCommit: () => Promise.resolve(null),
    };
    expect(await takeSnapshot(repo, 7)).toEqual({
      repoRoot: '/r',
      head: 'abc',
      takenAt: 7,
      files: [{ path: '/r/a.ts', added: 1, removed: 0 }],
    });
  });
});
