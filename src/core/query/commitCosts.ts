import type { CommitCostRow } from '../../shared/dto';
import { derived, unavailable } from '../../shared/provenance';
import type { Database } from '../storage/database';
import { groupBy } from './measure';
import { getSessionCredits } from './sessionCredits';

const SOURCE = 'session credits split evenly across the commits each session links to';
const LOWER_BOUND = `${SOURCE} (lower bound: some linked sessions have no or only partial credits)`;

/**
 * What each linked commit cost. A session's Copilot credits are divided evenly over the commits it links to
 * (an allocation of the session's own per-request credits, never of GitHub's daily or account totals).
 */
export function getCommitCosts(database: Pick<Database, 'db'>): CommitCostRow[] {
  const links = database.db
    .prepare(
      `SELECT c.hash, c.committed_at, c.session_id,
              (SELECT COUNT(*) FROM session_commits x WHERE x.session_id = c.session_id) AS links
         FROM session_commits c JOIN sessions s ON s.id = c.session_id`,
    )
    .all() as unknown as { hash: string; committed_at: number; session_id: string; links: number }[];
  const credits = getSessionCredits(database);

  return [...groupBy(links, (link) => link.hash)]
    .map(([hash, group]): CommitCostRow => {
      let total = 0;
      let known = 0;
      let partial = false;
      for (const link of group) {
        const session = credits.get(link.session_id);
        if (session?.value == null) {
          partial = true;
          continue;
        }
        known++;
        total += session.value / link.links;
        if (session.provenance.source.includes('lower bound')) partial = true;
      }
      return {
        hash,
        committedAt: Math.max(...group.map((link) => link.committed_at)),
        sessions: group.length,
        credits:
          known === 0
            ? unavailable('no linked session reported Copilot credits')
            : derived(total, partial ? LOWER_BOUND : SOURCE),
      };
    })
    .sort((a, b) => b.committedAt - a.committedAt || a.hash.localeCompare(b.hash));
}
