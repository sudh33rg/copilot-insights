import { ANALYZER_VERSION } from '../analysis/analyzeSession';
import { AnalysisStore } from '../analysis/analysisStore';
import { sessionFactsFromDetail, type SessionFacts } from '../learning/sessionFacts';
import type { Database } from '../storage/database';
import { getSessionDetail } from './sessionDetail';

/**
 * Per-session facts for every session in the index, rebuilt only when the data changed. The version key is one
 * cheap query: session count, newest ingest time, newest live observation and the analyzer version.
 */
export class SessionFactsStore {
  private cached: { key: string; facts: SessionFacts[] } | null = null;
  private readonly analysis: AnalysisStore;

  constructor(private readonly database: Pick<Database, 'db'>) {
    this.analysis = new AnalysisStore(database);
  }

  all(): SessionFacts[] {
    const key = this.versionKey();
    if (this.cached?.key === key) return this.cached.facts;
    const ids = (
      this.database.db.prepare('SELECT id FROM sessions ORDER BY started_at, id').all() as unknown as {
        id: string;
      }[]
    ).map((row) => row.id);
    const facts = ids.flatMap((id) => {
      const detail = getSessionDetail(this.database, id);
      return detail === null
        ? []
        : [sessionFactsFromDetail({ ...detail, analysis: this.analysis.forDetail(detail) })];
    });
    this.cached = { key: this.versionKey(), facts };
    return facts;
  }

  private versionKey(): string {
    const { db } = this.database;
    const sessions = db
      .prepare('SELECT count(*) AS n, coalesce(max(ingested_at), 0) AS ingested FROM sessions')
      .get() as unknown as { n: number; ingested: number };
    const observed = db
      .prepare('SELECT coalesce(max(changed_at), 0) AS changed FROM observation_changes')
      .get() as unknown as { changed: number };
    // total_changes sees local clears/debug updates; data_version sees writes by other VS Code windows.
    const revision = db.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    const external = db.prepare('PRAGMA data_version').get() as { data_version: number };
    return `${String(revision.changes)}|${String(external.data_version)}|${String(sessions.n)}|${String(sessions.ingested)}|${String(observed.changed)}|${String(ANALYZER_VERSION)}`;
  }
}
