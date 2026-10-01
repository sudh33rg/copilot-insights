import * as vscode from 'vscode';
import { parseBudgetSettings, type BudgetSettings } from '../core/budget/settings';

export const CONFIG_SECTION = 'copilotInsights';

export interface InsightsConfig {
  retentionDays: number;
  refreshSeconds: number;
  storageRoots: string[];
  budgets: BudgetSettings;
  /** Opt-in status bar item for the active session. */
  liveNudge: boolean;
}

export function readConfig(): InsightsConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const retentionDays = config.get<unknown>('retentionDays');
  const refreshSeconds = config.get<unknown>('nativeRefreshSeconds');
  const storageRoots = config.get<unknown>('nativeStorageRoots');
  return {
    retentionDays: typeof retentionDays === 'number' && retentionDays >= 0 ? retentionDays : 30,
    refreshSeconds: typeof refreshSeconds === 'number' ? Math.min(600, Math.max(15, refreshSeconds)) : 60,
    storageRoots: Array.isArray(storageRoots)
      ? storageRoots.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : [],
    liveNudge: config.get<unknown>('liveNudge') === true,
    budgets: parseBudgetSettings(
      config.get<unknown>('monthlyCreditBudget'),
      config.get<unknown>('workspaceCreditBudgets'),
    ),
  };
}
