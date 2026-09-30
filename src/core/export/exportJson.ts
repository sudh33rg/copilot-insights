import type { SessionDetail } from '../../shared/dto';
import type { Database } from '../storage/database';
import { getSessionDetail } from '../query/sessionDetail';

export interface ExportDocument {
  format: 'copilot-insights-export';
  version: 1;
  exportedAt: string;
  sessions: SessionDetail[];
}

/** The whole index as JSON: exactly what the dashboard can show (so no tool arguments), at the stored capture level. */
export function exportIndex(database: Pick<Database, 'db'>, now: number): ExportDocument {
  const ids = (
    database.db.prepare('SELECT id FROM sessions ORDER BY started_at, id').all() as unknown as {
      id: string;
    }[]
  ).map((row) => row.id);
  return {
    format: 'copilot-insights-export',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    sessions: ids.flatMap((id) => getSessionDetail(database, id) ?? []),
  };
}
