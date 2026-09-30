import type { SessionFacts } from './sessionFacts';
import { MIN_SAMPLE } from './stats';

export type PromptFeature = 'namesFile' | 'statesSuccess' | 'statesConstraints';
const FEATURES: readonly PromptFeature[] = ['namesFile', 'statesSuccess', 'statesConstraints'];

export interface PromptStyleSide {
  sessions: number;
  /** Mean corrections per session; null under `MIN_SAMPLE` sessions. */
  correctionsPerSession: number | null;
}

export interface PromptStyleRow {
  feature: PromptFeature;
  withFeature: PromptStyleSide;
  without: PromptStyleSide;
}

function side(corrections: readonly number[]): PromptStyleSide {
  return {
    sessions: corrections.length,
    correctionsPerSession:
      corrections.length < MIN_SAMPLE
        ? null
        : corrections.reduce((sum, value) => sum + value, 0) / corrections.length,
  };
}

/**
 * Whether opening-prompt habits go with fewer follow-up corrections in your own history (D-P6-5). Only sessions
 * with stored prompt text, a corrections count and at least two user turns take part (a one-turn session cannot
 * have a correction). A correlation, never a cause.
 */
export function promptStyle(facts: readonly SessionFacts[]): PromptStyleRow[] {
  const eligible = facts.flatMap((session) =>
    session.opening !== null && session.corrections !== null && session.userTurns >= 2
      ? [{ opening: session.opening, corrections: session.corrections }]
      : [],
  );
  return FEATURES.map((feature) => ({
    feature,
    withFeature: side(eligible.filter((entry) => entry.opening[feature]).map((entry) => entry.corrections)),
    without: side(eligible.filter((entry) => !entry.opening[feature]).map((entry) => entry.corrections)),
  }));
}
