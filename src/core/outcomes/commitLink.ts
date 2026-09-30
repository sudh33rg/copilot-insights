import type { GitCommit } from '../git/types';

/** How long after a session ended a commit is still credited to it. */
export const COMMIT_WINDOW_MS = 86_400_000;

export interface CommitLink {
  hash: string;
  committedAt: number;
  overlapFiles: number;
  editedFiles: number;
}

/**
 * Commits made from the session's start until a day after it ended that touch at least one file the session
 * edited. A link is an association (the commit changed the same files), not proof the session wrote the change.
 */
export function linkCommits(
  session: { startedAt: number; endedAt: number; editedPaths: readonly string[] },
  commits: readonly GitCommit[],
  windowMs: number = COMMIT_WINDOW_MS,
): CommitLink[] {
  const edited = new Set(session.editedPaths);
  if (edited.size === 0) return [];
  return commits
    .filter(
      (commit) => commit.committedAt >= session.startedAt && commit.committedAt <= session.endedAt + windowMs,
    )
    .map((commit) => ({
      hash: commit.hash,
      committedAt: commit.committedAt,
      overlapFiles: new Set(commit.files.filter((file) => edited.has(file))).size,
      editedFiles: edited.size,
    }))
    .filter((link) => link.overlapFiles > 0)
    .sort((a, b) => a.committedAt - b.committedAt);
}
