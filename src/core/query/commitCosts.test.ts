import { describe, expect, it } from 'vitest';
import { cloneSession, loadFixtureSession, seededStore } from '../../../test/fixtures/sessions';
import { ObservationStore } from '../storage/observationStore';
import { getCommitCosts } from './commitCosts';

const SOURCE = 'session credits split evenly across the commits each session links to';

function setup() {
  const { database, sessions } = seededStore();
  sessions.replaceSession(
    cloneSession(loadFixtureSession('auto-agent-session.jsonl', 'alpha'), 'fx-auto-2', 1000),
    'full',
    1,
  );
  const credits = database.db.prepare('UPDATE turns SET credits = :c WHERE session_id = :s AND idx = :i');
  credits.run({ c: 4, s: 'fx-auto-1', i: 1 });
  credits.run({ c: 2, s: 'fx-auto-1', i: 2 });
  credits.run({ c: 3, s: 'fx-auto-2', i: 1 });
  credits.run({ c: 0, s: 'fx-auto-2', i: 2 });
  const observations = new ObservationStore(database);
  const link = (sessionId: string, ...hashes: string[]): void => {
    observations.replaceSessionCommits(
      sessionId,
      hashes.map((hash, i) => ({ hash, committedAt: 100 + i, overlapFiles: 1, editedFiles: 1, linkedAt: 1 })),
    );
  };
  return { database, link, credits };
}

describe('getCommitCosts', () => {
  it('splits each session’s credits evenly across its commits and adds sessions sharing a commit', () => {
    const { database, link } = setup();
    link('fx-auto-1', 'c1', 'c2'); // 6 credits → 3 each
    link('fx-auto-2', 'c2'); // 3 credits → 3
    const rows = getCommitCosts(database);
    const c1 = rows.find((row) => row.hash === 'c1');
    const c2 = rows.find((row) => row.hash === 'c2');
    expect(c1).toMatchObject({
      sessions: 1,
      credits: { value: 3, provenance: { kind: 'derived', source: SOURCE } },
    });
    expect(c2).toMatchObject({
      sessions: 2,
      credits: { value: 6, provenance: { kind: 'derived', source: SOURCE } },
    });
  });

  it('marks a commit as a lower bound when a linked session has no credits', () => {
    const { database, link } = setup();
    link('fx-auto-1', 'c1');
    link('fx-byok-1', 'c1'); // BYOK: Copilot reports no credits
    const row = getCommitCosts(database).find((entry) => entry.hash === 'c1');
    expect(row?.credits.value).toBe(6);
    expect(row?.credits.provenance.kind).toBe('derived');
    expect(row?.credits.provenance.source).toContain('lower bound');
    expect(row?.sessions).toBe(2);
  });

  it('marks a commit as a lower bound when a session’s own credits are only partial', () => {
    const { database, link, credits } = setup();
    credits.run({ c: null, s: 'fx-auto-1', i: 2 });
    link('fx-auto-1', 'c1');
    const row = getCommitCosts(database).find((entry) => entry.hash === 'c1');
    expect(row?.credits.value).toBe(4);
    expect(row?.credits.provenance.source).toContain('lower bound');
  });

  it('is unavailable, not zero, when no linked session reported credits', () => {
    const { database, link } = setup();
    link('fx-byok-1', 'c1');
    const row = getCommitCosts(database).find((entry) => entry.hash === 'c1');
    expect(row?.credits.value).toBeNull();
    expect(row?.credits.provenance.kind).toBe('unavailable');
  });

  it('ignores links whose session no longer exists', () => {
    const { database, link } = setup();
    link('fx-auto-1', 'c1');
    database.db.exec("DELETE FROM sessions WHERE id = 'fx-auto-1'");
    expect(getCommitCosts(database)).toEqual([]);
  });

  it('lists the newest commits first', () => {
    const { database, link } = setup();
    link('fx-auto-1', 'c1', 'c2');
    expect(getCommitCosts(database).map((row) => row.hash)).toEqual(['c2', 'c1']);
  });
});
