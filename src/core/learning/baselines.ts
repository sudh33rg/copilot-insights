import { mad, isOutlier, median, MIN_SAMPLE } from './stats';
import type { SessionFacts } from './sessionFacts';

export interface BaselineRow {
  taskType: string;
  model: string;
  n: number;
  inputMedian: number | null;
  inputMad: number | null;
  creditsMedian: number | null;
  creditSessions: number;
}

export interface SessionComparison {
  taskType: string;
  model: string;
  /** Other sessions of the same task type and model. */
  n: number;
  verdict: 'typical' | 'high' | 'low';
  median: number;
  typicalLow: number;
  typicalHigh: number;
  thisSession: number;
}

type Grouped = SessionFacts & { taskType: string; model: string; inputTokens: number };

const isGrouped = (facts: SessionFacts): facts is Grouped =>
  facts.taskType !== null && facts.model !== null && facts.inputTokens !== null;
const keyOf = (facts: { taskType: string; model: string }): string => `${facts.taskType}\u0000${facts.model}`;

function groups(facts: readonly SessionFacts[]): Map<string, Grouped[]> {
  const result = new Map<string, Grouped[]>();
  for (const session of facts.filter(isGrouped)) {
    result.set(keyOf(session), [...(result.get(keyOf(session)) ?? []), session]);
  }
  return result;
}

/** Typical input tokens (and credits) per task type and model; medians need at least `MIN_SAMPLE` sessions. */
export function baselineRows(facts: readonly SessionFacts[]): BaselineRow[] {
  return [...groups(facts).values()]
    .map((sessions): BaselineRow => {
      const [head] = sessions;
      const inputs = sessions.map((session) => session.inputTokens);
      const credits = sessions.flatMap((session) =>
        session.host === 'copilot' && session.credits !== null ? [session.credits] : [],
      );
      const enough = inputs.length >= MIN_SAMPLE;
      return {
        taskType: head?.taskType ?? '',
        model: head?.model ?? '',
        n: sessions.length,
        inputMedian: enough ? median(inputs) : null,
        inputMad: enough ? mad(inputs) : null,
        creditsMedian: credits.length >= MIN_SAMPLE ? median(credits) : null,
        creditSessions: credits.length,
      };
    })
    .sort((a, b) => b.n - a.n || a.taskType.localeCompare(b.taskType) || a.model.localeCompare(b.model));
}

/** How one session's input tokens compare with the user's other sessions of the same task type and model. */
export function compareToBaseline(
  facts: readonly SessionFacts[],
  session: SessionFacts,
): SessionComparison | null {
  if (!isGrouped(session)) return null;
  const others = (groups(facts).get(keyOf(session)) ?? []).filter((other) => other.id !== session.id);
  if (others.length < MIN_SAMPLE) return null;
  const inputs = others.map((other) => other.inputTokens);
  const center = median(inputs);
  const spread = mad(inputs);
  if (center === null || spread === null) return null;
  return {
    taskType: session.taskType,
    model: session.model,
    n: others.length,
    verdict: isOutlier(session.inputTokens, inputs) ?? 'typical',
    median: center,
    typicalLow: Math.max(0, center - spread),
    typicalHigh: center + spread,
    thisSession: session.inputTokens,
  };
}

const extremity = (comparison: SessionComparison): number =>
  comparison.verdict === 'high'
    ? comparison.thisSession / comparison.median
    : comparison.median / Math.max(comparison.thisSession, 1);

/** Sessions far from their own baseline, the most extreme (by ratio to the median) first. */
export function outliers(
  facts: readonly SessionFacts[],
): { session: SessionFacts; comparison: SessionComparison }[] {
  return facts
    .flatMap((session) => {
      const comparison = compareToBaseline(facts, session);
      return comparison === null || comparison.verdict === 'typical' ? [] : [{ session, comparison }];
    })
    .sort((a, b) => extremity(b.comparison) - extremity(a.comparison));
}

const int = (value: number): string => Math.round(value).toLocaleString('en-US');

/** "Your bugfix sessions on X normally use 40,000–60,000 input tokens … This one used 210,000." */
export function baselineMessage(comparison: SessionComparison): string {
  const low = Math.round(comparison.typicalLow);
  const high = Math.round(comparison.typicalHigh);
  const typical =
    low === high
      ? `about ${int(comparison.median)} input tokens (${String(comparison.n)} other sessions)`
      : `${int(low)}–${int(high)} input tokens (median ${int(comparison.median)}, ${String(comparison.n)} other sessions)`;
  const tail =
    comparison.verdict === 'high'
      ? ' That is unusually high.'
      : comparison.verdict === 'low'
        ? ' That is unusually low.'
        : '';
  return `Your ${comparison.taskType} sessions on ${comparison.model} normally use ${typical}. This one used ${int(comparison.thisSession)}.${tail}`;
}
