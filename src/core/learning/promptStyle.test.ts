import { describe, expect, it } from 'vitest';
import { fact } from '../../../test/fixtures/facts';
import type { SessionFacts } from './sessionFacts';
import { promptStyle } from './promptStyle';

const opening = (namesFile: boolean, statesSuccess = false, statesConstraints = false) => ({
  namesFile,
  statesSuccess,
  statesConstraints,
});
const session = (corrections: number, namesFile: boolean, overrides: Partial<SessionFacts> = {}) =>
  fact({ corrections, opening: opening(namesFile), userTurns: 4, ...overrides });

describe('promptStyle', () => {
  it('compares corrections per session with and without each opening-prompt habit', () => {
    const facts = [
      ...[0, 0, 1, 0, 1, 0].map((c) => session(c, true)),
      ...[2, 3, 1, 2, 2, 3].map((c) => session(c, false)),
    ];
    const [row] = promptStyle(facts);
    expect(row?.feature).toBe('namesFile');
    expect(row?.withFeature).toEqual({ sessions: 6, correctionsPerSession: 2 / 6 });
    expect(row?.without).toEqual({ sessions: 6, correctionsPerSession: 13 / 6 });
  });

  it('always returns the three features, in a fixed order', () => {
    expect(promptStyle([]).map((row) => row.feature)).toEqual([
      'namesFile',
      'statesSuccess',
      'statesConstraints',
    ]);
    expect(promptStyle([])[0]).toEqual({
      feature: 'namesFile',
      withFeature: { sessions: 0, correctionsPerSession: null },
      without: { sessions: 0, correctionsPerSession: null },
    });
  });

  it('gives no mean for a side with fewer than five sessions', () => {
    const facts = [
      ...[0, 1, 0, 1].map((c) => session(c, true)),
      ...[2, 2, 2, 2, 2].map((c) => session(c, false)),
    ];
    const [row] = promptStyle(facts);
    expect(row?.withFeature).toEqual({ sessions: 4, correctionsPerSession: null });
    expect(row?.without.correctionsPerSession).toBe(2);
  });

  it('leaves out sessions without prompt text, without corrections data, or with a single user turn', () => {
    const facts = [
      ...Array.from({ length: 5 }, () => session(0, true)),
      fact({ corrections: null, opening: opening(true), userTurns: 4 }),
      fact({ corrections: 0, opening: null, userTurns: 4 }),
      fact({ corrections: 0, opening: opening(true), userTurns: 1 }),
    ];
    expect(promptStyle(facts)[0]?.withFeature.sessions).toBe(5);
  });

  it('evaluates each feature independently', () => {
    const facts = [
      ...Array.from({ length: 5 }, () =>
        fact({ corrections: 0, userTurns: 3, opening: opening(false, true, false) }),
      ),
      ...Array.from({ length: 5 }, () =>
        fact({ corrections: 4, userTurns: 3, opening: opening(false, false, true) }),
      ),
    ];
    const rows = promptStyle(facts);
    const success = rows.find((row) => row.feature === 'statesSuccess');
    const constraints = rows.find((row) => row.feature === 'statesConstraints');
    expect(success?.withFeature.correctionsPerSession).toBe(0);
    expect(success?.without.correctionsPerSession).toBe(4);
    expect(constraints?.withFeature.correctionsPerSession).toBe(4);
    expect(constraints?.without.correctionsPerSession).toBe(0);
  });
});
