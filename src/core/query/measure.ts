import { derived, exact, unavailable, type Measured } from '../../shared/provenance';
import type { TurnState } from '../ingest/types';

/** Names the concrete Copilot fields these numbers come from (shown in provenance tooltips). */
export const SOURCES = {
  inputTokens: 'chatSessions.promptTokens',
  outputTokens: 'chatSessions.completionTokens',
  credits: 'chatSessions.copilotCredits',
} as const;

/**
 * Trust level of a sum of nullable per-turn values. `withValue` is how many turns reported a value and
 * `expected` how many should have: exact when all did, a derived lower bound when only some did, and
 * unavailable (never zero) when none did.
 */
export function summed(
  sum: number | null,
  withValue: number,
  expected: number,
  source: string,
): Measured<number> {
  if (sum === null || withValue === 0) return unavailable(source);
  if (withValue >= expected) return exact(sum, source);
  return derived(
    sum,
    `${source} (lower bound: ${String(withValue)} of ${String(expected)} turns reported it)`,
  );
}

export function known(value: number | null, source: string): Measured<number> {
  return value === null ? unavailable(source) : exact(value, source);
}

const TURN_STATES: readonly TurnState[] = ['pending', 'complete', 'cancelled', 'failed', 'unknown'];

export function toTurnState(value: string | null): TurnState {
  return TURN_STATES.find((state) => state === value) ?? 'unknown';
}
