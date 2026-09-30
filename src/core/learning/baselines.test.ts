import { describe, expect, it } from 'vitest';
import { fact, many } from '../../../test/fixtures/facts';
import { baselineMessage, baselineRows, compareToBaseline, outliers } from './baselines';

const typical = [
  40_000, 45_000, 48_000, 50_000, 52_000, 55_000, 60_000, 47_000, 49_000, 51_000, 46_000, 53_000,
];

describe('baselineRows', () => {
  it('summarises each task type and model with median and spread', () => {
    const rows = baselineRows([...many(12, {}, typical), fact({ inputTokens: 210_000 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskType: 'bugfix', model: 'model-a', n: 13, creditSessions: 13 });
    expect(rows[0]?.inputMedian).toBe(50_000);
    expect(rows[0]?.inputMad).toBeGreaterThan(0);
    expect(rows[0]?.creditsMedian).toBe(1);
  });

  it('gives no median for a group under five sessions', () => {
    const [row] = baselineRows(many(4));
    expect(row).toMatchObject({ n: 4, inputMedian: null, inputMad: null, creditsMedian: null });
  });

  it('leaves sessions without a task type, model or input tokens out', () => {
    const rows = baselineRows([
      ...many(5),
      fact({ taskType: null }),
      fact({ model: null }),
      fact({ inputTokens: null }),
    ]);
    expect(rows.map((row) => row.n)).toEqual([5]);
  });

  it('counts BYOK sessions for tokens but not for credits', () => {
    const rows = baselineRows([...many(5), ...many(5, { host: 'byok', credits: null })]);
    expect(rows[0]).toMatchObject({ n: 10, creditSessions: 5, creditsMedian: 1 });
  });

  it('orders groups by size', () => {
    const rows = baselineRows([...many(5, { taskType: 'docs' }), ...many(7, { taskType: 'bugfix' })]);
    expect(rows.map((row) => row.taskType)).toEqual(['bugfix', 'docs']);
  });
});

describe('compareToBaseline', () => {
  const history = many(12, {}, typical);

  it('flags a session far above the typical range, comparing with the other sessions only', () => {
    const big = fact({ inputTokens: 210_000 });
    const comparison = compareToBaseline([...history, big], big);
    expect(comparison).toMatchObject({
      taskType: 'bugfix',
      model: 'model-a',
      n: 12,
      verdict: 'high',
      median: 49_500,
      thisSession: 210_000,
    });
    expect(comparison?.typicalLow).toBeLessThan(49_500);
    expect(comparison?.typicalHigh).toBeGreaterThan(49_500);
  });

  it('calls a session inside the range typical and one far below it low', () => {
    const inside = fact({ inputTokens: 51_000 });
    const tiny = fact({ inputTokens: 5_000 });
    expect(compareToBaseline([...history, inside], inside)?.verdict).toBe('typical');
    expect(compareToBaseline([...history, tiny], tiny)?.verdict).toBe('low');
  });

  it('is null with fewer than five other sessions, or without the needed facts', () => {
    const lone = fact();
    expect(compareToBaseline([...many(4), lone], lone)).toBeNull();
    const noType = fact({ taskType: null });
    expect(compareToBaseline([...history, noType], noType)).toBeNull();
    const noInput = fact({ inputTokens: null });
    expect(compareToBaseline([...history, noInput], noInput)).toBeNull();
  });

  it('flags nothing when every other session is identical except by the ratio rule', () => {
    const same = many(6, {}, [10_000]);
    const close = fact({ inputTokens: 11_000 });
    const far = fact({ inputTokens: 16_000 });
    expect(compareToBaseline([...same, close], close)?.verdict).toBe('typical');
    expect(compareToBaseline([...same, far], far)?.verdict).toBe('high');
  });

  it('only compares with the same task type and model', () => {
    const big = fact({ inputTokens: 210_000, model: 'model-b' });
    expect(compareToBaseline([...history, big], big)).toBeNull();
  });
});

describe('outliers', () => {
  it('lists each unusual session once, the most extreme (by ratio to the median) first', () => {
    const big = fact({ inputTokens: 210_000 });
    const huge = fact({ inputTokens: 400_000 });
    const tiny = fact({ inputTokens: 3_000 });
    const list = outliers([...many(12, {}, typical), big, huge, tiny]);
    expect(list.map((entry) => entry.session.id)).toEqual([tiny.id, huge.id, big.id]);
    expect(list.map((entry) => entry.comparison.verdict)).toEqual(['low', 'high', 'high']);
  });

  it('is empty for a steady history', () => {
    expect(outliers(many(12, {}, typical))).toEqual([]);
  });
});

describe('baselineMessage', () => {
  const comparison = {
    taskType: 'bugfix',
    model: 'gpt-5.6-luna',
    n: 12,
    median: 48_000,
    typicalLow: 40_000,
    typicalHigh: 60_000,
    thisSession: 210_000,
  };

  it('states the typical range, the median, how many sessions it rests on and what this one used', () => {
    expect(baselineMessage({ ...comparison, verdict: 'high' })).toBe(
      'Your bugfix sessions on gpt-5.6-luna normally use 40,000–60,000 input tokens (median 48,000, 12 other sessions). This one used 210,000. That is unusually high.',
    );
  });

  it('says "about" when the sessions barely vary', () => {
    expect(
      baselineMessage({
        ...comparison,
        typicalLow: 48_000,
        typicalHigh: 48_000,
        verdict: 'typical',
        thisSession: 48_500,
      }),
    ).toBe(
      'Your bugfix sessions on gpt-5.6-luna normally use about 48,000 input tokens (12 other sessions). This one used 48,500.',
    );
  });

  it('words a low session', () => {
    expect(baselineMessage({ ...comparison, verdict: 'low', thisSession: 5_000 })).toMatch(
      /That is unusually low\.$/,
    );
  });
});
