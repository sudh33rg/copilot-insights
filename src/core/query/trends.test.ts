import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { localDay } from '../time';
import { getOverview } from './overview';
import { assertRange, getRangeBreakdown, getTrends } from './trends';

const AUTO_START = 1790000001000;
const BYOK_START = 1790100000000;

describe('getTrends', () => {
  it('returns one row per day ending at the given day, oldest first', () => {
    const { database } = seededStore();
    const days = getTrends(database, localDay(AUTO_START), 7);
    expect(days).toHaveLength(7);
    expect(days[6]?.day).toBe(localDay(AUTO_START));
    expect(days.map((row) => row.day)).toEqual([...days.map((row) => row.day)].sort());
  });

  it('carries the exact totals of a day that had usage', () => {
    const { database } = seededStore();
    const last = getTrends(database, localDay(AUTO_START), 3).at(-1);
    expect(last).toMatchObject({ sessions: 1, turns: 2 });
    expect(last?.inputTokens).toEqual({
      value: 54_000,
      provenance: { kind: 'exact', source: 'chatSessions.promptTokens' },
    });
    expect(last?.credits.value).toBeCloseTo(1.626141);
  });

  it('includes days without usage, with unavailable values rather than zeros', () => {
    const { database } = seededStore();
    const first = getTrends(database, localDay(AUTO_START), 3)[0];
    expect(first).toMatchObject({ sessions: 0, turns: 0 });
    expect(first?.inputTokens.value).toBeNull();
    expect(first?.inputTokens.provenance.kind).toBe('unavailable');
    expect(first?.credits.value).toBeNull();
  });

  it('counts calendar days across a leap-year boundary', () => {
    const { database } = seededStore();
    expect(getTrends(database, '2028-03-01', 3).map((row) => row.day)).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(getTrends(database, '2027-03-01', 2).map((row) => row.day)).toEqual(['2027-02-28', '2027-03-01']);
  });

  it('covers a single day', () => {
    const { database } = seededStore();
    expect(getTrends(database, localDay(BYOK_START), 1)).toHaveLength(1);
  });
});

describe('getRangeBreakdown', () => {
  it('matches the Overview breakdown for the same range', () => {
    const { database } = seededStore();
    const today = localDay(BYOK_START);
    const from = `${today.slice(0, 8)}01`;
    const overview = getOverview(database, today);
    const range = getRangeBreakdown(database, from, today);
    expect(range.byModel).toEqual(overview.byModel);
    expect(range.byWorkspace).toEqual(overview.byWorkspace);
  });

  it('is empty for a range with no usage', () => {
    const { database } = seededStore();
    expect(getRangeBreakdown(database, '2020-01-01', '2020-01-31')).toEqual({ byModel: [], byWorkspace: [] });
  });
});

describe('assertRange', () => {
  it('accepts an ordered range of up to 366 days', () => {
    expect(() => {
      assertRange('2026-01-01', '2026-01-01');
    }).not.toThrow();
    expect(() => {
      assertRange('2025-01-01', '2026-01-01');
    }).not.toThrow(); // 366 days inclusive
  });
  it('rejects a reversed range and a range over 366 days', () => {
    expect(() => {
      assertRange('2026-02-02', '2026-02-01');
    }).toThrow('The start day must not be after the end day.');
    expect(() => {
      assertRange('2024-01-01', '2026-01-01');
    }).toThrow('Choose a range of at most 366 days.');
  });
});
