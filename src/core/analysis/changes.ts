import type { TurnDetail } from '../../shared/dto';

export interface ChangeSummary {
  changed: { path: string; action: 'edited' | 'created' | 'deleted' }[];
  edited: number;
  created: number;
  deleted: number;
  undone: number;
  areas: string[];
  commandCount: number;
}

const CHANGE_RANK = { edited: 1, deleted: 2, created: 3 } as const;
const TERMINAL_TOOL = /terminal|run_?command|execute_?command/i;

export function summarizeChanges(turns: readonly TurnDetail[]): ChangeSummary {
  const strongest = new Map<string, 'edited' | 'created' | 'deleted'>();
  const undone = new Set<string>();
  let commandCount = 0;
  for (const turn of turns) {
    for (const event of turn.fileEvents) {
      if (event.action === 'undone') undone.add(event.path);
      if (event.action !== 'edited' && event.action !== 'created' && event.action !== 'deleted') continue;
      const current = strongest.get(event.path);
      if (current === undefined || CHANGE_RANK[event.action] > CHANGE_RANK[current]) {
        strongest.set(event.path, event.action);
      }
    }
    commandCount += turn.toolCalls.filter((call) => TERMINAL_TOOL.test(call.name)).length;
  }
  const changed = [...strongest].map(([path, action]) => ({ path, action }));
  return {
    changed,
    edited: changed.filter((file) => file.action === 'edited').length,
    created: changed.filter((file) => file.action === 'created').length,
    deleted: changed.filter((file) => file.action === 'deleted').length,
    undone: undone.size,
    areas: topAreas(changed.map((file) => file.path)),
    commandCount,
  };
}

/** The parent directory name of each changed file; a coarse, honest "where" that needs no workspace root. */
function topAreas(paths: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const segments = path.split(/[\\/]/).filter((segment) => segment !== '');
    const area = segments.length >= 2 ? segments[segments.length - 2] : undefined;
    if (area !== undefined) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([area]) => area)
    .sort((a, b) => a.localeCompare(b));
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

export function buildOutcome(summary: ChangeSummary, turns: readonly TurnDetail[]): string {
  const parts: string[] = [];
  const total = summary.changed.length;
  if (total > 0) {
    const detail = [
      summary.edited > 0 ? `${String(summary.edited)} edited` : null,
      summary.created > 0 ? `${String(summary.created)} created` : null,
      summary.deleted > 0 ? `${String(summary.deleted)} deleted` : null,
    ].filter((item): item is string => item !== null);
    parts.push(`Changed ${plural(total, 'file')} (${detail.join(', ')})`);
  } else {
    parts.push('No files changed');
  }
  if (summary.commandCount > 0) parts.push(`ran ${plural(summary.commandCount, 'terminal command')}`);
  if (summary.undone > 0) parts.push(`${plural(summary.undone, 'edit')} undone`);
  const userTurns = turns.filter((turn) => !turn.systemInitiated);
  const failed = userTurns.filter((turn) => turn.state === 'failed').length;
  if (failed > 0) parts.push(`${String(failed)} of ${plural(userTurns.length, 'turn')} failed`);
  const areas = summary.areas.length > 0 ? ` — in ${summary.areas.join(', ')}` : '';
  return `${parts.join(', ')}${areas}.`;
}
