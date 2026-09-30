import type { Database } from './database';

const META_LAST_CHANGE = 'observation.lastChangeAt';

export type SnapshotKind = 'start' | 'latest';
export type CommandKind = 'test' | 'build' | 'lint' | 'other';

export interface SnapshotFile {
  path: string;
  added: number;
  removed: number;
}

export interface SnapshotInput {
  sessionId: string;
  kind: SnapshotKind;
  repoRoot: string;
  head: string | null;
  takenAt: number;
  files: SnapshotFile[];
}

export type StoredSnapshot = Omit<SnapshotInput, 'sessionId' | 'kind'>;

export interface DiagEntry {
  path: string;
  errors: number;
  warnings: number;
}

export interface TerminalRun {
  startedAt: number | null;
  endedAt: number;
  exitCode: number | null;
  kind: CommandKind;
  commandHash: string;
}

export interface SurvivalCheck {
  sessionId: string;
  turnIdx: number;
  path: string;
  checkKind: '1h' | '1d' | 'commit';
  checkedAt: number;
  present: number;
  total: number;
}

export interface SessionCommit {
  hash: string;
  committedAt: number;
  overlapFiles: number;
  editedFiles: number;
  linkedAt: number;
}

const IDS = 'SELECT value FROM json_each(:ids)';
/** Tables keyed by `session_id` that carry no foreign key to `sessions`. */
export const OBSERVATION_SESSION_TABLES = [
  'git_snapshots',
  'git_snapshot_files',
  'diag_snapshots',
  'survival_checks',
  'session_commits',
];

/** When any live observation last changed; 0 if none ever did. Cached analyses older than this are stale. */
export function readLastChangeAt(database: Pick<Database, 'db'>): number {
  const row = database.db
    .prepare('SELECT value FROM meta WHERE key = :key')
    .get({ key: META_LAST_CHANGE }) as { value: string } | undefined;
  return row === undefined ? 0 : Number(row.value);
}

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);

/** The deepest repo root that contains `path`, or null. */
function owningRoot(path: string, roots: readonly string[]): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (isUnder(path, root) && (best === null || root.length > best.length)) best = root;
  }
  return best;
}

/** Read-only access to live observations (usable from the query layer with just `db`). */
export class ObservationReader {
  constructor(protected readonly database: Pick<Database, 'db'>) {}

  lastChangeAt(): number {
    return readLastChangeAt(this.database);
  }

  getSnapshots(sessionId: string, kind: SnapshotKind): StoredSnapshot[] {
    const { db } = this.database;
    const repos = db
      .prepare(
        'SELECT repo_root, head, taken_at FROM git_snapshots WHERE session_id = :sessionId AND kind = :kind ORDER BY repo_root',
      )
      .all({ sessionId, kind }) as unknown as { repo_root: string; head: string | null; taken_at: number }[];
    const files = db
      .prepare(
        'SELECT path, added, removed FROM git_snapshot_files WHERE session_id = :sessionId AND kind = :kind ORDER BY path',
      )
      .all({ sessionId, kind }) as unknown as SnapshotFile[];
    const roots = repos.map((repo) => repo.repo_root);
    return repos.map((repo) => ({
      repoRoot: repo.repo_root,
      head: repo.head,
      takenAt: repo.taken_at,
      files: files
        .filter((file) => owningRoot(file.path, roots) === repo.repo_root)
        .map((file) => ({ path: file.path, added: file.added, removed: file.removed })),
    }));
  }

  getDiagnostics(sessionId: string, kind: SnapshotKind): DiagEntry[] {
    return this.database.db
      .prepare(
        'SELECT path, errors, warnings FROM diag_snapshots WHERE session_id = :sessionId AND kind = :kind ORDER BY path',
      )
      .all({ sessionId, kind }) as unknown as DiagEntry[];
  }

  terminalRunsBetween(fromMs: number, toMs: number): TerminalRun[] {
    const rows = this.database.db
      .prepare(
        `SELECT started_at, ended_at, exit_code, kind, command_hash FROM terminal_runs
         WHERE ended_at >= :fromMs AND ended_at <= :toMs ORDER BY ended_at, id`,
      )
      .all({ fromMs, toMs }) as unknown as {
      started_at: number | null;
      ended_at: number;
      exit_code: number | null;
      kind: CommandKind;
      command_hash: string;
    }[];
    return rows.map((row) => ({
      startedAt: row.started_at,
      endedAt: row.ended_at,
      exitCode: row.exit_code,
      kind: row.kind,
      commandHash: row.command_hash,
    }));
  }

  survivalChecks(sessionId: string): SurvivalCheck[] {
    const rows = this.database.db
      .prepare(
        `SELECT turn_idx, path, check_kind, checked_at, present, total FROM survival_checks
         WHERE session_id = :sessionId ORDER BY turn_idx, path, check_kind`,
      )
      .all({ sessionId }) as unknown as {
      turn_idx: number;
      path: string;
      check_kind: SurvivalCheck['checkKind'];
      checked_at: number;
      present: number;
      total: number;
    }[];
    return rows.map((row) => ({
      sessionId,
      turnIdx: row.turn_idx,
      path: row.path,
      checkKind: row.check_kind,
      checkedAt: row.checked_at,
      present: row.present,
      total: row.total,
    }));
  }

  sessionCommits(sessionId: string): SessionCommit[] {
    const rows = this.database.db
      .prepare(
        `SELECT hash, committed_at, overlap_files, edited_files, linked_at FROM session_commits
         WHERE session_id = :sessionId ORDER BY committed_at, hash`,
      )
      .all({ sessionId }) as unknown as {
      hash: string;
      committed_at: number;
      overlap_files: number;
      edited_files: number;
      linked_at: number;
    }[];
    return rows.map((row) => ({
      hash: row.hash,
      committedAt: row.committed_at,
      overlapFiles: row.overlap_files,
      editedFiles: row.edited_files,
      linkedAt: row.linked_at,
    }));
  }
}

/**
 * Live observations. None of these tables reference `sessions`: a rescan deletes and re-inserts the session row,
 * so cleanup is explicit (clear, retention, capture-level downgrade).
 */
export class ObservationStore extends ObservationReader {
  constructor(
    protected override readonly database: Database,
    private readonly now: () => number = Date.now,
  ) {
    super(database);
  }

  touch(now: number): void {
    this.database.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run({ key: META_LAST_CHANGE, value: String(now) });
  }

  saveSnapshot(snapshot: SnapshotInput): void {
    const { db } = this.database;
    const { sessionId, kind, repoRoot } = snapshot;
    this.database.transaction(() => {
      db.prepare(
        `INSERT INTO git_snapshots (session_id, kind, repo_root, head, taken_at)
         VALUES (:sessionId, :kind, :repoRoot, :head, :takenAt)
         ON CONFLICT(session_id, kind, repo_root) DO UPDATE SET head = excluded.head, taken_at = excluded.taken_at`,
      ).run({ sessionId, kind, repoRoot, head: snapshot.head, takenAt: snapshot.takenAt });

      const roots = (
        db.prepare('SELECT repo_root FROM git_snapshots WHERE session_id = :sessionId AND kind = :kind').all({
          sessionId,
          kind,
        }) as unknown as { repo_root: string }[]
      ).map((row) => row.repo_root);
      const existing = db
        .prepare('SELECT path FROM git_snapshot_files WHERE session_id = :sessionId AND kind = :kind')
        .all({ sessionId, kind }) as unknown as { path: string }[];
      const remove = db.prepare(
        'DELETE FROM git_snapshot_files WHERE session_id = :sessionId AND kind = :kind AND path = :path',
      );
      for (const { path } of existing) {
        if (owningRoot(path, roots) === repoRoot) remove.run({ sessionId, kind, path });
      }
      const insert = db.prepare(
        `INSERT OR REPLACE INTO git_snapshot_files (session_id, kind, path, added, removed)
         VALUES (:sessionId, :kind, :path, :added, :removed)`,
      );
      for (const file of snapshot.files) {
        insert.run({ sessionId, kind, path: file.path, added: file.added, removed: file.removed });
      }
      this.touch(this.now());
    });
  }

  saveDiagnostics(sessionId: string, kind: SnapshotKind, entries: DiagEntry[]): void {
    const { db } = this.database;
    this.database.transaction(() => {
      db.prepare('DELETE FROM diag_snapshots WHERE session_id = :sessionId AND kind = :kind').run({
        sessionId,
        kind,
      });
      const insert = db.prepare(
        `INSERT INTO diag_snapshots (session_id, kind, path, errors, warnings)
         VALUES (:sessionId, :kind, :path, :errors, :warnings)`,
      );
      for (const entry of entries) {
        insert.run({ sessionId, kind, path: entry.path, errors: entry.errors, warnings: entry.warnings });
      }
      this.touch(this.now());
    });
  }

  addTerminalRun(run: TerminalRun): void {
    this.database.db
      .prepare(
        `INSERT INTO terminal_runs (started_at, ended_at, exit_code, kind, command_hash)
         VALUES (:startedAt, :endedAt, :exitCode, :kind, :commandHash)`,
      )
      .run({ ...run });
    this.touch(this.now());
  }

  saveSurvivalCheck(check: SurvivalCheck): void {
    this.database.db
      .prepare(
        `INSERT INTO survival_checks (session_id, turn_idx, path, check_kind, checked_at, present, total)
         VALUES (:sessionId, :turnIdx, :path, :checkKind, :checkedAt, :present, :total)
         ON CONFLICT(session_id, turn_idx, path, check_kind)
         DO UPDATE SET checked_at = excluded.checked_at, present = excluded.present, total = excluded.total`,
      )
      .run({ ...check });
    this.touch(this.now());
  }

  replaceSessionCommits(sessionId: string, links: SessionCommit[]): void {
    const { db } = this.database;
    this.database.transaction(() => {
      db.prepare('DELETE FROM session_commits WHERE session_id = :sessionId').run({ sessionId });
      const insert = db.prepare(
        `INSERT INTO session_commits (session_id, hash, committed_at, overlap_files, edited_files, linked_at)
         VALUES (:sessionId, :hash, :committedAt, :overlapFiles, :editedFiles, :linkedAt)`,
      );
      for (const link of links) insert.run({ sessionId, ...link });
      this.touch(this.now());
    });
  }

  deleteSessions(ids: readonly string[]): void {
    const { db } = this.database;
    const params = { ids: JSON.stringify(ids) };
    this.database.transaction(() => {
      for (const table of OBSERVATION_SESSION_TABLES) {
        db.prepare(`DELETE FROM ${table} WHERE session_id IN (${IDS})`).run(params);
      }
      this.touch(this.now());
    });
  }

  /** Survival checks are the only observations derived from edit content, so a content clear drops them. */
  deleteSurvivalChecks(ids: readonly string[]): void {
    this.database.db
      .prepare(`DELETE FROM survival_checks WHERE session_id IN (${IDS})`)
      .run({ ids: JSON.stringify(ids) });
    this.touch(this.now());
  }

  deleteAll(): void {
    this.database.transaction(() => {
      for (const table of [...OBSERVATION_SESSION_TABLES, 'terminal_runs']) {
        this.database.db.exec(`DELETE FROM ${table}`);
      }
      this.touch(this.now());
    });
  }

  pruneBefore(ms: number): void {
    this.database.db.prepare('DELETE FROM terminal_runs WHERE ended_at < :ms').run({ ms });
    this.touch(this.now());
  }
}
