import { useQuery } from '@tanstack/react-query';
import type { BudgetSummary } from '../../shared/dto';
import { useRpc } from '../rpcContext';
import { formatCredits } from '../ui/format';
import { Measure } from '../ui/Measure';

const credits = (value: number | string) => formatCredits(Number(value));
const STATUS_TEXT = {
  ok: 'On track',
  watch: 'Projected to exceed the budget',
  over: 'Over budget',
} as const;

/** Month-to-date credits against the user's budgets. Shown only when a budget is set. */
export function BudgetCard() {
  const rpc = useRpc();
  const query = useQuery({ queryKey: ['budget'], queryFn: () => rpc.call('getBudget', {}) });
  if (query.isError) return <p role="alert">Could not load the budget: {query.error.message}</p>;
  if (query.data === undefined || query.data === null) return null;
  return <Budget budget={query.data} />;
}

function StatusText({ status }: { status: BudgetSummary['status'] }) {
  return status.value === null ? null : <span>{STATUS_TEXT[status.value]}</span>;
}

function Budget({ budget }: { budget: BudgetSummary }) {
  const limit = budget.monthlyBudget.value;
  const spent = budget.spent.value;
  return (
    <section className="card" aria-label="Budget">
      <h3>Budget</h3>
      {limit !== null && (
        <>
          <p>
            <meter
              aria-label="Credits recorded this month against the budget"
              min={0}
              max={limit}
              value={Math.min(spent ?? 0, limit)}
            />
          </p>
          <p>
            Spent <Measure measure={budget.spent} format={credits} /> of{' '}
            <Measure measure={budget.monthlyBudget} format={credits} /> credits · Day {budget.daysElapsed} of{' '}
            {budget.daysInMonth}
          </p>
          <p>
            Projected for the month: <Measure measure={budget.projected} format={credits} />
          </p>
          <p>
            <StatusText status={budget.status} />
          </p>
        </>
      )}
      {budget.workspaces.length > 0 && (
        <ul className="findings" aria-label="Workspace budgets">
          {budget.workspaces.map((row) => (
            <li key={row.workspace}>
              <strong>{row.workspace}</strong>: <Measure measure={row.spent} format={credits} /> of{' '}
              <Measure measure={row.budget} format={credits} /> credits <StatusText status={row.status} />
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Based on credits recorded on this machine; usage elsewhere is not included.</p>
    </section>
  );
}
