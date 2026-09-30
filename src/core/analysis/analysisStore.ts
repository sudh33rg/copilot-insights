import { analysisSchema, type Analysis, type SessionDetail } from '../../shared/dto';
import type { Database } from '../storage/database';
import { getSessionDetail } from '../query/sessionDetail';
import { ObservationReader } from '../storage/observationStore';
import { ANALYZER_VERSION, analyzeSession } from './analyzeSession';

interface CacheRow {
  ingested_at: number;
  analyzer_version: number | null;
  observed_at: number | null;
  json: string | null;
}

/**
 * Caches analysis per session; valid while the analyzer version and the session's ingest time match and no
 * live observation (git, diagnostics, terminal, survival) changed since it was computed.
 */
export class AnalysisStore {
  constructor(private readonly database: Pick<Database, 'db'>) {}

  get(id: string): Analysis | null {
    const cached = this.readCache(id);
    if (cached === 'missing-session') return null;
    if (cached !== null) return cached;
    const detail = getSessionDetail(this.database, id);
    return detail === null ? null : this.compute(detail);
  }

  forDetail(detail: SessionDetail): Analysis {
    const cached = this.readCache(detail.id);
    if (cached !== null && cached !== 'missing-session') return cached;
    return this.compute(detail);
  }

  private compute(detail: SessionDetail): Analysis {
    // Read before computing: a change that lands mid-compute then still marks the cached row stale.
    const observedAt = new ObservationReader(this.database).changedAt(detail.id);
    const analysis = analyzeSession(detail);
    const ingestedAt = this.ingestedAt(detail.id);
    if (ingestedAt !== null) {
      this.database.db
        .prepare(
          `INSERT INTO session_analysis (session_id, analyzer_version, ingested_at, observed_at, json)
           VALUES (:id, :version, :ingestedAt, :observedAt, :json)
           ON CONFLICT(session_id) DO UPDATE SET analyzer_version = excluded.analyzer_version,
             ingested_at = excluded.ingested_at, observed_at = excluded.observed_at, json = excluded.json`,
        )
        .run({
          id: detail.id,
          version: ANALYZER_VERSION,
          ingestedAt,
          observedAt,
          json: JSON.stringify(analysis),
        });
    }
    return analysis;
  }

  private ingestedAt(id: string): number | null {
    const row = this.database.db.prepare('SELECT ingested_at FROM sessions WHERE id = :id').get({ id }) as
      { ingested_at: number } | undefined;
    return row?.ingested_at ?? null;
  }

  private readCache(id: string): Analysis | 'missing-session' | null {
    const row = this.database.db
      .prepare(
        `SELECT s.ingested_at, a.analyzer_version, a.observed_at, a.json
           FROM sessions s LEFT JOIN session_analysis a ON a.session_id = s.id WHERE s.id = :id`,
      )
      .get({ id }) as unknown as CacheRow | undefined;
    if (row === undefined) return 'missing-session';
    if (row.json === null || row.analyzer_version !== ANALYZER_VERSION) return null;
    if ((row.observed_at ?? 0) < new ObservationReader(this.database).changedAt(id)) return null;
    try {
      const parsed = analysisSchema.safeParse(JSON.parse(row.json));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
