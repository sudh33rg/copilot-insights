import type { TaskType } from './taskType';

export interface OutcomeInput {
  taskType: TaskType;
  changed: readonly { path: string; action: string }[];
  areas: readonly string[];
  linesAdded: number | null;
  linesRemoved: number | null;
  testFilesCreated: number;
  testsPassed: boolean | null;
  testFailures: number | null;
  errorsDelta: number | null;
  undone: number;
  failedTurns: number;
  userTurns: number;
}

const LABELS: Record<TaskType, string> = {
  bugfix: 'Bug fix',
  feature: 'Feature',
  refactor: 'Refactor',
  test: 'Tests',
  docs: 'Docs',
  explain: 'Explanation',
  debug: 'Debugging',
  config: 'Config change',
  other: 'Session',
};

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

/**
 * One sentence of what the session achieved. Every clause states only what there is evidence for; a clause
 * with no evidence is left out rather than written as "0".
 */
export function buildOutcomeSentence(input: OutcomeInput): string {
  const clauses = [
    changedClause(input),
    input.testFilesCreated > 0 ? `added ${plural(input.testFilesCreated, 'test file')}` : null,
    testsClause(input),
    diagnosticsClause(input.errorsDelta),
    input.undone > 0 ? `${plural(input.undone, 'edit')} undone` : null,
    input.failedTurns > 0
      ? `${String(input.failedTurns)} of ${plural(input.userTurns, 'turn')} failed`
      : null,
  ].filter((clause): clause is string => clause !== null);
  const areas = input.areas.length > 0 && input.changed.length > 0 ? ` — in ${input.areas.join(', ')}` : '';
  return `${LABELS[input.taskType]}: ${clauses.join(', ')}${areas}.`;
}

function changedClause(input: OutcomeInput): string {
  if (input.changed.length === 0) return 'no files changed';
  const count = (action: string) => input.changed.filter((file) => file.action === action).length;
  const detail = (['edited', 'created', 'deleted'] as const)
    .map((action) => (count(action) > 0 ? `${String(count(action))} ${action}` : null))
    .filter((item): item is string => item !== null)
    .join(', ');
  const lines =
    input.linesAdded !== null && input.linesRemoved !== null
      ? `; +${String(input.linesAdded)} −${String(input.linesRemoved)} lines`
      : '';
  return `changed ${plural(input.changed.length, 'file')} (${detail}${lines})`;
}

function testsClause(input: OutcomeInput): string | null {
  if (input.testsPassed === null) return null;
  if (input.testsPassed) return 'tests passed on the last run';
  return input.testFailures === null
    ? 'tests failed on the last run'
    : `tests failed on the last run (${plural(input.testFailures, 'failing run')})`;
}

function diagnosticsClause(delta: number | null): string | null {
  if (delta === null || delta === 0) return null;
  const count = Math.abs(delta);
  return `${String(count)} ${delta < 0 ? 'fewer' : 'more'} diagnostics ${count === 1 ? 'error' : 'errors'}`;
}
