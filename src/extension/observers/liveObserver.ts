import type { Database } from '../../core/storage/database';
import { LIVE_WINDOW_MS, shouldBaseline, takeSnapshot } from '../../core/git/snapshots';
import type { GitPort, GitRepo } from '../../core/git/types';
import { isWithin, pathsRelated } from '../../core/git/paths';
import { linkCommits } from '../../core/outcomes/commitLink';
import { SurvivalChecker } from '../../core/outcomes/survival';
import type { DiagEntry, ObservationStore, SnapshotKind } from '../../core/storage/observationStore';

interface PlanEntry {
  id: string;
  kind: SnapshotKind;
  workspacePath: string | null;
}

const LINK_LOOKBACK_MS = 7 * 86_400_000;
const LINK_THROTTLE_MS = 5 * 60_000;

export interface LiveObserverDeps {
  database: Database;
  observations: ObservationStore;
  git: GitPort;
  /** File text, `null` when the file is gone; rejects when it exists but cannot be read. */
  readFile(path: string): Promise<string | null>;
  salt(): string;
  /** Current error/warning counts per file; counts only, never message text. */
  diagnostics(): { entries: DiagEntry[]; truncated: boolean };
  now?: () => number;
  log: { warn(message: string): void };
}

export class LiveObserver {
  private running = false;
  private readonly survival: SurvivalChecker;
  /** When each session's commits were last looked up (in memory: a restart simply re-checks once). */
  private readonly linked = new Map<string, { at: number; endedAt: number }>();

  constructor(private readonly deps: LiveObserverDeps) {
    this.survival = new SurvivalChecker({
      database: deps.database,
      observations: deps.observations,
      git: deps.git,
      readFile: (path) => deps.readFile(path),
      salt: () => deps.salt(),
      now: () => (deps.now ?? Date.now)(),
    });
  }

  /** Idempotent and re-entrancy safe; called after every sync and on a 60 s timer. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Independent steps: one failing (say, git is unavailable) must not stop the others.
      const now = (this.deps.now ?? Date.now)();
      const plan = this.plan(now);
      const repos = this.reposOnce();
      await this.step(() => this.observeGit(plan, now, repos));
      await this.step(() => {
        this.observeDiagnostics(plan);
        return Promise.resolve();
      });
      await this.step(() => this.linkSessionCommits(now, repos));
      await this.step(() => this.survival.run());
    } finally {
      this.running = false;
    }
  }

  private async step(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.warn(error);
    }
  }

  private warn(error: unknown): void {
    this.deps.log.warn(`Live observation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * One lookup of the git repositories per tick, shared by every step that needs them and only made if one
   * does. A failing git extension is reported once and reads as "no repositories".
   */
  private reposOnce(): () => Promise<GitRepo[]> {
    let pending: Promise<GitRepo[]> | null = null;
    return () =>
      (pending ??= this.deps.git.repos().catch((error: unknown) => {
        this.warn(error);
        return [];
      }));
  }

  private liveSessions(
    now: number,
  ): { id: string; firstTurnStartedAt: number | null; workspacePath: string | null }[] {
    return this.deps.database.db
      .prepare(
        `SELECT s.id, s.workspace_path AS workspacePath,
                (SELECT MIN(started_at) FROM turns t WHERE t.session_id = s.id) AS firstTurnStartedAt
           FROM sessions s WHERE s.ended_at >= :since`,
      )
      .all({ since: now - LIVE_WINDOW_MS }) as unknown as {
      id: string;
      firstTurnStartedAt: number | null;
      workspacePath: string | null;
    }[];
  }

  /**
   * Which live sessions to observe and as what. Decided once per tick, before any step writes, so every step
   * agrees on whether this is the session's baseline (`start`) or a later observation (`latest`). A session
   * whose first turn is too old to baseline is skipped: a late "start" would hide what had already changed.
   */
  private plan(now: number): PlanEntry[] {
    const { observations } = this.deps;
    return this.liveSessions(now).flatMap((session): PlanEntry[] => {
      const hasStart =
        observations.getSnapshots(session.id, 'start').length > 0 ||
        observations.hasDiagnostics(session.id, 'start');
      if (hasStart) return [{ id: session.id, kind: 'latest', workspacePath: session.workspacePath }];
      return shouldBaseline({ hasStart, firstTurnStartedAt: session.firstTurnStartedAt, now })
        ? [{ id: session.id, kind: 'start', workspacePath: session.workspacePath }]
        : [];
    });
  }

  private async observeGit(
    plan: readonly PlanEntry[],
    now: number,
    getRepos: () => Promise<GitRepo[]>,
  ): Promise<void> {
    if (plan.length === 0) return;
    const repos = await getRepos();
    for (const { id, kind, workspacePath } of plan) {
      // Only repositories that belong to the session's workspace: another window's repo must not count.
      const related = repos.filter(
        (repo) => workspacePath === null || pathsRelated(repo.root, workspacePath),
      );
      for (const repo of related) {
        this.deps.observations.saveSnapshot({ sessionId: id, kind, ...(await takeSnapshot(repo, now)) });
      }
    }
  }

  private observeDiagnostics(plan: readonly PlanEntry[]): void {
    if (plan.length === 0) return;
    const { entries, truncated } = this.deps.diagnostics();
    for (const { id, kind } of plan) this.deps.observations.saveDiagnostics(id, kind, entries, truncated);
  }

  /**
   * Links recent sessions to the commits that touched their edited files. Looks each session up at most every
   * few minutes, and only rewrites the stored links when they changed.
   */
  private async linkSessionCommits(now: number, getRepos: () => Promise<GitRepo[]>): Promise<void> {
    const sessions = this.deps.database.db
      .prepare(
        'SELECT id, started_at, ended_at FROM sessions WHERE ended_at >= :since ORDER BY ended_at DESC',
      )
      .all({ since: now - LINK_LOOKBACK_MS }) as unknown as {
      id: string;
      started_at: number;
      ended_at: number;
    }[];
    for (const session of sessions) {
      const editedPaths = this.editedPaths(session.id);
      if (editedPaths.length === 0) continue;
      const last = this.linked.get(session.id);
      if (last !== undefined && now - last.at < LINK_THROTTLE_MS && last.endedAt === session.ended_at)
        continue;
      const repos = await getRepos();
      const owning = repos.filter((repo) => editedPaths.some((path) => isWithin(path, repo.root)));
      this.linked.set(session.id, { at: now, endedAt: session.ended_at });
      if (owning.length === 0) continue;
      try {
        const commits = (
          await Promise.all(owning.map((repo) => repo.commitsSince(session.started_at)))
        ).flat();
        const links = linkCommits(
          { startedAt: session.started_at, endedAt: session.ended_at, editedPaths },
          commits,
        );
        const stored = this.deps.observations.sessionCommits(session.id);
        const unchanged =
          stored.length === links.length &&
          stored.every(
            (old, i) =>
              old.hash === links[i]?.hash &&
              old.overlapFiles === links[i].overlapFiles &&
              old.editedFiles === links[i].editedFiles,
          );
        if (!unchanged) {
          this.deps.observations.replaceSessionCommits(
            session.id,
            links.map((link) => ({ ...link, linkedAt: now })),
          );
        }
      } catch (error) {
        this.deps.log.warn(
          `Could not link commits for session ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private editedPaths(sessionId: string): string[] {
    return (
      this.deps.database.db
        .prepare(
          "SELECT DISTINCT path FROM file_events WHERE session_id = :id AND action IN ('edited', 'created')",
        )
        .all({ id: sessionId }) as unknown as { path: string }[]
    ).map((row) => row.path);
  }
}
