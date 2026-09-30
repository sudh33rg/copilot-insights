import { describe, expect, it } from 'vitest';
import { loadFixtureSession, seededStore } from '../../../test/fixtures/sessions';
import { ANALYZER_VERSION } from './analyzeSession';
import { ObservationStore } from '../storage/observationStore';
import { AnalysisStore } from './analysisStore';

const cachedRows = (database: ReturnType<typeof seededStore>['database']) =>
  (database.db.prepare('SELECT count(*) AS n FROM session_analysis').get() as { n: number }).n;

describe('AnalysisStore', () => {
  it('returns null for an unknown session', () => {
    expect(new AnalysisStore(seededStore().database).get('nope')).toBeNull();
  });

  it('computes once and serves the cache afterwards', () => {
    const { database } = seededStore();
    const store = new AnalysisStore(database);
    const first = store.get('fx-auto-1');
    expect(first?.intent.value).toBe('bugfix');
    expect(first?.outcome.value).toBe(
      'Bug fix: changed 2 files (1 edited, 1 created), added 1 test file — in execution, test.',
    );
    expect(cachedRows(database)).toBe(1);
    database.db.prepare("UPDATE session_analysis SET json = replace(json, 'bugfix', 'cached-marker')").run();
    expect(store.get('fx-auto-1')?.intent.value).toBe('cached-marker');
  });

  it('recomputes when the analyzer version changes or the session is re-ingested', () => {
    const { database, sessions } = seededStore();
    const store = new AnalysisStore(database);
    store.get('fx-auto-1');
    database.db.prepare('UPDATE session_analysis SET analyzer_version = :v').run({ v: ANALYZER_VERSION - 1 });
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
    expect(
      (database.db.prepare('SELECT analyzer_version AS v FROM session_analysis').get() as { v: number }).v,
    ).toBe(ANALYZER_VERSION);
    sessions.replaceSession(loadFixtureSession('auto-agent-session.jsonl', 'alpha'), 'full', 999);
    expect(cachedRows(database)).toBe(0);
    expect(store.get('fx-auto-1')).not.toBeNull();
  });

  it('is recomputed after content is cleared', () => {
    const { database, sessions } = seededStore();
    const store = new AnalysisStore(database);
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
    sessions.clearContent(['fx-auto-1']);
    expect(store.get('fx-auto-1')?.intent.provenance.kind).toBe('unavailable');
  });

  it('ignores a corrupt cached row', () => {
    const { database } = seededStore();
    const store = new AnalysisStore(database);
    store.get('fx-auto-1');
    database.db.prepare("UPDATE session_analysis SET json = '{not json'").run();
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
  });

  it('recomputes when live observations of that session changed after the cached analysis', () => {
    const { database } = seededStore();
    const store = new AnalysisStore(database);
    const observations = new ObservationStore(database);
    const observedAt = (id: string) =>
      (
        database.db
          .prepare('SELECT observed_at AS t FROM session_analysis WHERE session_id = :id')
          .get({ id }) as { t: number }
      ).t;
    observations.touchSession('fx-auto-1', 100);
    store.get('fx-auto-1');
    expect(observedAt('fx-auto-1')).toBe(100);
    store.get('fx-auto-1');
    expect(observedAt('fx-auto-1')).toBe(100);
    observations.touchSession('fx-auto-1', 200);
    store.get('fx-auto-1');
    expect(observedAt('fx-auto-1')).toBe(200);
  });

  it('keeps other sessions’ cached analyses when one session is observed', () => {
    const { database } = seededStore();
    const store = new AnalysisStore(database);
    store.get('fx-auto-1');
    store.get('fx-byok-1');
    database.db
      .prepare("UPDATE session_analysis SET json = replace(json, 'Explanation', 'cached-marker')")
      .run();
    new ObservationStore(database).touchSession('fx-byok-1', 500);
    expect(store.get('fx-byok-1')?.outcome.value).not.toContain('cached-marker');
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
    const rows = database.db.prepare('SELECT count(*) AS n FROM session_analysis').get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it('recomputes after a later change even when an earlier one was already cached', () => {
    const { database } = seededStore();
    const observations = new ObservationStore(database);
    observations.touchSession('fx-auto-1', 100);
    const store = new AnalysisStore(database);
    store.get('fx-auto-1');
    // A change that lands after the analysis was computed must make the cached row stale.
    observations.touchSession('fx-auto-1', 101);
    database.db.prepare("UPDATE session_analysis SET json = replace(json, 'bugfix', 'cached-marker')").run();
    expect(store.get('fx-auto-1')?.intent.value).toBe('bugfix');
  });
});
