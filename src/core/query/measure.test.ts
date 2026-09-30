import { describe, expect, it } from 'vitest';
import { known, summed, toTurnState } from './measure';

describe('measure', () => {
  it('is exact only when every expected row reported a value', () => {
    expect(summed(10, 3, 3, 'src')).toEqual({ value: 10, provenance: { kind: 'exact', source: 'src' } });
  });

  it('is a derived lower bound when some rows are missing', () => {
    const result = summed(10, 1, 3, 'src');
    expect(result.value).toBe(10);
    expect(result.provenance.kind).toBe('derived');
    expect(result.provenance.source).toContain('1 of 3');
  });

  it('is unavailable (not zero) when no row reported a value', () => {
    expect(summed(null, 0, 3, 'src').value).toBeNull();
    expect(summed(null, 0, 3, 'src').provenance.kind).toBe('unavailable');
    expect(summed(0, 0, 0, 'src').provenance.kind).toBe('unavailable');
  });

  it('wraps a single nullable value', () => {
    expect(known(5, 's').provenance.kind).toBe('exact');
    expect(known(null, 's').provenance.kind).toBe('unavailable');
  });

  it('narrows unknown state strings', () => {
    expect(toTurnState('failed')).toBe('failed');
    expect(toTurnState('weird')).toBe('unknown');
    expect(toTurnState(null)).toBe('unknown');
  });
});
