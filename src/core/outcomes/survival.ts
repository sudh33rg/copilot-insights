import { relative, sep } from 'node:path';
import type { GitPort, GitRepo } from '../git/types';
import { saltedHash } from '../privacy/fingerprint';
import type { Database } from '../storage/database';
import type { ObservationStore, SurvivalCheck } from '../storage/observationStore';

export const DUE = { '1h': 3_600_000, '1d': 86_400_000 } as const;
/** A check that was not taken within its grace period is skipped: the file has moved on too far to attribute. */
export const GRACE = { '1h': 86_400_000, '1d': 604_800_000 } as const;
const LOOKBACK_MS = 8 * 86_400_000;
const TIMED_KINDS = ['1h', '1d'] as const;

/** How many of an edit's inserted-line fingerprints are still present in `fileText` (null = file is gone). */
export function presentFraction(
  hashes: readonly string[],
  fileText: string | null,
  salt: string,
): { present: number; total: number } {
  if (fileText === null) return { present: 0, total: hashes.length };
  const inFile = new Set(fileText.split(/\r?\n/).map((line) => saltedHash(salt, line.trim())));
  return { present: hashes.filter((hash) => inFile.has(hash)).length, total: hashes.length };
}

export interface SurvivalDeps {
  database: Pick<Database, 'db'>;
  observations: ObservationStore;
  git: GitPort;
  /** File text, `null` when the file does not exist. Reject when it exists but cannot be read. */
  readFile(path: string): Promise<string | null>;
  salt(): string;
  now(): number;
}

interface Candidate {
  session_id: string;
  turn_idx: number;
  path: string;
  hashes: string;
  edited_at: number;
}

/** Re-checks whether the lines Copilot inserted are still in the file an hour, a day and one commit later. */
export class SurvivalChecker {
  constructor(private readonly deps: SurvivalDeps) {}

  /** Returns the number of checks written. Idempotent: a check that exists is never taken again. */
  async run(): Promise<number> {
    const { database, observations, git } = this.deps;
    const now = this.deps.now();
    const salt = this.deps.salt();
    const candidates = database.db
      .prepare(
        `SELECT f.session_id, f.turn_idx, f.path, f.hashes, COALESCE(t.ended_at, t.started_at) AS edited_at
           FROM edit_fingerprints f
           JOIN turns t ON t.session_id = f.session_id AND t.idx = f.turn_idx
          WHERE edited_at IS NOT NULL AND edited_at >= :since`,
      )
      .all({ since: now - LOOKBACK_MS }) as unknown as Candidate[];

    const key = (turnIdx: number, path: string, kind: string) => `${String(turnIdx)}\0${path}\0${kind}`;
    const existing = new Map<string, Set<string>>();
    const taken = (candidate: Candidate): Set<string> => {
      let set = existing.get(candidate.session_id);
      if (set === undefined) {
        set = new Set(
          observations
            .survivalChecks(candidate.session_id)
            .map((check) => key(check.turnIdx, check.path, check.checkKind)),
        );
        existing.set(candidate.session_id, set);
      }
      return set;
    };

    let repos: GitRepo[] | null = null;
    let written = 0;
    const save = (
      candidate: Candidate,
      checkKind: SurvivalCheck['checkKind'],
      hashes: string[],
      text: string | null,
    ) => {
      const { present, total } = presentFraction(hashes, text, salt);
      observations.saveSurvivalCheck({
        sessionId: candidate.session_id,
        turnIdx: candidate.turn_idx,
        path: candidate.path,
        checkKind,
        checkedAt: now,
        present,
        total,
      });
      taken(candidate).add(key(candidate.turn_idx, candidate.path, checkKind));
      written++;
    };

    for (const candidate of candidates) {
      const hashes = parseHashes(candidate.hashes);
      if (hashes.length === 0) continue;
      const age = now - candidate.edited_at;
      for (const kind of TIMED_KINDS) {
        if (
          age < DUE[kind] ||
          age >= GRACE[kind] ||
          taken(candidate).has(key(candidate.turn_idx, candidate.path, kind))
        )
          continue;
        try {
          save(candidate, kind, hashes, await this.deps.readFile(candidate.path));
        } catch {
          // Unreadable right now: leave the check to a later tick rather than record a false "deleted".
        }
      }
      if (
        taken(candidate).has(key(candidate.turn_idx, candidate.path, 'commit')) ||
        !this.ledToLaterCommit(candidate)
      )
        continue;
      repos ??= await git.repos();
      const repo = owningRepo(repos, candidate.path);
      if (repo === undefined) continue;
      try {
        const commit = (await repo.commitsSince(candidate.edited_at))
          .filter((entry) => entry.files.includes(candidate.path))
          .sort((a, b) => a.committedAt - b.committedAt)[0];
        if (commit === undefined) continue;
        save(
          candidate,
          'commit',
          hashes,
          await repo.fileAtCommit(commit.hash, gitPath(repo.root, candidate.path)),
        );
      } catch {
        // Git unavailable: try again next tick.
      }
    }
    if (written > 0) observations.touch(now);
    return written;
  }

  private ledToLaterCommit(candidate: Candidate): boolean {
    return this.deps.observations
      .sessionCommits(candidate.session_id)
      .some((commit) => commit.committedAt > candidate.edited_at);
  }
}

function parseHashes(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** The repo with the deepest root containing `path`. */
function owningRepo(repos: readonly GitRepo[], path: string): GitRepo | undefined {
  return repos
    .filter(
      (repo) => path === repo.root || path.startsWith(repo.root + sep) || path.startsWith(`${repo.root}/`),
    )
    .sort((a, b) => b.root.length - a.root.length)[0];
}

const gitPath = (root: string, path: string): string => relative(root, path).split(sep).join('/');
