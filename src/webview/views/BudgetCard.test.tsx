import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BudgetSummary } from '../../shared/dto';
import { renderWithHost } from '../test/fakeHost';
import { BudgetCard } from './BudgetCard';

const derived = (value: number) => ({
  value,
  provenance: { kind: 'derived' as const, source: 'recorded credits' },
});
const setting = (value: number) => ({
  value,
  provenance: { kind: 'exact' as const, source: 'your setting' },
});
const status = (value: 'ok' | 'watch' | 'over') => ({
  value,
  provenance: { kind: 'inferred' as const, source: 'rule' },
});
const none = { value: null, provenance: { kind: 'unavailable' as const, source: 'no monthly budget set' } };

const budget = (overrides: Partial<BudgetSummary> = {}): BudgetSummary => ({
  monthlyBudget: setting(50),
  spent: derived(20),
  projected: { value: 40, provenance: { kind: 'inferred', source: 'linear projection' } },
  status: status('ok'),
  daysElapsed: 15,
  daysInMonth: 30,
  workspaces: [],
  ...overrides,
});

const view = (value: BudgetSummary | null) => renderWithHost(<BudgetCard />, { getBudget: value });

describe('BudgetCard', () => {
  it('shows spend against the budget as a meter, with the projection marked as an estimate', async () => {
    view(budget());
    const card = await screen.findByRole('region', { name: 'Budget' });
    const meter = within(card).getByRole('meter', { name: 'Credits recorded this month against the budget' });
    expect(meter).toHaveAttribute('value', '20');
    expect(meter).toHaveAttribute('max', '50');
    expect(within(card).getByText('20')).toBeInTheDocument();
    expect(within(card).getByText('50')).toBeInTheDocument();
    expect(within(card).getByText('40')).toBeInTheDocument();
    expect(within(card).getByText('Inferred')).toBeInTheDocument();
    expect(within(card).getByText('On track')).toBeInTheDocument();
    expect(within(card).getByText(/Day 15 of 30/)).toBeInTheDocument();
  });

  it('says plainly when the projection passes the budget or the budget is already used up', async () => {
    const { unmount } = view(
      budget({
        status: status('watch'),
        projected: { value: 60, provenance: { kind: 'inferred', source: 'p' } },
      }),
    );
    expect(await screen.findByText('Projected to exceed the budget')).toBeInTheDocument();
    unmount();
    view(budget({ status: status('over'), spent: derived(55) }));
    expect(await screen.findByText('Over budget')).toBeInTheDocument();
  });

  it('lists workspace budgets with their own status', async () => {
    view(
      budget({
        workspaces: [
          { workspace: 'alpha', budget: setting(10), spent: derived(9), status: status('watch') },
          {
            workspace: 'beta',
            budget: setting(5),
            spent: { value: null, provenance: { kind: 'unavailable', source: 'none' } },
            status: { value: null, provenance: { kind: 'unavailable', source: 'none' } },
          },
        ],
      }),
    );
    const list = await screen.findByRole('list', { name: 'Workspace budgets' });
    const alpha = within(list).getByText('alpha').closest('li') as HTMLElement;
    expect(within(alpha).getByText('9')).toBeInTheDocument();
    expect(within(alpha).getByText(/Projected to exceed the budget/)).toBeInTheDocument();
    expect(alpha.textContent).toContain('credits — Projected to exceed the budget');
    const beta = within(list).getByText('beta').closest('li') as HTMLElement;
    expect(within(beta).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('works with only workspace budgets', async () => {
    view(
      budget({
        monthlyBudget: none,
        spent: none,
        projected: none,
        status: { value: null, provenance: { kind: 'unavailable', source: 'none' } },
        workspaces: [{ workspace: 'alpha', budget: setting(10), spent: derived(1), status: status('ok') }],
      }),
    );
    const card = await screen.findByRole('region', { name: 'Budget' });
    expect(within(card).queryByRole('meter')).toBeNull();
    expect(within(card).getByRole('list', { name: 'Workspace budgets' })).toBeInTheDocument();
  });

  it('states that only credits recorded on this machine count', async () => {
    view(budget());
    expect(
      await screen.findByText('Based on credits recorded on this machine; usage elsewhere is not included.'),
    ).toBeInTheDocument();
  });

  it('is not shown when no budget is set', async () => {
    const { calls } = view(null);
    await waitFor(() => {
      expect(calls.map((call) => call.method)).toContain('getBudget');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('region', { name: 'Budget' })).toBeNull();
  });
});
