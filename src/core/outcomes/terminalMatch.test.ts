import { describe, expect, it } from 'vitest';
import { matchTerminalRuns } from './terminalMatch';

const T0 = 1_000_000;
const turns = [
  {
    index: 1,
    startedAt: T0,
    endedAt: T0 + 60_000,
    systemInitiated: false,
    terminalCalls: [{ commandHash: 'hTest' }, { commandHash: 'hBuild' }],
  },
  { index: 2, startedAt: T0 + 300_000, endedAt: T0 + 310_000, systemInitiated: true, terminalCalls: [] },
];
const run = (endedAt: number, commandHash: string, exitCode: number | null = 0) => ({
  startedAt: endedAt - 1000,
  endedAt,
  exitCode,
  kind: 'test' as const,
  commandHash,
});

describe('matchTerminalRuns', () => {
  it('matches by command hash inside the turn window', () => {
    const r = matchTerminalRuns(turns, [run(T0 + 30_000, 'hTest', 1)]);
    expect(r.matched).toEqual([expect.objectContaining({ turnIdx: 1, via: 'command-hash' })]);
  });
  it('does not match the same hash outside the window plus slack', () => {
    expect(matchTerminalRuns(turns, [run(T0 + 500_000, 'hTest')]).matched).toEqual([]);
  });
  it('uses each run and each tool call at most once', () => {
    const r = matchTerminalRuns(turns, [run(T0 + 10_000, 'hTest'), run(T0 + 20_000, 'hTest')]);
    expect(r.matched).toHaveLength(1);
  });
  it('attributes an unmatched run that ended shortly before a system-initiated turn to that turn', () => {
    const r = matchTerminalRuns(turns, [run(T0 + 290_000, 'hDev')]);
    expect(r.matched).toEqual([expect.objectContaining({ turnIdx: 2, via: 'system-turn-time' })]);
  });
  it('counts terminal tool calls so callers can tell when observation was partial', () => {
    expect(matchTerminalRuns(turns, []).terminalCallCount).toBe(2);
  });
  it('keeps a null exit code (no shell integration) as null', () => {
    expect(matchTerminalRuns(turns, [run(T0 + 30_000, 'hTest', null)]).matched[0]?.run.exitCode).toBeNull();
  });
  it('never matches a tool call that has no command hash', () => {
    const noHash = [
      {
        index: 1,
        startedAt: T0,
        endedAt: T0 + 60_000,
        systemInitiated: false,
        terminalCalls: [{ commandHash: null }],
      },
    ];
    expect(matchTerminalRuns(noHash, [run(T0 + 10_000, 'hTest')]).matched).toEqual([]);
  });
  it('does not attribute a run to a system turn it ended long before', () => {
    expect(matchTerminalRuns(turns, [run(T0 + 100_000, 'hDev')]).matched).toEqual([]);
  });
});
