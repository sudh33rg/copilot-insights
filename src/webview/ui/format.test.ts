import { describe, expect, it } from 'vitest';
import { formatCredits, formatDuration, formatInt, formatPercent } from './format';

describe('format', () => {
  it('groups integers', () => {
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(0)).toBe('0');
  });

  it('shows credits with up to 3 decimals and no trailing zeros', () => {
    expect(formatCredits(1.626141)).toBe('1.626');
    expect(formatCredits(0.5)).toBe('0.5');
    expect(formatCredits(12)).toBe('12');
  });

  it('formats ratios as whole percentages', () => {
    expect(formatPercent(0.2246)).toBe('22%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(12_300)).toBe('12.3 s');
    expect(formatDuration(185_000)).toBe('3m 5s');
    expect(formatDuration(3_723_000)).toBe('1h 2m');
  });
});
