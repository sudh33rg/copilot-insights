import { describe, expect, it } from 'vitest';
import { COMMIT_WINDOW_MS, linkCommits } from './commitLink';

const session = { startedAt: 1000, endedAt: 5000, editedPaths: ['/r/a.ts', '/r/b.ts'] };
const commit = (hash: string, committedAt: number, ...files: string[]) => ({ hash, committedAt, files });

describe('linkCommits', () => {
  it('links commits after the session start that touch an edited file', () => {
    const links = linkCommits(session, [
      commit('c1', 6000, '/r/a.ts', '/r/z.ts'),
      commit('c2', 7000, '/r/z.ts'),
    ]);
    expect(links).toEqual([{ hash: 'c1', committedAt: 6000, overlapFiles: 1, editedFiles: 2 }]);
  });

  it('ignores commits before the session started or after the window', () => {
    expect(
      linkCommits(session, [
        commit('old', 500, '/r/a.ts'),
        commit('late', 5000 + COMMIT_WINDOW_MS + 1, '/r/a.ts'),
      ]),
    ).toEqual([]);
    expect(COMMIT_WINDOW_MS).toBe(86_400_000);
  });

  it('keeps a commit made during the session and one exactly at the window edge', () => {
    const links = linkCommits(session, [
      commit('during', 3000, '/r/b.ts'),
      commit('edge', 5000 + COMMIT_WINDOW_MS, '/r/a.ts'),
    ]);
    expect(links.map((link) => link.hash)).toEqual(['during', 'edge']);
  });

  it('links nothing for a session that edited no files', () => {
    expect(linkCommits({ ...session, editedPaths: [] }, [commit('c', 6000, '/r/a.ts')])).toEqual([]);
  });

  it('counts each edited file once and orders links by commit time', () => {
    const links = linkCommits({ ...session, editedPaths: ['/r/a.ts', '/r/a.ts'] }, [
      commit('late', 9000, '/r/a.ts'),
      commit('early', 6000, '/r/a.ts'),
    ]);
    expect(links.map((link) => link.hash)).toEqual(['early', 'late']);
    expect(links[0]?.editedFiles).toBe(1);
  });
});
