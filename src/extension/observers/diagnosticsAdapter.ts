import * as vscode from 'vscode';
import type { DiagEntry } from '../../core/storage/observationStore';

/** Above this many files with problems the snapshot is marked truncated and no delta is derived from it. */
export const MAX_DIAGNOSTIC_FILES = 5000;

/** Counts only: message text is never read. Files with no errors or warnings are omitted (absent means zero). */
export function snapshotDiagnostics(): { entries: DiagEntry[]; truncated: boolean } {
  const entries: DiagEntry[] = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file') continue;
    const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
    if (errors + warnings === 0) continue;
    if (entries.length >= MAX_DIAGNOSTIC_FILES) return { entries, truncated: true };
    entries.push({ path: uri.fsPath, errors, warnings });
  }
  return { entries, truncated: false };
}
