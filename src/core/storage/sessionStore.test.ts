import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../test/fixtures/fixtures';
import { normalizeChatSession } from '../ingest/chatSession';
import { replayMutationLog } from '../ingest/mutationLog';
import type { NormalizedSession } from '../ingest/types';
import { applyCaptureLevel } from '../privacy/captureLevel';
import { daysAgo, localDay } from '../time';
import { Database } from './database';
import { ObservationStore } from './observationStore';
import { SessionStore } from './sessionStore';

function fixture(): NormalizedSession {
  const session = normalizeChatSession(
    replayMutationLog(readFileSync(fixturePath('auto-agent-session.jsonl'), 'utf8')).state,
    { file: 'a.jsonl', workspace: 'w' },
  );
  if (session === null) throw new Error('fixture failed to load');
  return applyCaptureLevel(session, 'full');
}

function newStore() {
  const database = new Database(':memory:');
  return { database, sessions: new SessionStore(database) };
}

describe('SessionStore', () => {
  it('stores sessions with turns, tool calls and file events', () => {
    const { sessions } = newStore();
    sessions.replaceSession(fixture(), 'full', 1);
    const stored = sessions.getSession('fx-auto-1');
    expect(stored).toMatchObject({
      id: 'fx-auto-1',
      workspace: 'w',
      title: 'Fix run timeout race',
      captureLevel: 'full',
      activeMs: 18000,
      day: localDay(1790000001000),
    });
    expect(stored?.turns).toHaveLength(2);
    expect(stored?.turns[0]).toMatchObject({
      promptTokens: 24000,
      credits: 1.126141,
      resolvedModel: 'gpt-5.6-luna',
      selectionMode: 'AUTO',
      modelHost: 'copilot',
      systemInitiated: false,
    });
    expect(stored?.turns[0]?.toolCalls.map((call) => call.name)).toEqual([
      'read_file',
      'replace_string_in_file',
    ]);
    expect(stored?.turns[1]?.fileEvents.map((event) => event.action)).toEqual(['created', 'kept']);
    expect(sessions.counts()).toEqual({ sessions: 1, turns: 2 });
  });

  it('replaces a session completely when the same id arrives again from another file', () => {
    const { sessions } = newStore();
    const session = fixture();
    sessions.replaceSession(session, 'full', 1);
    sessions.replaceSession(
      { ...session, sourceFile: 'moved.jsonl', turns: session.turns.slice(0, 1) },
      'full',
      2,
    );
    expect(sessions.counts()).toEqual({ sessions: 1, turns: 1 });
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.toolCalls).toHaveLength(2);
  });

  it('clears conversation content but keeps telemetry', () => {
    const { sessions } = newStore();
    sessions.replaceSession(fixture(), 'full', 1);
    sessions.clearContent(['fx-auto-1']);
    const stored = sessions.getSession('fx-auto-1');
    expect(stored?.title).toBeNull();
    expect(stored?.captureLevel).toBe('metrics');
    expect(stored?.turns.every((turn) => turn.userText === null && turn.assistantText === null)).toBe(true);
    expect(stored?.turns.flatMap((turn) => turn.toolCalls).every((call) => call.args === null)).toBe(true);
    expect(stored?.turns[0]?.promptTokens).toBe(24000);
  });

  it('downgrades stored full content to summaries', () => {
    const { sessions } = newStore();
    const session = fixture();
    const long = {
      ...session,
      turns: session.turns.map((turn) => ({ ...turn, assistantText: 'y'.repeat(1000) })),
    };
    sessions.replaceSession(long, 'full', 1);
    sessions.downgradeStoredContent('summaries');
    const stored = sessions.getSession('fx-auto-1');
    expect(stored?.captureLevel).toBe('summaries');
    expect(stored?.turns[0]?.assistantText).toHaveLength(420);
    expect(stored?.turns.flatMap((turn) => turn.toolCalls).every((call) => call.args === null)).toBe(true);
  });

  it('downgrades stored content to metrics', () => {
    const { sessions } = newStore();
    sessions.replaceSession(fixture(), 'full', 1);
    sessions.downgradeStoredContent('metrics');
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.userText).toBeNull();
  });

  it('filters, deletes and purges', () => {
    const { sessions } = newStore();
    const session = fixture();
    const day = localDay(session.startedAt);
    sessions.replaceSession(session, 'full', 1);
    sessions.replaceSession({ ...session, id: 'other', workspace: 'x' }, 'full', 1);
    expect(sessions.listSessionIds({ workspace: 'x' })).toEqual(['other']);
    expect(sessions.listSessionIds({ fromDay: daysAgo(day, -1) })).toEqual([]);
    expect(sessions.listSessionIds({ fromDay: day, toDay: day }).sort()).toEqual(['fx-auto-1', 'other']);
    sessions.deleteSessions(['other']);
    expect(sessions.counts()).toEqual({ sessions: 1, turns: 2 });
    expect(sessions.purgeBefore(day)).toBe(0);
    expect(sessions.purgeBefore(daysAgo(day, -1))).toBe(1);
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });

  it('writes nothing when the surrounding transaction fails', () => {
    const { database, sessions } = newStore();
    expect(() => {
      database.transaction(() => {
        sessions.replaceSession(fixture(), 'full', 1);
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });

  it('drops cached analysis when content is cleared or downgraded', () => {
    const { database, sessions } = newStore();
    const cached = () =>
      (database.db.prepare('SELECT count(*) AS n FROM session_analysis').get() as { n: number }).n;
    sessions.replaceSession(fixture(), 'full', 1);
    database.db
      .prepare(
        "INSERT INTO session_analysis (session_id, analyzer_version, ingested_at, json) VALUES ('fx-auto-1', 1, 1, '{}')",
      )
      .run();
    sessions.downgradeStoredContent('summaries');
    expect(cached()).toBe(0);
    database.db
      .prepare(
        "INSERT INTO session_analysis (session_id, analyzer_version, ingested_at, json) VALUES ('fx-auto-1', 1, 1, '{}')",
      )
      .run();
    sessions.clearContent(['fx-auto-1']);
    expect(cached()).toBe(0);
  });

  describe('observations and fingerprints', () => {
    const SECRET = 'SECRET-CODE-LINE-do-not-store-me';

    function withFingerprints(level: 'full' | 'summaries' | 'metrics'): NormalizedSession {
      const session = fixture();
      const turn = session.turns[0];
      if (turn === undefined) throw new Error('fixture has no turns');
      const call = turn.toolCalls[0];
      if (call === undefined) throw new Error('fixture turn has no tool calls');
      const withPrints: NormalizedSession = {
        ...session,
        turns: [
          {
            ...turn,
            editFingerprints: [{ path: '/repo/a.ts', hashes: ['0123456789abcdef'] }],
            toolCalls: [{ ...call, commandHash: 'fedcba9876543210' }, ...turn.toolCalls.slice(1)],
          },
          ...session.turns.slice(1),
        ],
      };
      return applyCaptureLevel(withPrints, level);
    }

    const rows = (database: Database, sql: string) => database.db.prepare(sql).all();

    it('keeps live observations when a session is replaced by a rescan', () => {
      const { database, sessions } = newStore();
      sessions.replaceSession(fixture(), 'full', 1);
      new ObservationStore(database).saveSnapshot({
        sessionId: 'fx-auto-1',
        kind: 'start',
        repoRoot: '/repo',
        head: 'abc',
        takenAt: 5,
        files: [],
      });
      sessions.replaceSession(fixture(), 'full', 2);
      sessions.replaceSession(fixture(), 'full', 3);
      expect(rows(database, 'SELECT * FROM git_snapshots')).toHaveLength(1);
    });

    it('stores fingerprints and command hashes at summaries level', () => {
      const { database, sessions } = newStore();
      sessions.replaceSession(withFingerprints('summaries'), 'summaries', 1);
      expect(rows(database, 'SELECT * FROM edit_fingerprints')).toEqual([
        expect.objectContaining({ path: '/repo/a.ts', hashes: '["0123456789abcdef"]' }),
      ]);
      expect(
        rows(database, 'SELECT command_hash FROM tool_calls WHERE command_hash IS NOT NULL'),
      ).toHaveLength(1);
    });

    it('keeps fingerprints when downgrading full content to summaries', () => {
      const { database, sessions } = newStore();
      sessions.replaceSession(withFingerprints('full'), 'full', 1);
      sessions.downgradeStoredContent('summaries');
      expect(rows(database, 'SELECT * FROM edit_fingerprints')).toHaveLength(1);
    });

    it('removes fingerprints and command hashes when downgrading to metrics', () => {
      const { database, sessions } = newStore();
      sessions.replaceSession(withFingerprints('full'), 'full', 1);
      sessions.downgradeStoredContent('metrics');
      expect(rows(database, 'SELECT * FROM edit_fingerprints')).toEqual([]);
      expect(rows(database, 'SELECT command_hash FROM tool_calls WHERE command_hash IS NOT NULL')).toEqual(
        [],
      );
    });

    it('removes fingerprints and command hashes when content is cleared', () => {
      const { database, sessions } = newStore();
      sessions.replaceSession(withFingerprints('full'), 'full', 1);
      sessions.clearContent(['fx-auto-1']);
      expect(rows(database, 'SELECT * FROM edit_fingerprints')).toEqual([]);
      expect(rows(database, 'SELECT command_hash FROM tool_calls WHERE command_hash IS NOT NULL')).toEqual(
        [],
      );
    });

    it('stores no fingerprints or command hashes for a metrics-level ingest', () => {
      const { database, sessions } = newStore();
      sessions.replaceSession(withFingerprints('metrics'), 'metrics', 1);
      expect(rows(database, 'SELECT * FROM edit_fingerprints')).toEqual([]);
      expect(rows(database, 'SELECT command_hash FROM tool_calls WHERE command_hash IS NOT NULL')).toEqual(
        [],
      );
    });

    it('never stores source text in the fingerprint or command-hash columns', () => {
      const { database, sessions } = newStore();
      const session = withFingerprints('summaries');
      sessions.replaceSession(session, 'summaries', 1);
      const dump = JSON.stringify([
        rows(database, 'SELECT * FROM edit_fingerprints'),
        rows(database, 'SELECT command_hash FROM tool_calls'),
      ]);
      expect(dump).not.toContain(SECRET);
    });

    it('removes live observations of purged sessions', () => {
      const { database, sessions } = newStore();
      const session = fixture();
      sessions.replaceSession(session, 'full', 1);
      const observations = new ObservationStore(database);
      observations.saveSurvivalCheck({
        sessionId: session.id,
        turnIdx: 1,
        path: '/repo/a.ts',
        checkKind: '1h',
        checkedAt: 1,
        present: 1,
        total: 1,
      });
      sessions.purgeBefore(daysAgo(localDay(session.startedAt), -1));
      expect(rows(database, 'SELECT * FROM survival_checks')).toEqual([]);
    });
  });
});
