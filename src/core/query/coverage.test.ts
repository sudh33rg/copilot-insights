import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { localDay } from '../time';
import { getCoverage } from './coverage';

const AUTO_DAY = localDay(1790000001000); // local exact credits that day: 1.126141 + 0.5 = 1.626141
const NO_TURNS_DAY = '2026-01-01';

describe('getCoverage', () => {
  it('reports coverage and the unexplained remainder as derived from exact local credits', () => {
    const [day] = getCoverage(seededStore().database, [{ day: AUTO_DAY, credits: 2 }]);
    expect(day?.billed).toMatchObject({ value: 2, provenance: { kind: 'exact' } });
    expect(day?.local).toMatchObject({ provenance: { kind: 'exact' } });
    expect(day?.local.value).toBeCloseTo(1.626141);
    expect(day?.coverage.value).toBeCloseTo(0.8130705);
    expect(day?.coverage.provenance.kind).toBe('derived');
    expect(day?.unexplained.value).toBeCloseTo(0.373859);
    expect(day?.unexplained.provenance.kind).toBe('derived');
  });

  it('treats a day with billed credits but no local turns as fully unexplained, never dividing by zero', () => {
    const [day] = getCoverage(seededStore().database, [{ day: NO_TURNS_DAY, credits: 3 }]);
    expect(day?.local.provenance.kind).toBe('unavailable');
    expect(day?.coverage.value).toBe(0);
    expect(day?.unexplained.value).toBe(3);
  });

  it('has no coverage when GitHub billed nothing', () => {
    const [day] = getCoverage(seededStore().database, [{ day: AUTO_DAY, credits: 0 }]);
    expect(day?.coverage.value).toBeNull();
    expect(day?.coverage.provenance.kind).toBe('unavailable');
    expect(day?.unexplained.value).toBe(0);
  });

  it('never reports a negative remainder when local credits exceed billed credits', () => {
    const [day] = getCoverage(seededStore().database, [{ day: AUTO_DAY, credits: 1 }]);
    expect(day?.coverage.value).toBeCloseTo(1.626141);
    expect(day?.unexplained.value).toBe(0);
    expect(day?.coverage.provenance.source).toContain('local credits exceed GitHub billed credits');
  });

  it('calls the remainder an upper bound when local credits are only a lower bound', () => {
    const { database } = seededStore();
    database.db.exec("UPDATE turns SET credits = NULL WHERE session_id = 'fx-auto-1' AND idx = 2");
    const [day] = getCoverage(database, [{ day: AUTO_DAY, credits: 2 }]);
    expect(day?.local.provenance.kind).toBe('derived');
    expect(day?.unexplained.provenance.source).toContain('upper bound');
  });

  it('returns rows in the order given and nothing for no days', () => {
    expect(getCoverage(seededStore().database, [])).toEqual([]);
  });
});
