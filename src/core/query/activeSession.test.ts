import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { getActiveSession } from './activeSession';

describe('getActiveSession', () => {
  it('returns the most recently ended session with its turns’ context, credits and compactions', () => {
    const { database } = seededStore();
    const active = getActiveSession(database);
    // fx-byok-1 ended later than fx-auto-1 but has no Copilot credits and a failed first turn.
    expect(active?.endedAt).toBe(
      (database.db.prepare('SELECT max(ended_at) AS t FROM sessions').get() as { t: number }).t,
    );
    expect(active?.turns.length).toBeGreaterThan(0);
  });

  it('carries each turn’s exact input tokens, credits and compaction count', () => {
    const { database } = seededStore();
    database.db.exec("UPDATE sessions SET ended_at = 9999999999999 WHERE id = 'fx-auto-1'");
    const active = getActiveSession(database);
    expect(active?.turns.map((turn) => turn.index)).toEqual([1, 2]);
    expect(active?.turns[0]).toMatchObject({ index: 1, inputTokens: 24_000, compactions: 1 });
    expect(active?.turns[0]?.credits).toBeCloseTo(1.126141);
  });

  it('is null for an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    expect(getActiveSession(database)).toBeNull();
  });
});
