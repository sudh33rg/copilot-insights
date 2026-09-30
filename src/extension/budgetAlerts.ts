import { thresholdsToAlert, type AlertThreshold } from '../core/budget/alerts';
import type { BudgetSummary } from '../shared/dto';

export interface BudgetAlertsDeps {
  budget(): BudgetSummary | null;
  state: { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> };
  /** Non-modal notification (a warning toast). */
  notify(message: string): void;
  /** The current month, e.g. `2026-09`. */
  month(): string;
}

const number = (value: number): string => String(Number(value.toFixed(2)));

function savedThresholds(value: unknown): AlertThreshold[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is AlertThreshold => entry === 80 || entry === 100)
    : [];
}

/**
 * Warns once per month at 80 % and at 100 % of each budget, based on credits recorded on this machine. Never modal,
 * never repeated, and silent when no budget is set or nothing has been spent.
 */
export class BudgetAlerts {
  /** Remembered in memory too, so a failing state write cannot cause the same alert every minute. */
  private readonly notified = new Set<string>();

  constructor(private readonly deps: BudgetAlertsDeps) {}

  async check(): Promise<void> {
    const budget = this.deps.budget();
    if (budget === null) return;
    const scopes: { scope: string; label: string; spent: number | null; limit: number | null }[] = [
      {
        scope: 'overall',
        label: 'your monthly credit budget',
        spent: budget.spent.value,
        limit: budget.monthlyBudget.value,
      },
      ...budget.workspaces.map((row) => ({
        scope: `workspace:${row.workspace}`,
        label: `your monthly credit budget for ${row.workspace}`,
        spent: row.spent.value,
        limit: row.budget.value,
      })),
    ];
    for (const { scope, label, spent, limit } of scopes) {
      if (spent === null || limit === null) continue;
      await this.alert(scope, label, spent, limit);
    }
  }

  private async alert(scope: string, label: string, spent: number, limit: number): Promise<void> {
    const key = `budget.alerted.${this.deps.month()}.${scope}`;
    const alerted = [...new Set([...savedThresholds(this.deps.state.get(key)), ...this.memory(key)])];
    const due = thresholdsToAlert({ spent, budget: limit, alerted });
    const highest = due[due.length - 1];
    if (highest === undefined) return;
    for (const threshold of due) this.notified.add(`${key}:${String(threshold)}`);
    const amounts = `${number(spent)} of ${number(limit)} recorded on this machine`;
    this.deps.notify(
      highest === 100
        ? `Copilot Insights: you have reached ${label} (${amounts}).`
        : `Copilot Insights: you have used ${String(Math.round((spent / limit) * 100))}% of ${label} (${amounts}).`,
    );
    try {
      await this.deps.state.update(key, [...new Set([...alerted, ...due])]);
    } catch {
      // The in-memory record above still prevents a repeat until the extension restarts.
    }
  }

  private memory(key: string): AlertThreshold[] {
    return ([80, 100] as const).filter((threshold) => this.notified.has(`${key}:${String(threshold)}`));
  }
}
