import { describe, expect, it } from 'vitest';
import { parseBudgetSettings } from './settings';

describe('parseBudgetSettings', () => {
  it('defaults to no budgets', () => {
    expect(parseBudgetSettings(undefined, undefined)).toEqual({
      monthlyCreditBudget: 0,
      workspaceCreditBudgets: {},
    });
  });

  it('reads a monthly budget and per-workspace budgets', () => {
    expect(parseBudgetSettings(50, { alpha: 20, beta: 5.5 })).toEqual({
      monthlyCreditBudget: 50,
      workspaceCreditBudgets: { alpha: 20, beta: 5.5 },
    });
  });

  it('ignores negative, non-finite and non-numeric values', () => {
    expect(parseBudgetSettings(-1, null).monthlyCreditBudget).toBe(0);
    expect(parseBudgetSettings(Number.POSITIVE_INFINITY, null).monthlyCreditBudget).toBe(0);
    expect(parseBudgetSettings('50', null).monthlyCreditBudget).toBe(0);
    expect(
      parseBudgetSettings(0, { alpha: -2, beta: 'x', gamma: 4, delta: 0 }).workspaceCreditBudgets,
    ).toEqual({
      gamma: 4,
    });
  });

  it('ignores a workspace setting that is not an object', () => {
    expect(parseBudgetSettings(10, [1, 2]).workspaceCreditBudgets).toEqual({});
    expect(parseBudgetSettings(10, 'nope').workspaceCreditBudgets).toEqual({});
  });
});
