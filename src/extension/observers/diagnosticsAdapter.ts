import * as vscode from 'vscode';
import type { DiagEntry } from '../../core/storage/observationStore';

const MAX_FILES = 500;

/** Counts only: message text is never read. Files with no errors or warnings are omitted (absent means zero). */
export function snapshotDiagnostics(): DiagEntry[] {
  const entries: DiagEntry[] = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file') continue;
    const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
    if (errors + warnings > 0) entries.push({ path: uri.fsPath, errors, warnings });
    if (entries.length >= MAX_FILES) break;
  }
  return entries;
}
