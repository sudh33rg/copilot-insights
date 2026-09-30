import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { localDay } from '../time';
import { getOverview } from './overview';

const BYOK_START = 1790100000000;
const AUTO_START = 1790000001000;

describe('getOverview', () => {
  it('buckets today by the local day of each turn', () => {
    const { database } = seededStore();
    const overview = getOverview(database, localDay(AUTO_START));
    expect(overview.today).toMatchObject({
      from: localDay(AUTO_START),
      to: localDay(AUTO_START),
      sessions: 1,
      turns: 2,
    });
    expect(overview.today.inputTokens).toEqual({
      value: 54000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(overview.today.outputTokens.value).toBe(2600);
    expect(overview.today.credits.value).toBeCloseTo(1.626141);
    expect(overview.today.credits.provenance.kind).toBe('exact');
  });

  it('sums the month, keeping partial data derived and BYOK out of the credit expectation', () => {
    const { database } = seededStore();
    const today = localDay(BYOK_START);
    const overview = getOverview(database, today);
    expect(overview.month.from).toBe(`${today.slice(0, 8)}01`);
    expect(overview.month).toMatchObject({ sessions: 2, turns: 4 });
    expect(overview.month.inputTokens.value).toBe(59000);
    expect(overview.month.inputTokens.provenance.kind).toBe('derived');
    expect(overview.month.credits.value).toBeCloseTo(1.626141);
    expect(overview.month.credits.provenance.kind).toBe('exact');
  });

  it('reports the failure rate over finished, user-initiated turns as derived', () => {
    const overview = getOverview(seededStore().database, localDay(BYOK_START));
    // Finished user turns: two complete (auto) + one failed (byok); the cancelled turn is system-initiated.
    expect(overview.failureRate.value).toBeCloseTo(1 / 3);
    expect(overview.failureRate.provenance.kind).toBe('derived');
  });

  it('breaks usage down by model, workspace and host', () => {
    const overview = getOverview(seededStore().database, localDay(BYOK_START));
    expect(overview.byModel.map((row) => [row.label, row.host, row.turns])).toEqual([
      ['gpt-5.6-luna', 'copilot', 2],
      ['qwen3.5:35b', 'byok', 2],
    ]);
    expect(overview.byWorkspace.map((row) => [row.label, row.turns])).toEqual([
      ['alpha', 2],
      ['beta', 2],
    ]);
    expect(overview.hostSplit).toEqual([
      { host: 'byok', turns: 2, sessions: 1 },
      { host: 'copilot', turns: 2, sessions: 1 },
    ]);
  });

  it('is empty and unavailable, not zero, on an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    const overview = getOverview(database, '2026-09-30');
    expect(overview.today).toMatchObject({ sessions: 0, turns: 0 });
    expect(overview.today.inputTokens.value).toBeNull();
    expect(overview.failureRate.provenance.kind).toBe('unavailable');
    expect(overview.byModel).toEqual([]);
  });

  it('includes internal Copilot usage for the month from debug logs', () => {
    const overview = getOverview(seededStore().database, localDay(AUTO_START));
    expect(overview.internal.sessionsWithLogs).toBe(1);
    expect(overview.internal.calls).toBe(1);
  });

  it('adds the catalog tier to model rows, and says so when a model is not in any catalog', () => {
    const overview = getOverview(seededStore().database, localDay(BYOK_START));
    const luna = overview.byModel.find((row) => row.label === 'gpt-5.6-luna');
    expect(luna?.tier).toEqual({
      value: 'powerful',
      provenance: { kind: 'exact', source: 'models.json: model_picker_category' },
    });
    const qwen = overview.byModel.find((row) => row.label === 'qwen3.5:35b');
    expect(qwen?.tier?.value).toBeNull();
    expect(qwen?.tier?.provenance).toEqual({
      kind: 'unavailable',
      source: 'model not present in any captured models.json',
    });
    expect(overview.byWorkspace.every((row) => row.tier === null)).toBe(true);
  });
});
