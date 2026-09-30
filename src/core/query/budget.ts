import type { Budget } from '../../shared/dto';
import { derived, exact, inferred, unavailable, type Measured } from '../../shared/provenance';
import { daysInMonth, projectMonth } from '../budget/projection';
import type { BudgetSettings } from '../budget/settings';
import type { Database } from '../storage/database';
import { breakdown, periodTotals } from './overview';

const SPENT_SOURCE =
  'local Copilot credits recorded this month; other machines and clients are not included (lower bound)';
const PROJECTION_SOURCE = 'linear projection of this month’s recorded spend';
const STATUS_SOURCE = 'budget compared with this month’s recorded credits and their linear projection';

type Status = 'ok' | 'watch' | 'over';

interface Standing {
  spent: Measured<number>;
  projected: Measured<number>;
  status: Measured<Status>;
}

function standing(today: string, spent: number | null, budget: number): Standing {
  if (spent === null) {
    const none = 'no Copilot credits were recorded this month';
    return { spent: unavailable(none), projected: unavailable(none), status: unavailable(none) };
  }
  const projection = projectMonth({ today, spent, budget });
  return {
    spent: derived(spent, SPENT_SOURCE),
    projected:
      projection === null ? unavailable('no budget set') : inferred(projection.projected, PROJECTION_SOURCE),
    status: projection === null ? unavailable('no budget set') : inferred(projection.status, STATUS_SOURCE),
  };
}

/**
 * Month-to-date credit spend against the user's budgets. Spend is what Copilot recorded on this machine (a lower
 * bound); the projection and status are estimates. Null when no budget of any kind is set.
 */
export function getBudget(database: Database, today: string, settings: BudgetSettings): Budget | null {
  const workspaceNames = Object.keys(settings.workspaceCreditBudgets);
  if (settings.monthlyCreditBudget <= 0 && workspaceNames.length === 0) return null;
  const monthStart = `${today.slice(0, 8)}01`;
  const month = periodTotals(database, monthStart, today).credits.value;
  const overall = standing(today, month, settings.monthlyCreditBudget);
  const byWorkspace = new Map(
    breakdown(database, 'workspace', monthStart, today).map((row) => [row.key, row.credits.value]),
  );
  const length = daysInMonth(today);
  return {
    monthlyBudget:
      settings.monthlyCreditBudget > 0
        ? exact(settings.monthlyCreditBudget, 'your copilotInsights.monthlyCreditBudget setting')
        : unavailable('no monthly budget set'),
    ...overall,
    daysElapsed: Math.min(Number(today.slice(8, 10)), length),
    daysInMonth: length,
    workspaces: workspaceNames.map((workspace) => {
      const row = standing(
        today,
        byWorkspace.get(workspace) ?? null,
        settings.workspaceCreditBudgets[workspace] ?? 0,
      );
      return {
        workspace,
        budget: exact(
          settings.workspaceCreditBudgets[workspace] ?? 0,
          'your copilotInsights.workspaceCreditBudgets setting',
        ),
        spent: row.spent,
        status: row.status,
      };
    }),
  };
}
