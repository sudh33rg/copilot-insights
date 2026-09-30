import type { NormalizedSession, NormalizedTurn } from '../ingest/types';
import { redactDeep, redactSecrets } from './redact';

export type CaptureLevel = 'metrics' | 'summaries' | 'full';
export const CAPTURE_LEVELS: readonly CaptureLevel[] = ['metrics', 'summaries', 'full'];
export const SUMMARY_LIMITS = { user: 260, assistant: 420, error: 200, title: 120 } as const;

export function isCaptureLevel(value: unknown): value is CaptureLevel {
  return typeof value === 'string' && (CAPTURE_LEVELS as readonly string[]).includes(value);
}

/**
 * full      – text and tool arguments, secrets redacted
 * summaries – one-line truncated text, secrets redacted, no tool arguments
 * metrics   – no text, titles, error messages, or tool arguments; telemetry and file paths only
 */
export function applyCaptureLevel(session: NormalizedSession, level: CaptureLevel): NormalizedSession {
  return {
    ...session,
    title: captureText(session.title, level, SUMMARY_LIMITS.title),
    turns: session.turns.map((turn) => captureTurn(turn, level)),
  };
}

function captureTurn(turn: NormalizedTurn, level: CaptureLevel): NormalizedTurn {
  return {
    ...turn,
    userText: captureText(turn.userText, level, SUMMARY_LIMITS.user),
    assistantText: captureText(turn.assistantText, level, SUMMARY_LIMITS.assistant),
    errorMessage: captureText(turn.errorMessage, level, SUMMARY_LIMITS.error),
    toolCalls: turn.toolCalls.map((call) => ({
      ...call,
      args:
        level === 'full' && call.args !== null ? (redactDeep(call.args) as Record<string, unknown>) : null,
    })),
  };
}

function captureText(value: string | null, level: CaptureLevel, limit: number): string | null {
  if (value === null || level === 'metrics') return null;
  // Redact before truncating so a secret cut in half cannot slip past the patterns.
  const redacted = redactSecrets(value);
  return level === 'full' ? redacted : truncate(redacted, limit);
}

export function truncate(value: string, limit: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, limit - 1).trimEnd()}…`;
}
