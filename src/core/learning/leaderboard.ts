import type { SessionFacts } from './sessionFacts';
import { MIN_SAMPLE } from './stats';

export interface LeaderboardRow {
  taskType: string;
  model: string;
  sessions: number;
  successfulSessions: number;
  /** Mean exact credits of successful Copilot sessions; null under `MIN_SAMPLE` of them. */
  creditsPerSuccess: number | null;
  /** Successful Copilot sessions with exact credits behind `creditsPerSuccess`. */
  creditSessions: number;
  /** Mean corrections over sessions with stored prompt text. */
  correctionsPerSession: number | null;
  editKeepRate: number | null;
  /** Failed turns ÷ user turns over the group. */
  failureRate: number | null;
  ttftMs: number | null;
  /** How many sessions each metric could use, for "not enough data: n of 5". */
  samples: { credits: number; corrections: number; editKeep: number; latency: number };
}

type Grouped = SessionFacts & { taskType: string; model: string };

const isGrouped = (facts: SessionFacts): facts is Grouped => facts.taskType !== null && facts.model !== null;

/** Mean of the values, or null when fewer than `MIN_SAMPLE` sessions had one. */
function enoughMean(values: readonly number[]): number | null {
  return values.length < MIN_SAMPLE ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

const present = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);

function rowFor(sessions: readonly Grouped[]): LeaderboardRow {
  const [head] = sessions;
  const creditSessions = sessions.filter(
    (session) => session.successful && session.host === 'copilot' && session.credits !== null,
  );
  const userTurns = sessions.reduce((sum, session) => sum + session.userTurns, 0);
  const failedTurns = sessions.reduce((sum, session) => sum + session.failedTurns, 0);
  return {
    taskType: head?.taskType ?? '',
    model: head?.model ?? '',
    sessions: sessions.length,
    successfulSessions: sessions.filter((session) => session.successful).length,
    creditsPerSuccess: enoughMean(present(creditSessions.map((session) => session.credits))),
    creditSessions: creditSessions.length,
    correctionsPerSession: enoughMean(present(sessions.map((session) => session.corrections))),
    editKeepRate: enoughMean(present(sessions.map((session) => session.editKeepRate))),
    failureRate: sessions.length >= MIN_SAMPLE && userTurns > 0 ? failedTurns / userTurns : null,
    ttftMs: enoughMean(present(sessions.map((session) => session.ttftMs))),
    samples: {
      credits: creditSessions.length,
      corrections: present(sessions.map((session) => session.corrections)).length,
      editKeep: present(sessions.map((session) => session.editKeepRate)).length,
      latency: present(sessions.map((session) => session.ttftMs)).length,
    },
  };
}

/**
 * Which models have worked best for you, per task type. A task type appears only when at least one model has five
 * sessions; every metric needs five sessions that have it (D-P6-1).
 */
export function leaderboard(facts: readonly SessionFacts[]): { taskType: string; rows: LeaderboardRow[] }[] {
  const byType = new Map<string, Map<string, Grouped[]>>();
  for (const session of facts.filter(isGrouped)) {
    const models = byType.get(session.taskType) ?? new Map<string, Grouped[]>();
    models.set(session.model, [...(models.get(session.model) ?? []), session]);
    byType.set(session.taskType, models);
  }
  return [...byType]
    .map(([taskType, models]) => ({
      taskType,
      rows: [...models.values()]
        .map(rowFor)
        .sort((a, b) => b.successfulSessions - a.successfulSessions || a.model.localeCompare(b.model)),
    }))
    .filter((group) => group.rows.some((row) => row.sessions >= MIN_SAMPLE))
    .sort((a, b) => a.taskType.localeCompare(b.taskType));
}
