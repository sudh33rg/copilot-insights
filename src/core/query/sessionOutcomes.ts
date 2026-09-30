import type { Outcomes } from '../../shared/dto';
import { derived, unavailable, type Measured } from '../../shared/provenance';
import { diffSnapshots } from '../git/snapshots';
import type { Database } from '../storage/database';
import { ObservationReader, type StoredSnapshot } from '../storage/observationStore';

const GIT_SOURCE =
  'git working-tree diff between first and latest observation while VS Code was open (tracked files only)';

/** Everything the extension observed about what a session achieved. Missing evidence is `unavailable`, never 0. */
export function getSessionOutcomes(database: Pick<Database, 'db'>, id: string): Outcomes {
  const observations = new ObservationReader(database);
  const lines = linesChanged(observations.getSnapshots(id, 'start'), observations.getSnapshots(id, 'latest'));
  return {
    linesAdded: lineCount(lines, 'added'),
    linesRemoved: lineCount(lines, 'removed'),
  };
}

type Lines = { added: number; removed: number } | { unavailable: string };

function lineCount(lines: Lines, field: 'added' | 'removed'): Measured<number> {
  return 'unavailable' in lines ? unavailable(lines.unavailable) : derived(lines[field], GIT_SOURCE);
}

function linesChanged(start: readonly StoredSnapshot[], latest: readonly StoredSnapshot[]): Lines {
  if (start.length === 0) return { unavailable: 'no git snapshot: VS Code was not observing this session' };
  if (latest.length === 0) return { unavailable: 'only one git observation so far' };
  const diff = diffSnapshots(start, latest);
  if (diff !== null) return diff;
  const headMoved = start.some((from) =>
    latest.some((to) => to.repoRoot === from.repoRoot && to.head !== from.head),
  );
  return {
    unavailable: headMoved
      ? 'HEAD changed during the session; see linked commits'
      : 'no repository was observed at both the start and the latest check',
  };
}
