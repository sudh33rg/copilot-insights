import { describe, expect, it } from 'vitest';
import { derived, exact, inferred, sumMeasured, unavailable, weakest } from './provenance';

describe('provenance', () => {
  it('builds tagged values', () => {
    expect(exact(5, 'a')).toEqual({ value: 5, provenance: { kind: 'exact', source: 'a' } });
    expect(derived(1, 'rule').provenance.kind).toBe('derived');
    expect(inferred('x', 'rule').provenance.kind).toBe('inferred');
    expect(unavailable('no data')).toEqual({
      value: null,
      provenance: { kind: 'unavailable', source: 'no data' },
    });
  });

  it('weakest picks the least trustworthy kind', () => {
    expect(weakest('exact', 'derived')).toBe('derived');
    expect(weakest('exact', 'inferred', 'derived')).toBe('inferred');
    expect(weakest()).toBe('unavailable');
  });

  it('sums exact values as exact', () => {
    expect(sumMeasured([exact(2, 'a'), exact(3, 'a')], 'total')).toEqual({
      value: 5,
      provenance: { kind: 'exact', source: 'total' },
    });
  });

  it('treats a partial sum as at most derived', () => {
    expect(sumMeasured([exact(2, 'a'), unavailable('missing')], 'total').provenance.kind).toBe('derived');
    expect(sumMeasured([inferred(2, 'a'), unavailable('missing')], 'total').provenance.kind).toBe('inferred');
  });

  it('reports a sum without known values as unavailable', () => {
    expect(sumMeasured([unavailable('x')], 'total')).toEqual({
      value: null,
      provenance: { kind: 'unavailable', source: 'total' },
    });
  });
});
