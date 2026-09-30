import { describe, expect, it } from 'vitest';
import { many } from '../../../test/fixtures/facts';
import { leaderboardDto } from './learningQueries';

describe('leaderboardDto', () => {
  const facts = [
    ...many(6, { model: 'model-a', credits: 2, corrections: 1, editKeepRate: 0.5, ttftMs: 1000 }),
    ...many(4, { model: 'model-b', credits: 1 }),
  ];

  it('turns each metric into a measured value with its rule as the source', () => {
    const [group] = leaderboardDto(facts).groups;
    const a = group?.rows.find((row) => row.model === 'model-a');
    expect(group?.taskType).toBe('bugfix');
    expect(a).toMatchObject({ sessions: 6, successfulSessions: 6, creditSessions: 6 });
    expect(a?.creditsPerSuccess).toEqual({
      value: 2,
      provenance: { kind: 'derived', source: 'exact credits of successful Copilot sessions ÷ their count' },
    });
    expect(a?.correctionsPerSession.value).toBe(1);
    expect(a?.editKeepRate.value).toBe(0.5);
    expect(a?.failureRate.value).toBe(0);
    expect(a?.failureRate.provenance.source).toBe('failed user turns ÷ user turns across these sessions');
    expect(a?.ttftMs.value).toBe(1000);
  });

  it('marks a metric unavailable with the number of sessions it had', () => {
    const [group] = leaderboardDto(facts).groups;
    const b = group?.rows.find((row) => row.model === 'model-b');
    expect(b?.creditsPerSuccess).toEqual({
      value: null,
      provenance: { kind: 'unavailable', source: 'not enough data: 4 of 5 sessions' },
    });
    expect(b?.correctionsPerSession.provenance.source).toBe('not enough data: 4 of 5 sessions');
    expect(b?.ttftMs.provenance.source).toBe('not enough data: 0 of 5 sessions');
    expect(b?.failureRate.provenance.source).toBe('not enough data: 4 of 5 sessions');
  });

  it('has no groups without enough sessions', () => {
    expect(leaderboardDto(many(3)).groups).toEqual([]);
  });
});
