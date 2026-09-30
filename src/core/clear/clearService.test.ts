import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import { seededStore } from '../../../test/fixtures/sessions';
import { resolveStorageRoots } from '../ingest/roots';
import { scanChatSessions } from '../ingest/scanner';
import { IngestStateStore } from '../storage/ingestStateStore';
import { localDay } from '../time';
import { ClearService } from './clearService';

const AUTO_START = 1790000001000;
const BYOK_START = 1790100000000;

function setup() {
  const { database, sessions } = seededStore();
  const state = new IngestStateStore(database);
  return { database, sessions, state, clear: new ClearService(database, sessions, state, () => 42) };
}
const ids = (database: ReturnType<typeof setup>['database']) =>
  (database.db.prepare('SELECT id FROM sessions ORDER BY id').all() as { id: string }[]).map((row) => row.id);

describe('ClearService', () => {
  it('counts without changing anything', () => {
    const { clear, database } = setup();
    expect(clear.count({ kind: 'everything' })).toBe(2);
    expect(clear.count({ kind: 'session', id: 'nope' })).toBe(0);
    expect(ids(database)).toEqual(['fx-auto-1', 'fx-byok-1']);
  });

  it('deletes one session and tombstones it', () => {
    const { clear, database, state } = setup();
    expect(clear.clear({ kind: 'session', id: 'fx-auto-1' })).toEqual({ sessions: 1 });
    expect(ids(database)).toEqual(['fx-byok-1']);
    expect(state.getTombstones()).toEqual({ 'fx-auto-1': 'deleted' });
  });

  it('clears conversation content but keeps telemetry, and tombstones it as content-cleared', () => {
    const { clear, database, state } = setup();
    clear.clear({ kind: 'sessionContent', id: 'fx-auto-1' });
    const row = database.db
      .prepare(
        "SELECT count(user_text) AS text, sum(prompt_tokens) AS tokens FROM turns WHERE session_id = 'fx-auto-1'",
      )
      .get() as { text: number; tokens: number };
    expect(row).toEqual({ text: 0, tokens: 54000 });
    expect(state.getTombstones()).toEqual({ 'fx-auto-1': 'content-cleared' });
  });

  it('deletes by day, by workspace, and everything; clears all content', () => {
    const a = setup();
    a.clear.clear({ kind: 'beforeDay', day: localDay(BYOK_START) });
    expect(ids(a.database)).toEqual(['fx-byok-1']);
    const b = setup();
    b.clear.clear({ kind: 'workspace', workspace: 'alpha' });
    expect(ids(b.database)).toEqual(['fx-byok-1']);
    const c = setup();
    expect(c.clear.clear({ kind: 'everything' })).toEqual({ sessions: 2 });
    expect(ids(c.database)).toEqual([]);
    expect(Object.values(c.state.getTombstones())).toEqual(['deleted', 'deleted']);
    const d = setup();
    d.clear.clear({ kind: 'allContent' });
    expect(ids(d.database)).toEqual(['fx-auto-1', 'fx-byok-1']);
    expect((d.database.db.prepare('SELECT count(user_text) AS n FROM turns').get() as { n: number }).n).toBe(
      0,
    );
    expect(AUTO_START).toBeLessThan(BYOK_START);
  });

  it('stays cleared when the still-existing Copilot files are scanned again', () => {
    const { clear, state } = setup();
    clear.clear({ kind: 'session', id: 'fx-auto-1' });
    clear.clear({ kind: 'sessionContent', id: 'fx-byok-1' });
    const { userDir } = createFixtureUserDir();
    const { results, stats } = scanChatSessions({
      roots: resolveStorageRoots({ userDirs: [userDir] }),
      known: {},
      captureLevel: 'full',
      tombstones: state.getTombstones(),
    });
    expect(results.some((result) => result.session?.id === 'fx-auto-1')).toBe(false);
    expect(stats.deleted).toBe(1);
    const byok = results.find((result) => result.session?.id === 'fx-byok-1');
    expect(byok?.session?.turns.every((turn) => turn.userText === null)).toBe(true);
  });

  it('also drops cached GitHub usage when everything is deleted', () => {
    const { clear, database } = setup();
    database.db.prepare("INSERT INTO github_daily_usage VALUES ('2026-09-01', 'octo', 1, 1)").run();
    clear.clear({ kind: 'sessionContent', id: 'fx-auto-1' });
    expect(
      (database.db.prepare('SELECT count(*) AS n FROM github_daily_usage').get() as { n: number }).n,
    ).toBe(1);
    clear.clear({ kind: 'everything' });
    expect(
      (database.db.prepare('SELECT count(*) AS n FROM github_daily_usage').get() as { n: number }).n,
    ).toBe(0);
  });

  it('removes a deleted session’s debug-log telemetry with it', () => {
    const { clear, database } = setup();
    const calls = () => (database.db.prepare('SELECT count(*) AS n FROM llm_calls').get() as { n: number }).n;
    expect(calls()).toBe(4);
    clear.clear({ kind: 'session', id: 'fx-auto-1' });
    expect(calls()).toBe(0);
  });
});
