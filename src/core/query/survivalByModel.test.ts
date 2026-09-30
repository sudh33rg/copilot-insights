import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { ObservationStore } from '../storage/observationStore';
import { getSurvivalByModel } from './survivalByModel';

function seed() {
  const { database } = seededStore();
  const { db } = database;
  db.exec('DELETE FROM file_events');
  db.exec('UPDATE turns SET resolved_model = NULL, requested_model = NULL');
  const model = db.prepare('UPDATE turns SET resolved_model = :m WHERE session_id = :s AND idx = :i');
  model.run({ m: 'm-a', s: 'fx-auto-1', i: 1 });
  model.run({ m: 'm-b', s: 'fx-auto-1', i: 2 });
  model.run({ m: 'm-b', s: 'fx-byok-1', i: 1 });
  model.run({ m: 'm-b', s: 'fx-byok-1', i: 2 });
  const event = db.prepare(
    'INSERT INTO file_events (session_id, turn_idx, seq, path, action, source) VALUES (:s, :i, :q, :p, :a, :src)',
  );
  let seq = 0;
  const add = (s: string, i: number, p: string, a: string) =>
    event.run({ s, i, q: seq++, p, a, src: 'test' });
  add('fx-auto-1', 1, '/r/a.ts', 'edited');
  add('fx-auto-1', 1, '/r/b.ts', 'edited');
  add('fx-auto-1', 2, '/r/a.ts', 'kept');
  add('fx-auto-1', 2, '/r/b.ts', 'undone');
  add('fx-byok-1', 1, '/r/c.ts', 'edited');
  add('fx-byok-1', 2, '/r/c.ts', 'kept');
  return database;
}

describe('getSurvivalByModel', () => {
  it('attributes keep/undo events to the model that made the edit', () => {
    const rows = getSurvivalByModel(seed());
    const a = rows.find((row) => row.model === 'm-a');
    const b = rows.find((row) => row.model === 'm-b');
    expect(a?.edits).toBe(2);
    expect(a?.keepRate).toEqual({
      value: 0.5,
      provenance: {
        kind: 'derived',
        source: 'Copilot editedFileEvents, attributed to the model that made the edit',
      },
    });
    expect(b?.edits).toBe(1);
    expect(b?.keepRate.value).toBe(1);
  });

  it('reports later survival from each edit’s latest check, and unavailable when none exists', () => {
    const database = seed();
    const observations = new ObservationStore(database);
    const check = { sessionId: 'fx-auto-1', turnIdx: 1, path: '/r/a.ts', total: 2 };
    observations.saveSurvivalCheck({ ...check, checkKind: '1h', checkedAt: 1, present: 2 });
    observations.saveSurvivalCheck({ ...check, checkKind: '1d', checkedAt: 2, present: 1 });
    observations.saveSurvivalCheck({ ...check, path: '/r/b.ts', checkKind: '1h', checkedAt: 1, present: 0 });
    const rows = getSurvivalByModel(database);
    const a = rows.find((row) => row.model === 'm-a');
    expect(a?.laterSurvival.value).toBe(0.25);
    expect(a?.laterSurvival.provenance).toEqual({
      kind: 'derived',
      source: 'fingerprints of inserted lines still present at the latest check',
    });
    expect(a?.sampleSize).toBe(2);
    const b = rows.find((row) => row.model === 'm-b');
    expect(b?.laterSurvival.value).toBeNull();
    expect(b?.laterSurvival.provenance.kind).toBe('unavailable');
    expect(b?.sampleSize).toBe(0);
  });

  it('has no row for models whose sessions produced no outcome events', () => {
    const database = seed();
    database.db.exec("DELETE FROM file_events WHERE action IN ('kept', 'undone')");
    expect(getSurvivalByModel(database)).toEqual([]);
  });
});
