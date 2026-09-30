import type { TerminalRun } from '../storage/observationStore';

export const SLACK_AFTER_MS = 60_000;
export const SLACK_BEFORE_MS = 5_000;
export const SYSTEM_LEAD_MS = 120_000;

export interface MatchTurn {
  index: number;
  startedAt: number | null;
  endedAt: number | null;
  systemInitiated: boolean;
  terminalCalls: { commandHash: string | null }[];
}

export interface TerminalMatch {
  matched: { run: TerminalRun; turnIdx: number; via: 'command-hash' | 'system-turn-time' }[];
  /** Terminal tool calls Copilot made; more than `matched.length` means observation was partial. */
  terminalCallCount: number;
}

/**
 * Ties observed terminal runs to a session. Pass 1 pairs a tool call with the earliest unused run of the same
 * command hash near its turn; pass 2 credits leftover runs that ended just before a system-initiated turn (the
 * agent was woken up by a terminal finishing). Every run and every tool call is used at most once.
 */
export function matchTerminalRuns(turns: readonly MatchTurn[], runs: readonly TerminalRun[]): TerminalMatch {
  const ordered = [...runs].sort((a, b) => a.endedAt - b.endedAt);
  const used = new Set<TerminalRun>();
  const matched: TerminalMatch['matched'] = [];

  for (const turn of turns) {
    if (turn.startedAt === null || turn.endedAt === null) continue;
    const from = turn.startedAt - SLACK_BEFORE_MS;
    const to = turn.endedAt + SLACK_AFTER_MS;
    for (const call of turn.terminalCalls) {
      if (call.commandHash === null) continue;
      const run = ordered.find(
        (candidate) =>
          !used.has(candidate) &&
          candidate.commandHash === call.commandHash &&
          candidate.endedAt >= from &&
          candidate.endedAt <= to,
      );
      if (run === undefined) continue;
      used.add(run);
      matched.push({ run, turnIdx: turn.index, via: 'command-hash' });
    }
  }

  for (const turn of turns) {
    if (!turn.systemInitiated || turn.startedAt === null) continue;
    for (const run of ordered) {
      if (used.has(run)) continue;
      if (run.endedAt >= turn.startedAt - SYSTEM_LEAD_MS && run.endedAt <= turn.startedAt + SLACK_BEFORE_MS) {
        used.add(run);
        matched.push({ run, turnIdx: turn.index, via: 'system-turn-time' });
      }
    }
  }

  return { matched, terminalCallCount: turns.reduce((sum, turn) => sum + turn.terminalCalls.length, 0) };
}
