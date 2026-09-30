import { describe, expect, it } from 'vitest';
import type { BudgetSummary } from '../shared/dto';
import { derived, exact, inferred, unavailable } from '../shared/provenance';
import { BudgetAlerts } from './budgetAlerts';

const budget = (
  spent: number | null,
  monthly = 50,
  workspaces: { workspace: string; budget: number; spent: number | null }[] = [],
): BudgetSummary => ({
  monthlyBudget: monthly > 0 ? exact(monthly, 'setting') : unavailable('no monthly budget set'),
  spent: spent === null ? unavailable('none') : derived(spent, 'recorded'),
  projected: unavailable('n/a'),
  status: inferred('ok' as const, 'rule'),
  daysElapsed: 10,
  daysInMonth: 30,
  workspaces: workspaces.map((row) => ({
    workspace: row.workspace,
    budget: exact(row.budget, 'setting'),
    spent: row.spent === null ? unavailable('none') : derived(row.spent, 'recorded'),
    status: inferred('ok' as const, 'rule'),
  })),
});

function setup(initial: BudgetSummary | null, month = '2026-09') {
  const store = new Map<string, unknown>();
  const messages: string[] = [];
  const state = {
    current: initial,
    month,
    failWrites: false,
  };
  const alerts = new BudgetAlerts({
    budget: () => state.current,
    state: {
      get: (key) => store.get(key),
      update: (key, value) => {
        if (state.failWrites) return Promise.reject(new Error('disk full'));
        store.set(key, value);
        return Promise.resolve();
      },
    },
    notify: (message) => messages.push(message),
    month: () => state.month,
  });
  return { alerts, messages, state, store };
}

describe('BudgetAlerts', () => {
  it('warns once at 80 percent, in words that say where the number comes from', async () => {
    const { alerts, messages } = setup(budget(41));
    await alerts.check();
    await alerts.check();
    expect(messages).toEqual([
      'Copilot Insights: you have used 82% of your monthly credit budget (41 of 50 recorded on this machine).',
    ]);
  });

  it('warns again at 100 percent, and never twice for the same threshold', async () => {
    const { alerts, messages, state } = setup(budget(41));
    await alerts.check();
    state.current = budget(50.5);
    await alerts.check();
    await alerts.check();
    expect(messages).toHaveLength(2);
    expect(messages[1]).toBe(
      'Copilot Insights: you have reached your monthly credit budget (50.5 of 50 recorded on this machine).',
    );
  });

  it('sends a single alert, for the highest threshold, when spend is already past the budget', async () => {
    const { alerts, messages } = setup(budget(60));
    await alerts.check();
    await alerts.check();
    expect(messages).toEqual([
      'Copilot Insights: you have reached your monthly credit budget (60 of 50 recorded on this machine).',
    ]);
  });

  it('starts over in a new month', async () => {
    const { alerts, messages, state } = setup(budget(45));
    await alerts.check();
    state.month = '2026-10';
    await alerts.check();
    expect(messages).toHaveLength(2);
  });

  it('tracks each workspace budget on its own', async () => {
    const { alerts, messages } = setup(
      budget(1, 0, [
        { workspace: 'alpha', budget: 10, spent: 9 },
        { workspace: 'beta', budget: 10, spent: 2 },
      ]),
    );
    await alerts.check();
    expect(messages).toEqual([
      'Copilot Insights: you have used 90% of your monthly credit budget for alpha (9 of 10 recorded on this machine).',
    ]);
  });

  it('says nothing without budgets or without recorded spend', async () => {
    expect((await check(null)).length).toBe(0);
    expect((await check(budget(null))).length).toBe(0);
    expect((await check(budget(0))).length).toBe(0);
    async function check(value: BudgetSummary | null) {
      const { alerts, messages } = setup(value);
      await alerts.check();
      return messages;
    }
  });

  it('does not throw or repeat itself when the alert state cannot be saved', async () => {
    const { alerts, messages, state } = setup(budget(45));
    state.failWrites = true;
    await expect(alerts.check()).resolves.toBeUndefined();
    await alerts.check();
    expect(messages).toHaveLength(1);
  });
});
