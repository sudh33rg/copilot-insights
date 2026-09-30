import * as vscode from 'vscode';
import { parseBudgetSettings, type BudgetSettings } from '../core/budget/settings';
import { isCaptureLevel, type CaptureLevel } from '../core/privacy/captureLevel';

export const CONFIG_SECTION = 'copilotInsights';

export interface InsightsConfig {
  captureLevel: CaptureLevel;
  retentionDays: number;
  refreshSeconds: number;
  storageRoots: string[];
  budgets: BudgetSettings;
}

export function readConfig(): InsightsConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const captureLevel = config.get<unknown>('captureLevel');
  const retentionDays = config.get<unknown>('retentionDays');
  const refreshSeconds = config.get<unknown>('nativeRefreshSeconds');
  const storageRoots = config.get<unknown>('nativeStorageRoots');
  return {
    captureLevel: isCaptureLevel(captureLevel) ? captureLevel : 'summaries',
    retentionDays: typeof retentionDays === 'number' && retentionDays >= 0 ? retentionDays : 30,
    refreshSeconds: typeof refreshSeconds === 'number' ? Math.min(600, Math.max(15, refreshSeconds)) : 60,
    storageRoots: Array.isArray(storageRoots)
      ? storageRoots.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      : [],
    budgets: parseBudgetSettings(
      config.get<unknown>('monthlyCreditBudget'),
      config.get<unknown>('workspaceCreditBudgets'),
    ),
  };
}
