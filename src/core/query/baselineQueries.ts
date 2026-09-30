import type { Baseline, Baselines } from '../../shared/dto';
import { derived, inferred, unavailable, type Measured } from '../../shared/provenance';
import {
  baselineMessage,
  baselineRows,
  compareToBaseline,
  outliers,
  type SessionComparison,
} from '../learning/baselines';
import type { SessionFacts } from '../learning/sessionFacts';
import { notEnough } from '../learning/stats';
import type { Database } from '../storage/database';

const MEDIAN_SOURCE = 'median ± MAD of your other sessions of the same task type on the same model';
const VERDICT_SOURCE = 'more than 3 scaled MADs and 1.5× from the median of your other sessions';

const verdictOf = (comparison: SessionComparison): Measured<'typical' | 'high' | 'low'> =>
  inferred(comparison.verdict, VERDICT_SOURCE);

/** How one session compares with the user's other sessions; null without at least five comparable ones. */
export function sessionBaseline(facts: readonly SessionFacts[], id: string): Baseline | null {
  const session = facts.find((entry) => entry.id === id);
  const comparison = session === undefined ? null : compareToBaseline(facts, session);
  if (comparison === null) return null;
  return {
    taskType: comparison.taskType,
    model: comparison.model,
    sessions: comparison.n,
    verdict: verdictOf(comparison),
    median: derived(comparison.median, MEDIAN_SOURCE),
    typicalLow: derived(comparison.typicalLow, MEDIAN_SOURCE),
    typicalHigh: derived(comparison.typicalHigh, MEDIAN_SOURCE),
    thisSession: derived(comparison.thisSession, 'chatSessions.promptTokens'),
    message: baselineMessage(comparison),
  };
}

/** Typical usage per task type and model, and the sessions that stand out from their own baseline. */
export function getBaselines(database: Pick<Database, 'db'>, facts: readonly SessionFacts[]): Baselines {
  const flagged = outliers(facts);
  const titles = new Map(
    (
      database.db.prepare('SELECT id, title FROM sessions').all() as unknown as {
        id: string;
        title: string | null;
      }[]
    ).map((row) => [row.id, row.title]),
  );
  return {
    rows: baselineRows(facts).map((row) => ({
      taskType: row.taskType,
      model: row.model,
      sessions: row.n,
      inputMedian:
        row.inputMedian === null
          ? unavailable(notEnough(row.n))
          : derived(row.inputMedian, 'median input tokens of your sessions of this task type on this model'),
      creditsMedian:
        row.creditsMedian === null
          ? unavailable(notEnough(row.creditSessions))
          : derived(
              row.creditsMedian,
              'median exact Copilot credits of your sessions of this task type on this model',
            ),
      creditSessions: row.creditSessions,
    })),
    outliers: flagged.map(({ session, comparison }) => ({
      sessionId: session.id,
      title: titles.get(session.id) ?? null,
      taskType: comparison.taskType,
      model: comparison.model,
      verdict: verdictOf(comparison),
      thisSession: derived(comparison.thisSession, 'chatSessions.promptTokens'),
      median: derived(comparison.median, MEDIAN_SOURCE),
    })),
  };
}
