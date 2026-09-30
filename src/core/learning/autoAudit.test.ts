import { describe, expect, it } from 'vitest';
import { fact, many } from '../../../test/fixtures/facts';
import { autoAudit } from './autoAudit';

describe('autoAudit', () => {
  it('compares Auto and manual sessions of the same task type side by side', () => {
    const rows = autoAudit([
      ...many(6, { selection: 'auto', credits: 2, failedTurns: 1, userTurns: 4, editKeepRate: 0.5 }),
      ...many(6, { selection: 'manual', credits: 1, failedTurns: 0, userTurns: 4, editKeepRate: 0.9 }),
    ]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.taskType).toBe('bugfix');
    expect(row?.auto).toEqual({
      sessions: 6,
      creditsPerSession: 2,
      failureRate: 6 / 24,
      editKeepRate: 0.5,
      creditSamples: 6,
      keepSamples: 6,
    });
    expect(row?.manual).toEqual({
      sessions: 6,
      creditsPerSession: 1,
      failureRate: 0,
      editKeepRate: 0.9,
      creditSamples: 6,
      keepSamples: 6,
    });
  });

  it('gives no metric for a side with fewer than five sessions, but still lists the task type', () => {
    const [row] = autoAudit([...many(6, { selection: 'auto' }), ...many(4, { selection: 'manual' })]);
    expect(row?.manual).toMatchObject({
      sessions: 4,
      creditsPerSession: null,
      failureRate: null,
      editKeepRate: null,
    });
    expect(row?.auto.creditsPerSession).toBe(1);
  });

  it('omits a task type that has only one side, or no side with five sessions', () => {
    expect(autoAudit(many(8, { selection: 'auto' }))).toEqual([]);
    expect(autoAudit([...many(4, { selection: 'auto' }), ...many(4, { selection: 'manual' })])).toEqual([]);
  });

  it('leaves mixed and unknown selections out of both sides', () => {
    const [row] = autoAudit([
      ...many(5, { selection: 'auto' }),
      ...many(5, { selection: 'manual' }),
      ...many(3, { selection: 'mixed' }),
      ...many(2, { selection: 'unknown' }),
    ]);
    expect(row?.auto.sessions).toBe(5);
    expect(row?.manual.sessions).toBe(5);
  });

  it('skips BYOK sessions for credits and sessions without a task type', () => {
    const [row] = autoAudit([
      ...many(5, { selection: 'auto', host: 'byok', credits: null }),
      ...many(5, { selection: 'manual' }),
      fact({ selection: 'auto', taskType: null }),
    ]);
    expect(row?.auto).toMatchObject({ sessions: 5, creditsPerSession: null, creditSamples: 0 });
    expect(row?.manual.creditsPerSession).toBe(1);
  });

  it('sorts task types alphabetically', () => {
    const rows = autoAudit([
      ...many(5, { taskType: 'docs', selection: 'auto' }),
      ...many(5, { taskType: 'docs', selection: 'manual' }),
      ...many(5, { taskType: 'bugfix', selection: 'auto' }),
      ...many(5, { taskType: 'bugfix', selection: 'manual' }),
    ]);
    expect(rows.map((row) => row.taskType)).toEqual(['bugfix', 'docs']);
  });
});
