import { describe, expect, it } from 'vitest';
import { thresholdsToAlert } from './alerts';

describe('thresholdsToAlert', () => {
  it('alerts at 80 percent, and at 100 percent when both are reached', () => {
    expect(thresholdsToAlert({ spent: 41, budget: 50, alerted: [] })).toEqual([80]);
    expect(thresholdsToAlert({ spent: 50, budget: 50, alerted: [] })).toEqual([80, 100]);
    expect(thresholdsToAlert({ spent: 70, budget: 50, alerted: [] })).toEqual([80, 100]);
  });

  it('does not repeat a threshold that was already alerted', () => {
    expect(thresholdsToAlert({ spent: 45, budget: 50, alerted: [80] })).toEqual([]);
    expect(thresholdsToAlert({ spent: 50, budget: 50, alerted: [80] })).toEqual([100]);
    expect(thresholdsToAlert({ spent: 50, budget: 50, alerted: [80, 100] })).toEqual([]);
  });

  it('waits until a threshold is actually reached', () => {
    expect(thresholdsToAlert({ spent: 39.9, budget: 50, alerted: [] })).toEqual([]);
    expect(thresholdsToAlert({ spent: 40, budget: 50, alerted: [] })).toEqual([80]);
  });

  it('says nothing without a budget or without spend', () => {
    expect(thresholdsToAlert({ spent: 10, budget: 0, alerted: [] })).toEqual([]);
    expect(thresholdsToAlert({ spent: 10, budget: Number.NaN, alerted: [] })).toEqual([]);
    expect(thresholdsToAlert({ spent: 0, budget: 50, alerted: [] })).toEqual([]);
  });
});
