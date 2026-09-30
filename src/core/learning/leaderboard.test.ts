import { describe, expect, it } from 'vitest';
import { fact, many } from '../../../test/fixtures/facts';
import { leaderboard } from './leaderboard';

const byModel = (group: ReturnType<typeof leaderboard>[number] | undefined, model: string) =>
  group?.rows.find((row) => row.model === model);

describe('leaderboard', () => {
  it('ranks models within a task type using only the evidence each metric has', () => {
    const groups = leaderboard([
      // model-a: 7 sessions, 5 successful with exact credits 2, two failed ones with credits 10 (excluded)
      ...many(5, { model: 'model-a', credits: 2, corrections: 1, editKeepRate: 0.5, ttftMs: 1000 }),
      ...many(2, {
        model: 'model-a',
        credits: 10,
        corrections: 3,
        failedTurns: 1,
        successful: false,
        editKeepRate: 0.25,
        ttftMs: 3000,
      }),
      // model-b: 6 successful sessions with credits 1 and no stored prompt text
      ...many(6, { model: 'model-b', credits: 1, corrections: null, editKeepRate: 1, ttftMs: 500 }),
    ]);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group?.taskType).toBe('bugfix');
    const a = byModel(group, 'model-a');
    expect(a).toMatchObject({ sessions: 7, successfulSessions: 5, creditSessions: 5 });
    expect(a?.creditsPerSuccess).toBe(2);
    expect(a?.correctionsPerSession).toBeCloseTo((5 * 1 + 2 * 3) / 7);
    expect(a?.editKeepRate).toBeCloseTo((5 * 0.5 + 2 * 0.25) / 7);
    expect(a?.failureRate).toBeCloseTo(2 / 21); // 2 failed turns over 7 sessions × 3 user turns
    expect(a?.ttftMs).toBeCloseTo((5 * 1000 + 2 * 3000) / 7);
    const b = byModel(group, 'model-b');
    expect(b).toMatchObject({ sessions: 6, successfulSessions: 6, creditSessions: 6, creditsPerSuccess: 1 });
    expect(b?.correctionsPerSession).toBeNull();
    expect(group?.rows.map((row) => row.model)).toEqual(['model-b', 'model-a']); // most successful first
  });

  it('has no metric for a model with fewer than five sessions, but still lists it beside a full one', () => {
    const [group] = leaderboard([...many(6, { model: 'model-a' }), ...many(4, { model: 'model-b' })]);
    expect(byModel(group, 'model-b')).toMatchObject({
      sessions: 4,
      creditsPerSuccess: null,
      correctionsPerSession: null,
      editKeepRate: null,
      failureRate: null,
      ttftMs: null,
    });
  });

  it('omits a task type where no model has five sessions', () => {
    expect(leaderboard([...many(4, { model: 'model-a' }), ...many(4, { model: 'model-b' })])).toEqual([]);
  });

  it('skips BYOK sessions for credits but keeps them for failures and latency', () => {
    const [group] = leaderboard(
      many(6, { model: 'local', host: 'byok', credits: null, ttftMs: 700, failedTurns: 1 }),
    );
    const row = byModel(group, 'local');
    expect(row).toMatchObject({ creditSessions: 0, creditsPerSuccess: null });
    expect(row?.ttftMs).toBe(700);
    expect(row?.failureRate).toBeCloseTo(6 / 18);
  });

  it('reports how many sessions each metric rests on', () => {
    const [group] = leaderboard([
      ...many(4, { model: 'm', corrections: 1, editKeepRate: 0.5 }),
      ...many(3, { model: 'm', corrections: null, ttftMs: 100 }),
    ]);
    expect(byModel(group, 'm')?.samples).toEqual({ credits: 7, corrections: 4, editKeep: 4, latency: 3 });
  });

  it('needs five sessions that actually have a metric before showing it', () => {
    const [group] = leaderboard([
      ...many(4, { model: 'm', corrections: 1 }),
      ...many(2, { model: 'm', corrections: null }),
    ]);
    expect(byModel(group, 'm')?.correctionsPerSession).toBeNull();
    expect(byModel(group, 'm')?.sessions).toBe(6);
  });

  it('ignores sessions without a task type or model and sorts task types alphabetically', () => {
    const groups = leaderboard([
      ...many(5, { taskType: 'docs' }),
      ...many(5, { taskType: 'bugfix' }),
      fact({ taskType: null }),
      fact({ model: null }),
    ]);
    expect(groups.map((entry) => entry.taskType)).toEqual(['bugfix', 'docs']);
  });
});
