import type { Leaderboard, PromptStyle } from '../../shared/dto';
import { derived, inferred, unavailable, type Measured } from '../../shared/provenance';
import { leaderboard } from '../learning/leaderboard';
import { promptStyle, type PromptStyleSide } from '../learning/promptStyle';
import type { SessionFacts } from '../learning/sessionFacts';
import { notEnough } from '../learning/stats';

/** A statistic over sessions: derived when it exists, otherwise unavailable with how many sessions it had. */
function statistic(value: number | null, samples: number, source: string): Measured<number> {
  return value === null ? unavailable(notEnough(samples)) : derived(value, source);
}

export function leaderboardDto(facts: readonly SessionFacts[]): Leaderboard {
  return {
    groups: leaderboard(facts).map((group) => ({
      taskType: group.taskType,
      rows: group.rows.map((row) => ({
        model: row.model,
        sessions: row.sessions,
        successfulSessions: row.successfulSessions,
        creditSessions: row.creditSessions,
        creditsPerSuccess: statistic(
          row.creditsPerSuccess,
          row.samples.credits,
          'exact credits of successful Copilot sessions ÷ their count',
        ),
        correctionsPerSession: statistic(
          row.correctionsPerSession,
          row.samples.corrections,
          'follow-up prompts that read as corrections, per session with stored prompt text',
        ),
        editKeepRate: statistic(
          row.editKeepRate,
          row.samples.editKeep,
          'mean of each session’s kept ÷ (kept + undone + modified) from Copilot editedFileEvents',
        ),
        failureRate: statistic(
          row.failureRate,
          row.sessions,
          'failed user turns ÷ user turns across these sessions',
        ),
        ttftMs: statistic(
          row.ttftMs,
          row.samples.latency,
          'mean of each session’s mean first-token latency (agent debug log)',
        ),
      })),
    })),
  };
}

const STYLE_SOURCE =
  'mean corrections per session, split by whether the opening prompt had the feature (keyword rules; a correlation, not a cause)';

function styleSide(side: PromptStyleSide) {
  return {
    sessions: side.sessions,
    correctionsPerSession:
      side.correctionsPerSession === null
        ? unavailable<number>(notEnough(side.sessions))
        : inferred(side.correctionsPerSession, STYLE_SOURCE),
  };
}

export function promptStyleDto(facts: readonly SessionFacts[]): PromptStyle {
  return {
    rows: promptStyle(facts).map((row) => ({
      feature: row.feature,
      withFeature: styleSide(row.withFeature),
      without: styleSide(row.without),
    })),
  };
}
