import type { StoredSnapshot } from '../storage/observationStore';
import type { GitRepo } from './types';

export const LIVE_START_MS = 180_000;
export const LIVE_WINDOW_MS = 600_000;

export async function takeSnapshot(repo: GitRepo, now: number): Promise<StoredSnapshot> {
  const [head, files] = await Promise.all([repo.head(), repo.workingTreeNumstat()]);
  return { repoRoot: repo.root, head, takenAt: now, files };
}

export function shouldBaseline(input: {
  hasStart: boolean;
  firstTurnStartedAt: number | null;
  now: number;
}): boolean {
  return (
    !input.hasStart &&
    input.firstTurnStartedAt !== null &&
    input.now - input.firstTurnStartedAt <= LIVE_START_MS
  );
}

/** Net working-tree growth between two observations, per repo, clamped at 0 per file. Null when not computable. */
export function diffSnapshots(
  start: readonly StoredSnapshot[],
  latest: readonly StoredSnapshot[],
): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  let matched = false;
  for (const from of start) {
    const to = latest.find((candidate) => candidate.repoRoot === from.repoRoot);
    if (to === undefined) continue;
    if (from.head !== to.head) return null;
    matched = true;
    const before = new Map(from.files.map((file) => [file.path, file]));
    for (const file of to.files) {
      const old = before.get(file.path);
      added += Math.max(0, file.added - (old?.added ?? 0));
      removed += Math.max(0, file.removed - (old?.removed ?? 0));
    }
  }
  return matched ? { added, removed } : null;
}
