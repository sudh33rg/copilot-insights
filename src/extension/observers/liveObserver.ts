import type { Database } from '../../core/storage/database';
import { LIVE_WINDOW_MS, shouldBaseline, takeSnapshot } from '../../core/git/snapshots';
import type { GitPort } from '../../core/git/types';
import { SurvivalChecker } from '../../core/outcomes/survival';
import type { DiagEntry, ObservationStore, SnapshotKind } from '../../core/storage/observationStore';

export interface LiveObserverDeps {
  database: Database;
  observations: ObservationStore;
  git: GitPort;
  /** File text, `null` when the file is gone; rejects when it exists but cannot be read. */
  readFile(path: string): Promise<string | null>;
  salt(): string;
  /** Current error/warning counts per file; counts only, never message text. */
  diagnostics(): DiagEntry[];
  now?: () => number;
  log: { warn(message: string): void };
}

export class LiveObserver {
  private running = false;
  private readonly survival: SurvivalChecker;

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
      await this.step(() => this.observeGit(plan, now));
      await this.step(() => {
        this.observeDiagnostics(plan);
        return Promise.resolve();
      });
      await this.step(() => this.survival.run());
    } finally {
      this.running = false;
    }
  }

  private async step(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.deps.log.warn(
        `Live observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private liveSessions(now: number): { id: string; firstTurnStartedAt: number | null }[] {
    return this.deps.database.db
      .prepare(
        `SELECT s.id, (SELECT MIN(started_at) FROM turns t WHERE t.session_id = s.id) AS firstTurnStartedAt
           FROM sessions s WHERE s.ended_at >= :since`,
      )
      .all({ since: now - LIVE_WINDOW_MS }) as unknown as { id: string; firstTurnStartedAt: number | null }[];
  }

  /**
   * Which live sessions to observe and as what. Decided once per tick, before any step writes, so every step
   * agrees on whether this is the session's baseline (`start`) or a later observation (`latest`). A session
   * whose first turn is too old to baseline is skipped: a late "start" would hide what had already changed.
   */
  private plan(now: number): { id: string; kind: SnapshotKind }[] {
    const { observations } = this.deps;
    return this.liveSessions(now).flatMap((session): { id: string; kind: SnapshotKind }[] => {
      const hasStart =
        observations.getSnapshots(session.id, 'start').length > 0 ||
        observations.hasDiagnostics(session.id, 'start');
      if (hasStart) return [{ id: session.id, kind: 'latest' }];
      return shouldBaseline({ hasStart, firstTurnStartedAt: session.firstTurnStartedAt, now })
        ? [{ id: session.id, kind: 'start' }]
        : [];
    });
  }

  private async observeGit(plan: readonly { id: string; kind: SnapshotKind }[], now: number): Promise<void> {
    if (plan.length === 0) return;
    const repos = await this.deps.git.repos();
    for (const { id, kind } of plan) {
      for (const repo of repos) {
        this.deps.observations.saveSnapshot({ sessionId: id, kind, ...(await takeSnapshot(repo, now)) });
      }
    }
  }

  private observeDiagnostics(plan: readonly { id: string; kind: SnapshotKind }[]): void {
    if (plan.length === 0) return;
    const entries = this.deps.diagnostics();
    for (const { id, kind } of plan) this.deps.observations.saveDiagnostics(id, kind, entries);
  }
}
