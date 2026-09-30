import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { InsightsQueries } from './insightsQueries';

describe('InsightsQueries', () => {
  it('adds the outcome sentence to list rows', () => {
    const queries = new InsightsQueries(seededStore().database);
    const { rows } = queries.listSessions({ offset: 0, limit: 10 });
    expect(rows.find((row) => row.id === 'fx-auto-1')?.outcome).toBe(
      'Changed 2 files (1 edited, 1 created) — in execution, test.',
    );
    expect(rows.find((row) => row.id === 'fx-byok-1')?.outcome).toBe('No files changed, 1 of 1 turn failed.');
  });

  it('adds the analysis to session detail and passes overview through', () => {
    const queries = new InsightsQueries(seededStore().database);
    const detail = queries.getSession('fx-auto-1');
    expect(detail?.analysis?.intent.value).toBe('bugfix');
    expect(detail?.analysis?.complexity.value).toBe('moderate');
    expect(queries.getSession('nope')).toBeNull();
    expect(queries.getOverview('2026-09-30').month.from).toBe('2026-09-01');
  });
});
