import { describe, expect, it } from 'vitest';
import { daysAgo, localDay, retentionCutoff } from './time';

describe('time', () => {
  it('formats the local calendar day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 0, 1).getTime())).toBe('2026-12-31');
  });

  it('moves across month, leap-day and DST boundaries', () => {
    expect(daysAgo('2026-03-01', 1)).toBe('2026-02-28');
    expect(daysAgo('2024-03-01', 1)).toBe('2024-02-29');
    expect(daysAgo('2026-03-09', 1)).toBe('2026-03-08');
    expect(daysAgo('2026-10-26', 1)).toBe('2026-10-25');
    expect(daysAgo('2026-09-30', -1)).toBe('2026-10-01');
  });

  it('rejects malformed days', () => {
    expect(() => daysAgo('2026-9-1', 1)).toThrow(RangeError);
  });

  it('computes the retention cutoff, or null when retention is off', () => {
    expect(retentionCutoff(30, '2026-09-30')).toBe('2026-08-31');
    expect(retentionCutoff(0, '2026-09-30')).toBeNull();
    expect(retentionCutoff(-5, '2026-09-30')).toBeNull();
  });
});
