import type {
  AutoAudit,
  Baselines,
  Leaderboard,
  PromptStyle,
  CommitCostRow,
  FailureAnalytics,
  Overview,
  RangeBreakdown,
  SessionDetail,
  SessionList,
  SurvivalByModelRow,
  TrendDay,
} from '../../shared/dto';
import { AnalysisStore } from '../analysis/analysisStore';
import type { Database } from '../storage/database';
import { getBaselines, sessionBaseline } from './baselineQueries';
import { getCommitCosts } from './commitCosts';
import { getFailureAnalytics } from './failureAnalytics';
import { autoAuditDto, leaderboardDto, promptStyleDto } from './learningQueries';
import { getOverview } from './overview';
import { SessionFactsStore } from './sessionFactsStore';
import { getSessionDetail } from './sessionDetail';
import { listSessions, type SessionListQuery } from './sessionList';
import { getSurvivalByModel } from './survivalByModel';
import { getRangeBreakdown, getTrends } from './trends';

/** What the extension exposes to the webview: raw queries plus cached analysis. */
export class InsightsQueries {
  private readonly analysis: AnalysisStore;
  private readonly facts: SessionFactsStore;

  constructor(private readonly database: Database) {
    this.analysis = new AnalysisStore(database);
    this.facts = new SessionFactsStore(database);
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
    if (detail === null) return null;
    return {
      ...detail,
      analysis: this.analysis.forDetail(detail),
      baseline: sessionBaseline(this.facts.all(), id),
    };
  }

  getTrends(toDay: string, days: number): TrendDay[] {
    return getTrends(this.database, toDay, days);
  }

  getRangeBreakdown(from: string, to: string): RangeBreakdown {
    return getRangeBreakdown(this.database, from, to);
  }

  getAutoAudit(): AutoAudit {
    return autoAuditDto(this.facts.all());
  }

  getPromptStyle(): PromptStyle {
    return promptStyleDto(this.facts.all());
  }

  getLeaderboard(): Leaderboard {
    return leaderboardDto(this.facts.all());
  }

  getBaselines(): Baselines {
    return getBaselines(this.database, this.facts.all());
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
