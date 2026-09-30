import { describe, expect, it } from 'vitest';
import { MIN_SAMPLE, isOutlier, mad, median, notEnough, quartiles } from './stats';

describe('stats', () => {
  it('computes the median of odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('computes the median absolute deviation', () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(mad([5, 5, 5])).toBe(0);
    expect(mad([])).toBeNull();
  });

  it('computes quartiles as the medians of the lower and upper halves', () => {
    expect(quartiles([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({ q1: 2.5, q3: 6.5 });
    expect(quartiles([1, 2, 3, 4, 5])).toEqual({ q1: 1.5, q3: 4.5 });
    expect(quartiles([7])).toBeNull();
  });

  it('needs five sessions before calling anything an outlier', () => {
    expect(MIN_SAMPLE).toBe(5);
    expect(isOutlier(1000, [10, 11, 12, 10])).toBeNull();
  });

  it('flags values far from the median by both the spread and the ratio rule', () => {
    const group = [10, 11, 12, 10, 11];
    expect(isOutlier(100, group)).toBe('high');
    expect(isOutlier(11, group)).toBeNull();
    expect(isOutlier(1, group)).toBe('low');
  });

  it('does not flag small differences in a tight group (the ratio rule still has to hold)', () => {
    expect(isOutlier(12.5, [10, 10, 10, 10.1, 10.1])).toBeNull();
  });

  it('uses only the ratio rule when every value is identical, and never divides by zero', () => {
    const same = [10, 10, 10, 10, 10];
    expect(isOutlier(16, same)).toBe('high');
    expect(isOutlier(11, same)).toBeNull();
    expect(isOutlier(5, same)).toBe('low');
  });

  it('ignores groups whose median is zero', () => {
    expect(isOutlier(5, [0, 0, 0, 0, 0])).toBeNull();
  });

  it('words the missing-data source with the count', () => {
    expect(notEnough(3)).toBe('not enough data: 3 of 5 sessions');
  });
});
