import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { localDay } from '../time';
import { getInternalUsage } from './internalUsage';

const CALL_DAY = localDay(1790000002000);

describe('getInternalUsage', () => {
  it('totals utility calls as a derived lower bound and lists calls by debugName', () => {
    const usage = getInternalUsage(seededStore().database, CALL_DAY, CALL_DAY);
    expect(usage.sessionsWithLogs).toBe(1);
    expect(usage.calls).toBe(1);
    expect(usage.inputTokens.value).toBe(300);
    expect(usage.inputTokens.provenance.kind).toBe('derived');
    expect(usage.inputTokens.provenance.source).toContain('only sessions with agent debug logging');
    expect(usage.outputTokens.value).toBe(12);
    expect(usage.nanoAiu.value).toBe(2000000);
  });

  it('lists every role by name so unclassified names are visible', () => {
    const usage = getInternalUsage(seededStore().database, CALL_DAY, CALL_DAY);
    expect(usage.byName.map((row) => [row.name, row.role, row.calls])).toEqual([
      ['panel/editAgent', 'USER_FACING', 2],
      ['mystery-thing', 'UNKNOWN', 1],
      ['title', 'COPILOT_INTERNAL', 1],
    ]);
  });

  it('is unavailable, not zero, when no debug log exists or nothing falls in the period', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM llm_calls; DELETE FROM debug_sessions');
    const none = getInternalUsage(database, CALL_DAY, CALL_DAY);
    expect(none.sessionsWithLogs).toBe(0);
    expect(none.inputTokens.provenance.kind).toBe('unavailable');
    expect(none.byName).toEqual([]);
  });

  it('respects the day range', () => {
    const usage = getInternalUsage(seededStore().database, '2000-01-01', '2000-01-02');
    expect(usage.calls).toBe(0);
    expect(usage.byName).toEqual([]);
  });
});
