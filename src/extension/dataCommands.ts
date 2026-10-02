import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ClearScope } from '../shared/dto';
import { ClearService } from '../core/clear/clearService';
import { describeScope } from '../core/clear/describeScope';
import { exportIndex } from '../core/export/exportJson';
import { deleteLegacyFiles, findLegacyFiles } from '../core/legacy/legacyFiles';
import type { Database } from '../core/storage/database';

export interface DataCommandDeps {
  database: Database;
  clear: ClearService;
  storageDir: string;
  globalState: vscode.Memento;
  notifyChanged(): void;
}

const LEGACY_PROMPTED = 'legacyDataPrompted';

/** Confirms with a modal, then clears. Used by the webview RPC and the command palette alike. */
export async function confirmAndClear(
  deps: DataCommandDeps,
  scope: ClearScope,
): Promise<{ confirmed: boolean; sessions: number }> {
  const count = deps.clear.count(scope);
  if (count === 0) {
    void vscode.window.showInformationMessage('Nothing to clear.');
    return { confirmed: false, sessions: 0 };
  }
  const text = describeScope(scope, count);
  const choice = await vscode.window.showWarningMessage(
    text.title,
    { modal: true, detail: text.detail },
    text.confirmLabel,
  );
  if (choice !== text.confirmLabel) return { confirmed: false, sessions: 0 };
  const result = deps.clear.clear(scope);
  deps.notifyChanged();
  return { confirmed: true, sessions: result.sessions };
}

export async function exportToFile(deps: DataCommandDeps): Promise<{ saved: boolean }> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(join(deps.storageDir, 'traceon-export.json')),
    filters: { JSON: ['json'] },
    title: 'Export the TraceOn index',
  });
  if (target === undefined) return { saved: false };
  const document = exportIndex(deps.database, Date.now());
  await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(document, null, 2), 'utf8'));
  void vscode.window.showInformationMessage(`Exported ${String(document.sessions.length)} sessions.`);
  return { saved: true };
}

export async function clearFromPalette(deps: DataCommandDeps): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Clear conversation text of all sessions', scope: 'allContent' },
      { label: 'Delete sessions before a date…', scope: 'beforeDay' },
      { label: 'Delete sessions of a workspace…', scope: 'workspace' },
      { label: 'Delete everything', scope: 'everything' },
    ] as const,
    { title: 'TraceOn: clear data' },
  );
  if (pick === undefined) return;
  if (pick.scope === 'allContent' || pick.scope === 'everything') {
    await confirmAndClear(deps, { kind: pick.scope });
  } else if (pick.scope === 'beforeDay') {
    const day = await vscode.window.showInputBox({
      prompt: 'Delete sessions started before this day (YYYY-MM-DD)',
      validateInput: (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : 'Use YYYY-MM-DD'),
    });
    if (day !== undefined) await confirmAndClear(deps, { kind: 'beforeDay', day });
  } else {
    const workspaces = (
      deps.database.db
        .prepare('SELECT DISTINCT workspace FROM sessions ORDER BY workspace')
        .all() as unknown as {
        workspace: string;
      }[]
    ).map((row) => row.workspace);
    const workspace = await vscode.window.showQuickPick(workspaces, { title: 'Workspace to delete' });
    if (workspace !== undefined) await confirmAndClear(deps, { kind: 'workspace', workspace });
  }
}

export async function deleteLegacyData(deps: DataCommandDeps): Promise<void> {
  const files = findLegacyFiles(deps.storageDir);
  if (files.length === 0) {
    void vscode.window.showInformationMessage('No data from the previous version was found.');
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    'Delete data from the previous TraceOn version?',
    {
      modal: true,
      detail: `${String(files.length)} file(s) in this extension's own storage (usage.sqlite3 / usage.json). The new version does not use them. Copilot's own files are not touched.`,
    },
    'Delete',
  );
  if (choice === 'Delete') deleteLegacyFiles(deps.storageDir);
}

/** One-time, non-modal offer on startup when old data exists. */
export function offerLegacyCleanup(deps: DataCommandDeps): void {
  if (findLegacyFiles(deps.storageDir).length === 0 || deps.globalState.get(LEGACY_PROMPTED) === true) return;
  void vscode.window
    .showInformationMessage(
      'TraceOn found data from the previous version that is no longer used.',
      'Review and delete',
      'Keep',
    )
    .then((choice) => {
      void deps.globalState.update(LEGACY_PROMPTED, true);
      if (choice === 'Review and delete') return deleteLegacyData(deps);
      return undefined;
    });
}
