import { describe, expect, it } from 'vitest';
import { cloneSession, loadFixtureSession, seededStore } from '../../../test/fixtures/sessions';
import { listSessions } from './sessionList';

const page = { offset: 0, limit: 50 };

describe('listSessions', () => {
  it('returns newest first with exact totals and routing', () => {
    const { database } = seededStore();
    const { rows, total } = listSessions(database, page);
    expect(total).toBe(2);
    expect(rows.map((row) => row.id)).toEqual(['fx-byok-1', 'fx-auto-1']);
    const auto = rows[1];
    expect(auto).toMatchObject({
      workspace: 'alpha',
      title: 'Fix run timeout race',
      turns: 2,
      failedTurns: 0,
      state: 'complete',
      outcome: null,
    });
    expect(auto?.routing).toEqual({ kind: 'auto', label: 'Auto → gpt-5.6-luna' });
    expect(auto?.inputTokens).toEqual({
      value: 54000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(auto?.outputTokens.value).toBe(2600);
    expect(auto?.credits.value).toBeCloseTo(1.626141);
    expect(auto?.credits.provenance.kind).toBe('exact');
  });

  it('marks partial sums as derived and absent values as unavailable', () => {
    const { database } = seededStore();
    const byok = listSessions(database, page).rows[0];
    expect(byok).toMatchObject({
      id: 'fx-byok-1',
      workspace: 'beta',
      title: null,
      failedTurns: 1,
      state: 'cancelled',
    });
    expect(byok?.routing).toEqual({ kind: 'manual', label: 'Manual · qwen3.5:35b' });
    expect(byok?.inputTokens.value).toBe(5000);
    expect(byok?.inputTokens.provenance.kind).toBe('derived');
    expect(byok?.credits.value).toBeNull();
    expect(byok?.credits.provenance.kind).toBe('unavailable');
  });

  it('pages results and reports the total', () => {
    const { database, sessions } = seededStore();
    const base = loadFixtureSession('auto-agent-session.jsonl', 'alpha');
    for (let index = 0; index < 5; index++) {
      sessions.replaceSession(cloneSession(base, `clone-${String(index)}`, -(index + 1) * 60_000), 'full', 1);
    }
    const first = listSessions(database, { offset: 0, limit: 3 });
    const second = listSessions(database, { offset: 3, limit: 3 });
    expect(first.total).toBe(7);
    expect(first.rows).toHaveLength(3);
    expect(second.rows).toHaveLength(3);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(6);
  });

  it('searches title, workspace, prompt text and model, case-insensitively', () => {
    const { database } = seededStore();
    const ids = (q: string) => listSessions(database, { ...page, q }).rows.map((row) => row.id);
    expect(ids('TIMEOUT')).toEqual(['fx-auto-1']);
    expect(ids('alpha')).toEqual(['fx-auto-1']);
    expect(ids('retry policy')).toEqual(['fx-byok-1']);
    expect(ids('qwen')).toEqual(['fx-byok-1']);
    expect(ids('luna')).toEqual(['fx-auto-1']);
    expect(ids('nothing matches this')).toEqual([]);
  });

  it('treats LIKE wildcards, quotes and SQL fragments in the search box literally', () => {
    const { database } = seededStore();
    const total = (q: string) => listSessions(database, { ...page, q }).total;
    expect(total('%')).toBe(0);
    expect(total('_')).toBe(1); // Literal underscore matches the recorded tool names, not every session.
    expect(total("'; DROP TABLE sessions; --")).toBe(0);
    expect(total('\\')).toBe(0);
    expect(listSessions(database, page).total).toBe(2);
  });

  it('filters by failed turns, workspace and day range', () => {
    const { database } = seededStore();
    expect(listSessions(database, { ...page, failedOnly: true }).rows.map((row) => row.id)).toEqual([
      'fx-byok-1',
    ]);
    expect(listSessions(database, { ...page, workspace: 'alpha' }).rows.map((row) => row.id)).toEqual([
      'fx-auto-1',
    ]);
    const day = listSessions(database, page).rows[1]?.day ?? '';
    expect(listSessions(database, { ...page, fromDay: day, toDay: day }).rows.map((row) => row.id)).toContain(
      'fx-auto-1',
    );
    expect(listSessions(database, { ...page, toDay: '2000-01-01' }).total).toBe(0);
  });

  it('returns an empty page for an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    expect(listSessions(database, page)).toEqual({ rows: [], total: 0 });
  });
});
