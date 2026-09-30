import type { TurnDetail } from '../../shared/dto';
import { TERMINAL_TOOL } from '../ingest/toolNames';

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
