export interface BudgetSettings {
  /** Monthly Copilot credit budget; 0 means off. */
  monthlyCreditBudget: number;
  /** Per-workspace monthly budgets keyed by workspace name; entries without a positive number are dropped. */
  workspaceCreditBudgets: Record<string, number>;
}

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Validates the raw VS Code settings; anything that is not a positive number means "no budget". */
export function parseBudgetSettings(monthly: unknown, perWorkspace: unknown): BudgetSettings {
  const workspaceCreditBudgets: Record<string, number> = {};
  if (typeof perWorkspace === 'object' && perWorkspace !== null && !Array.isArray(perWorkspace)) {
    for (const [workspace, value] of Object.entries(perWorkspace)) {
      if (positive(value)) workspaceCreditBudgets[workspace] = value;
    }
  }
  return { monthlyCreditBudget: positive(monthly) ? monthly : 0, workspaceCreditBudgets };
}
