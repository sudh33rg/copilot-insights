import type {
  CommitCostRow,
  FailureAnalytics,
  Overview,
  SessionDetail,
  SessionList,
  SurvivalByModelRow,
} from '../../shared/dto';
import { AnalysisStore } from '../analysis/analysisStore';
import type { Database } from '../storage/database';
import { getCommitCosts } from './commitCosts';
import { getFailureAnalytics } from './failureAnalytics';
import { getOverview } from './overview';
import { getSessionDetail } from './sessionDetail';
import { listSessions, type SessionListQuery } from './sessionList';
import { getSurvivalByModel } from './survivalByModel';

/** What the extension exposes to the webview: raw queries plus cached analysis. */
export class InsightsQueries {
  private readonly analysis: AnalysisStore;

  constructor(private readonly database: Database) {
    this.analysis = new AnalysisStore(database);
  }

  listSessions(query: SessionListQuery): SessionList {
    const { rows, total } = listSessions(this.database, query);
    return {
      total,
      rows: rows.map((row) => ({ ...row, outcome: this.analysis.get(row.id)?.outcome.value ?? null })),
    };
  }

  getSession(id: string): SessionDetail | null {
    const detail = getSessionDetail(this.database, id);
    return detail === null ? null : { ...detail, analysis: this.analysis.forDetail(detail) };
  }

  getOverview(today: string): Overview {
    return getOverview(this.database, today);
  }

  getFailureAnalytics(): FailureAnalytics {
    return getFailureAnalytics(this.database);
  }

  getCommitCosts(): CommitCostRow[] {
    return getCommitCosts(this.database);
  }

  getSurvivalByModel(): SurvivalByModelRow[] {
    return getSurvivalByModel(this.database);
  }
}
