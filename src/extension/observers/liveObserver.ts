import type { Database } from '../../core/storage/database';
import { LIVE_WINDOW_MS, shouldBaseline, takeSnapshot } from '../../core/git/snapshots';
import type { GitPort } from '../../core/git/types';
import type { ObservationStore } from '../../core/storage/observationStore';

export interface LiveObserverDeps {
  database: Database;
  observations: ObservationStore;
  git: GitPort;
  now?: () => number;
  log: { warn(message: string): void };
}

export class LiveObserver {
  private running = false;
  constructor(private readonly deps: LiveObserverDeps) {}

  /** Idempotent and re-entrancy safe; called after every sync and on a 60 s timer. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.observeGit();
    } catch (error) {
      this.deps.log.warn(
        `Live observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
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

  private async observeGit(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    const sessions = this.liveSessions(now);
    if (sessions.length === 0) return;
    const repos = await this.deps.git.repos();
    if (repos.length === 0) return;
    for (const session of sessions) {
      const hasStart = this.deps.observations.getSnapshots(session.id, 'start').length > 0;
      const kind = hasStart
        ? 'latest'
        : shouldBaseline({ hasStart, firstTurnStartedAt: session.firstTurnStartedAt, now })
          ? 'start'
          : null;
      if (kind === null) continue;
      for (const repo of repos) {
        this.deps.observations.saveSnapshot({
          sessionId: session.id,
          kind,
          ...(await takeSnapshot(repo, now)),
        });
      }
    }
  }
}
