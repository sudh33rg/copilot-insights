import type { ClearScope } from '../../shared/dto';
import { META } from '../ingest/ingestService';
import type { Database } from '../storage/database';
import { LlmCallStore } from '../storage/llmCallStore';
import { ObservationStore } from '../storage/observationStore';
import type { IngestStateStore } from '../storage/ingestStateStore';
import type { SessionStore } from '../storage/sessionStore';

/** Scopes that remove sessions entirely (the others only remove conversation text). */
export function deletesSessions(scope: ClearScope): boolean {
  return scope.kind !== 'sessionContent' && scope.kind !== 'allContent';
}

/**
 * Clears this extension's index only. Tombstones make the result survive rescans, because Copilot's own files
 * (which we never modify) still contain the data.
 */
export class ClearService {
  constructor(
    private readonly database: Database,
    private readonly sessions: SessionStore,
    private readonly state: IngestStateStore,
    private readonly now: () => number = Date.now,
  ) {}

  count(scope: ClearScope): number {
    return this.idsFor(scope).length;
  }

  clear(scope: ClearScope): { sessions: number } {
    const ids = this.idsFor(scope);
    // "Everything" also clears session-less state (terminal runs, the privacy salt), even with no sessions.
    if (ids.length === 0 && scope.kind !== 'everything') return { sessions: 0 };
    const observations = new ObservationStore(this.database, this.now);
    this.database.transaction(() => {
      if (deletesSessions(scope)) {
        const deletedIds =
          scope.kind === 'everything'
            ? [
                ...new Set([
                  ...ids,
                  ...(
                    this.database.db
                      .prepare(
                        `SELECT session_id FROM debug_sessions
                UNION SELECT session_id FROM llm_calls
                UNION SELECT session_id FROM llm_tool_defs
                UNION SELECT session_id FROM llm_prompt_files`,
                      )
                      .all() as unknown as { session_id: string }[]
                  ).map((row) => row.session_id),
                ]),
              ]
            : ids;
        this.state.addTombstones(deletedIds, 'deleted', this.now());
        this.sessions.deleteSessions(ids);
        new LlmCallStore(this.database).deleteSessions(deletedIds);
        observations.deleteSessions(ids);
        if (scope.kind === 'everything') {
          this.database.db.exec('DELETE FROM github_daily_usage');
          observations.deleteAll();
          this.state.deleteMeta(META.salt);
        }
      } else {
        this.state.addTombstones(ids, 'content-cleared', this.now());
        this.sessions.clearContent(ids);
        observations.deleteSurvivalChecks(ids);
        if (scope.kind === 'allContent') observations.clearCommandHashes();
      }
    });
    return { sessions: ids.length };
  }

  private idsFor(scope: ClearScope): string[] {
    const { db } = this.database;
    const rows = (() => {
      switch (scope.kind) {
        case 'session':
        case 'sessionContent':
          return db.prepare('SELECT id FROM sessions WHERE id = :id').all({ id: scope.id });
        case 'beforeDay':
          return db.prepare('SELECT id FROM sessions WHERE day < :day').all({ day: scope.day });
        case 'workspace':
          return db
            .prepare('SELECT id FROM sessions WHERE workspace = :workspace')
            .all({ workspace: scope.workspace });
        case 'everything':
        case 'allContent':
          return db.prepare('SELECT id FROM sessions').all();
      }
    })() as unknown as { id: string }[];
    return rows.map((row) => row.id);
  }
}
