import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { projectMonth } from '../budget/projection';
import { localDay } from '../time';
import { getBudget } from './budget';

const AUTO_START = 1790000001000;
const today = localDay(AUTO_START);
const off = { monthlyCreditBudget: 0, workspaceCreditBudgets: {} };

describe('getBudget', () => {
  it('is null when no budget is set', () => {
    expect(getBudget(seededStore().database, today, off)).toBeNull();
  });

  it('reports recorded spend as a lower bound, the exact setting, and an inferred projection', () => {
    const { database } = seededStore();
    const budget = getBudget(database, today, { ...off, monthlyCreditBudget: 2 });
    expect(budget?.monthlyBudget).toEqual({
      value: 2,
      provenance: { kind: 'exact', source: 'your copilotInsights.monthlyCreditBudget setting' },
    });
    expect(budget?.spent.value).toBeCloseTo(1.626141);
    expect(budget?.spent.provenance).toEqual({
      kind: 'derived',
      source:
        'local Copilot credits recorded this month; other machines and clients are not included (lower bound)',
    });
    const expected = projectMonth({ today, spent: 1.626141, budget: 2 });
    expect(budget?.projected.value).toBeCloseTo(expected?.projected ?? -1);
    expect(budget?.projected.provenance).toEqual({
      kind: 'inferred',
      source: 'linear projection of this month’s recorded spend',
    });
    expect(budget?.status.value).toBe(expected?.status);
    expect(budget?.status.provenance.kind).toBe('inferred');
    expect(budget?.daysInMonth).toBe(expected?.daysInMonth);
    expect(budget?.daysElapsed).toBe(expected?.daysElapsed);
  });

  it('says over budget when the spend has already reached it', () => {
    const { database } = seededStore();
    expect(getBudget(database, today, { ...off, monthlyCreditBudget: 1 })?.status.value).toBe('over');
  });

  it('has unavailable spend, projection and status when no Copilot credits were recorded', () => {
    const { database } = seededStore();
    database.db.exec('UPDATE turns SET credits = NULL');
    const budget = getBudget(database, today, { ...off, monthlyCreditBudget: 2 });
    expect(budget?.spent.value).toBeNull();
    expect(budget?.spent.provenance.kind).toBe('unavailable');
    expect(budget?.projected.value).toBeNull();
    expect(budget?.status.value).toBeNull();
    expect(budget?.monthlyBudget.value).toBe(2);
  });

  it('lists only the workspaces that have a budget, with their own spend', () => {
    const { database } = seededStore();
    const budget = getBudget(database, today, {
      monthlyCreditBudget: 0,
      workspaceCreditBudgets: { alpha: 5, unused: 3 },
    });
    expect(budget?.monthlyBudget.value).toBeNull();
    expect(budget?.monthlyBudget.provenance.kind).toBe('unavailable');
    expect(budget?.workspaces.map((row) => row.workspace)).toEqual(['alpha', 'unused']);
    const [alpha, unused] = budget?.workspaces ?? [];
    expect(alpha?.budget.value).toBe(5);
    expect(alpha?.spent.value).toBeCloseTo(1.626141);
    expect(alpha?.status.value).toBe('ok');
    expect(unused?.spent.value).toBeNull();
    expect(unused?.status.value).toBeNull();
  });

  it('marks a workspace over its own budget', () => {
    const { database } = seededStore();
    const budget = getBudget(database, today, {
      monthlyCreditBudget: 0,
      workspaceCreditBudgets: { alpha: 1 },
    });
    expect(budget?.workspaces[0]?.status.value).toBe('over');
  });
});
