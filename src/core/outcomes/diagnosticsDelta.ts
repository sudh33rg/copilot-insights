import type { DiagEntry } from '../storage/observationStore';

export interface DiagnosticsDelta {
  errors: number;
  warnings: number;
  errorsBefore: number;
  errorsAfter: number;
}

/** Live source of diagnostics; counts only, implemented over `vscode.languages` in the extension. */
export interface DiagnosticsPort {
  snapshot(): DiagEntry[];
}

/**
 * Change in error/warning counts over the files a session edited. Snapshots omit files with no problems, so an
 * absent entry means zero. Null when a snapshot was never taken or nothing was edited.
 */
export function diagnosticsDelta(
  before: readonly DiagEntry[] | null,
  after: readonly DiagEntry[] | null,
  editedPaths: readonly string[],
): DiagnosticsDelta | null {
  const paths = [...new Set(editedPaths)];
  if (before === null || after === null || paths.length === 0) return null;
  const at = (entries: readonly DiagEntry[]) => new Map(entries.map((entry) => [entry.path, entry]));
  const from = at(before);
  const to = at(after);
  const total = (map: Map<string, DiagEntry>, field: 'errors' | 'warnings') =>
    paths.reduce((sum, path) => sum + (map.get(path)?.[field] ?? 0), 0);
  const errorsBefore = total(from, 'errors');
  const errorsAfter = total(to, 'errors');
  return {
    errors: errorsAfter - errorsBefore,
    warnings: total(to, 'warnings') - total(from, 'warnings'),
    errorsBefore,
    errorsAfter,
  };
}
