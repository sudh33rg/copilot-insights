import type { SessionFacts } from './sessionFacts';
import { MIN_SAMPLE } from './stats';

export interface AuditSide {
  sessions: number;
  creditsPerSession: number | null;
  failureRate: number | null;
  editKeepRate: number | null;
  /** Sessions behind `creditsPerSession` / `editKeepRate`, for "not enough data: n of 5". */
  creditSamples: number;
  keepSamples: number;
}

export interface AuditRow {
  taskType: string;
  auto: AuditSide;
  manual: AuditSide;
}

type Classified = SessionFacts & { taskType: string };

function enoughMean(values: readonly number[]): number | null {
  return values.length < MIN_SAMPLE ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function side(sessions: readonly Classified[]): AuditSide {
  const credits = sessions.flatMap((session) =>
    session.host === 'copilot' && session.credits !== null ? [session.credits] : [],
  );
  const keeps = sessions.flatMap((session) => (session.editKeepRate === null ? [] : [session.editKeepRate]));
  const userTurns = sessions.reduce((sum, session) => sum + session.userTurns, 0);
  const failed = sessions.reduce((sum, session) => sum + session.failedTurns, 0);
  return {
    sessions: sessions.length,
    creditsPerSession: enoughMean(credits),
    failureRate: sessions.length >= MIN_SAMPLE && userTurns > 0 ? failed / userTurns : null,
    editKeepRate: enoughMean(keeps),
    creditSamples: credits.length,
    keepSamples: keeps.length,
  };
}

/**
 * Auto routing against your own manual picks, per task type. Only sessions fully on Auto or fully manual take part;
 * a task type appears when both sides have sessions and at least one has `MIN_SAMPLE`. Neutral by construction:
 * it reports numbers and sample sizes, never a verdict.
 */
export function autoAudit(facts: readonly SessionFacts[]): AuditRow[] {
  const byType = new Map<string, { auto: Classified[]; manual: Classified[] }>();
  for (const session of facts) {
    if (session.taskType === null || (session.selection !== 'auto' && session.selection !== 'manual'))
      continue;
    const classified = { ...session, taskType: session.taskType };
    const entry = byType.get(session.taskType) ?? { auto: [], manual: [] };
    entry[session.selection].push(classified);
    byType.set(session.taskType, entry);
  }
  return [...byType]
    .filter(([, sides]) => sides.auto.length > 0 && sides.manual.length > 0)
    .filter(([, sides]) => Math.max(sides.auto.length, sides.manual.length) >= MIN_SAMPLE)
    .map(([taskType, sides]): AuditRow => ({ taskType, auto: side(sides.auto), manual: side(sides.manual) }))
    .sort((a, b) => a.taskType.localeCompare(b.taskType));
}
