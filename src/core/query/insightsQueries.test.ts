import { describe, expect, it } from 'vitest';
import { cloneSession, loadFixtureSession, seededStore } from '../../../test/fixtures/sessions';
import { InsightsQueries } from './insightsQueries';

describe('InsightsQueries', () => {
  it('adds the outcome sentence to list rows', () => {
    const queries = new InsightsQueries(seededStore().database);
    const { rows } = queries.listSessions({ offset: 0, limit: 10 });
    expect(rows.find((row) => row.id === 'fx-auto-1')?.outcome).toBe(
      'Bug fix: changed 2 files (1 edited, 1 created), added 1 test file — in execution, test.',
    );
    expect(rows.find((row) => row.id === 'fx-byok-1')?.outcome).toBe(
      'Explanation: no files changed, 1 of 1 turn failed.',
    );
  });

  it('adds the analysis to session detail and passes overview through', () => {
    const queries = new InsightsQueries(seededStore().database);
    const detail = queries.getSession('fx-auto-1');
    expect(detail?.analysis?.intent.value).toBe('bugfix');
    expect(detail?.analysis?.complexity.value).toBe('moderate');
    expect(queries.getSession('nope')).toBeNull();
    expect(queries.getOverview('2026-09-30').month.from).toBe('2026-09-01');
  });

  describe('baselines', () => {
    function withHistory() {
      const { database, sessions } = seededStore();
      const source = loadFixtureSession('auto-agent-session.jsonl', 'alpha');
      for (let i = 1; i <= 6; i++)
        sessions.replaceSession(cloneSession(source, `clone-${String(i)}`, i * 1000), 'full', 1);
      database.db.exec("UPDATE turns SET prompt_tokens = prompt_tokens * 4 WHERE session_id = 'clone-6'");
      return { database, queries: new InsightsQueries(database) };
    }

    it('compares a session with your other sessions of the same task type and model', () => {
      const { queries } = withHistory();
      const baseline = queries.getSession('clone-6')?.baseline;
      expect(baseline).toMatchObject({ taskType: 'bugfix', model: 'gpt-5.6-luna', sessions: 6 });
      expect(baseline?.verdict).toEqual({
        value: 'high',
        provenance: {
          kind: 'inferred',
          source: 'more than 3 scaled MADs and 1.5× from the median of your other sessions',
        },
      });
      expect(baseline?.median).toEqual({
        value: 54_000,
        provenance: {
          kind: 'derived',
          source: 'median ± MAD of your other sessions of the same task type on the same model',
        },
      });
      expect(baseline?.thisSession.value).toBe(216_000);
      expect(baseline?.message).toBe(
        'Your bugfix sessions on gpt-5.6-luna normally use about 54,000 input tokens (6 other sessions). This one used 216,000. That is unusually high.',
      );
    });

    it('has no baseline for a session without enough history', () => {
      const queries = new InsightsQueries(seededStore().database);
      expect(queries.getSession('fx-auto-1')?.baseline).toBeNull();
    });

    it('lists typical usage and unusual sessions', () => {
      const { queries } = withHistory();
      const { rows, outliers } = queries.getBaselines();
      expect(rows[0]).toMatchObject({
        taskType: 'bugfix',
        model: 'gpt-5.6-luna',
        sessions: 7,
        creditSessions: 7,
      });
      expect(rows[0]?.inputMedian.value).toBe(54_000);
      expect(outliers.map((entry) => entry.sessionId)).toEqual(['clone-6']);
      expect(outliers[0]).toMatchObject({ taskType: 'bugfix', title: 'Fix run timeout race' });
    });

    it('marks an under-sample median unavailable with the count', () => {
      const queries = new InsightsQueries(seededStore().database);
      const luna = queries.getBaselines().rows.find((row) => row.model === 'gpt-5.6-luna');
      expect(luna?.sessions).toBe(1);
      expect(luna?.inputMedian).toEqual({
        value: null,
        provenance: { kind: 'unavailable', source: 'not enough data: 1 of 5 sessions' },
      });
      expect(luna?.creditsMedian.value).toBeNull();
    });
  });
});
