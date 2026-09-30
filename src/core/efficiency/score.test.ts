import { describe, expect, it } from 'vitest';
import { makeOutcomes, makeTurn } from '../../../test/fixtures/turns';
import type { TurnDetail } from '../../shared/dto';
import { derived, exact } from '../../shared/provenance';
import { efficiencyScore } from './score';

const n = (value: number) => exact(value, 'test');
const steady = (
  count: number,
  overrides: (index: number) => Partial<TurnDetail> = () => ({}),
): TurnDetail[] =>
  Array.from({ length: count }, (_, i) =>
    makeTurn({
      index: i + 1,
      userText: 'Add retry handling in src/upload.ts so that uploads retry',
      inputTokens: n(10_000),
      toolRounds: n(3),
      ...overrides(i + 1),
    }),
  );
const component = (score: ReturnType<typeof efficiencyScore>, id: string) =>
  score?.components.find((entry) => entry.id === id);

describe('efficiencyScore', () => {
  it('builds a fair score from five measured components, each with its evidence', () => {
    const turns = [
      makeTurn({
        index: 1,
        userText: 'Fix X in a.ts',
        inputTokens: n(10_000),
        toolRounds: n(10),
        toolInputRetries: n(1),
      }),
      makeTurn({
        index: 2,
        userText: 'no that is wrong',
        inputTokens: n(14_000),
        toolRounds: n(5),
        toolInputRetries: n(1),
        fileEvents: [
          { path: '/r/a.ts', action: 'edited' },
          { path: '/r/a.ts', action: 'undone' },
        ],
      }),
      makeTurn({ index: 3, userText: 'still failing', inputTokens: n(18_000), toolRounds: n(5) }),
      makeTurn({ index: 4, userText: 'ok', inputTokens: n(24_000) }),
      makeTurn({ index: 5, userText: 'thanks', inputTokens: n(28_000) }),
    ];
    const score = efficiencyScore({
      turns,
      outcomes: makeOutcomes({
        editKeepRate: derived(0.75, 'test'),
        editsKept: n(3),
        editsUndone: n(1),
        editsUserModified: n(0),
        lastTestPassed: derived(true, 'test'),
      }),
    });
    expect(score?.components.map((entry) => entry.id)).toEqual([
      'first-pass',
      'edit-keep',
      'tests',
      'tool-reliability',
      'context-discipline',
    ]);
    expect(component(score, 'first-pass')).toMatchObject({
      value: expect.closeTo(0.4) as number,
      evidence: '2 corrections, 1 edit undone, 0 failed turns over 5 user turns',
    });
    expect(component(score, 'edit-keep')).toMatchObject({
      value: 0.75,
      evidence: '3 kept, 1 undone, 0 modified by you',
    });
    expect(component(score, 'tests')).toMatchObject({ value: 1, evidence: 'the last test run passed' });
    expect(component(score, 'tool-reliability')).toMatchObject({
      value: 0.9,
      evidence: '2 tool-input retries over 20 tool rounds',
    });
    expect(component(score, 'context-discipline')).toMatchObject({
      value: expect.closeTo(0.55) as number,
      evidence: 'context grew 2.8×',
    });
    expect(score?.band).toBe('fair'); // mean 0.72
  });

  it('rates a healthy session good, and shows its components instead of praise', () => {
    const score = efficiencyScore({ turns: steady(3), outcomes: makeOutcomes() });
    expect(score?.band).toBe('good');
    expect(score?.components.map((entry) => entry.value)).toEqual([1, 1, 1]);
    expect(JSON.stringify(score)).not.toMatch(/great|excellent|well done/i);
  });

  it('rates a troubled session as needing work', () => {
    const turns = steady(4, (index) => ({
      state: 'failed',
      userText: index === 1 ? 'Fix it in a.ts' : 'no still wrong',
      toolInputRetries: n(3),
      inputTokens: n(10_000 * index),
    }));
    const score = efficiencyScore({
      turns,
      outcomes: makeOutcomes({ lastTestPassed: derived(false, 'test') }),
    });
    expect(score?.band).toBe('needs-work');
    expect(component(score, 'tests')?.value).toBe(0);
    expect(component(score, 'first-pass')?.value).toBe(0);
  });

  it('needs at least three components with evidence', () => {
    expect(efficiencyScore({ turns: steady(1), outcomes: makeOutcomes() })).toBeNull();
    expect(efficiencyScore({ turns: [], outcomes: makeOutcomes() })).toBeNull();
  });

  it('does not divide by zero when every turn is system-initiated', () => {
    const turns = steady(3, () => ({ systemInitiated: true }));
    const score = efficiencyScore({
      turns,
      outcomes: makeOutcomes({ lastTestPassed: derived(true, 'test') }),
    });
    expect(score === null || score.components.every((entry) => Number.isFinite(entry.value))).toBe(true);
  });

  it('reports a band no stronger than its weakest component', () => {
    const score = efficiencyScore({ turns: steady(3), outcomes: makeOutcomes() });
    expect(score?.provenance).toEqual({
      kind: 'derived',
      source: 'unweighted average of the components shown',
    });
    expect(score?.components.every((entry) => entry.provenance.kind === 'derived')).toBe(true);
  });

  it('omits corrections from the evidence when no prompt text was stored', () => {
    const turns = steady(3, () => ({ userText: null }));
    expect(component(efficiencyScore({ turns, outcomes: makeOutcomes() }), 'first-pass')?.evidence).toBe(
      '0 edits undone, 0 failed turns over 3 user turns (corrections need stored prompt text)',
    );
  });
});
