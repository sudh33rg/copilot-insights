import { describe, expect, it } from 'vitest';
import { seededStore } from '../../../test/fixtures/sessions';
import { ObservationStore, type SnapshotInput } from '../storage/observationStore';
import { getSessionOutcomes } from './sessionOutcomes';

const snapshot = (overrides: Partial<SnapshotInput>): SnapshotInput => ({
  sessionId: 'fx-auto-1',
  kind: 'start',
  repoRoot: '/repo',
  head: 'h1',
  takenAt: 10,
  files: [],
  ...overrides,
});

describe('getSessionOutcomes — lines changed', () => {
  it('is unavailable when VS Code never observed the session', () => {
    const { database } = seededStore();
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    expect(outcomes.linesAdded).toEqual({
      value: null,
      provenance: {
        kind: 'unavailable',
        source: 'no git snapshot: VS Code was not observing this session',
      },
    });
    expect(outcomes.linesRemoved.value).toBeNull();
  });

  it('derives growth of the working-tree diff between the first and latest observation', () => {
    const { database } = seededStore();
    const observations = new ObservationStore(database);
    observations.saveSnapshot(snapshot({ files: [{ path: '/repo/a.ts', added: 2, removed: 1 }] }));
    observations.saveSnapshot(
      snapshot({ kind: 'latest', takenAt: 20, files: [{ path: '/repo/a.ts', added: 9, removed: 3 }] }),
    );
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    expect(outcomes.linesAdded.value).toBe(7);
    expect(outcomes.linesRemoved.value).toBe(2);
    expect(outcomes.linesAdded.provenance.kind).toBe('derived');
    expect(outcomes.linesAdded.provenance.source).toContain('tracked files only');
  });

  it('is unavailable, not zero, when HEAD moved during the session', () => {
    const { database } = seededStore();
    const observations = new ObservationStore(database);
    observations.saveSnapshot(snapshot({}));
    observations.saveSnapshot(snapshot({ kind: 'latest', head: 'h2', takenAt: 20 }));
    const outcomes = getSessionOutcomes(database, 'fx-auto-1');
    expect(outcomes.linesAdded).toEqual({
      value: null,
      provenance: {
        kind: 'unavailable',
        source: 'HEAD changed during the session; see linked commits',
      },
    });
  });

  it('is unavailable when only the baseline exists', () => {
    const { database } = seededStore();
    new ObservationStore(database).saveSnapshot(snapshot({}));
    expect(getSessionOutcomes(database, 'fx-auto-1').linesAdded.value).toBeNull();
  });
});

describe('getSessionOutcomes — edit outcomes and survival', () => {
  function withEvents(events: [number, string, string][]) {
    const { database } = seededStore();
    database.db.exec('DELETE FROM file_events');
    const insert = database.db.prepare(
      "INSERT INTO file_events (session_id, turn_idx, seq, path, action, source) VALUES ('fx-auto-1', :i, :q, :p, :a, 't')",
    );
    events.forEach(([i, p, a], q) => insert.run({ i, q, p, a }));
    return database;
  }

  it('is unavailable, not zero, when Copilot reported no keep/undo events', () => {
    const outcomes = getSessionOutcomes(withEvents([[1, '/r/a.ts', 'edited']]), 'fx-auto-1');
    for (const measured of [
      outcomes.editsKept,
      outcomes.editsUndone,
      outcomes.editsUserModified,
      outcomes.editKeepRate,
    ]) {
      expect(measured.value).toBeNull();
      expect(measured.provenance).toEqual({
        kind: 'unavailable',
        source: 'Copilot reported no keep/undo events for this session',
      });
    }
  });

  it('counts Copilot’s keep/undo/user-modified events exactly and derives the keep rate', () => {
    const outcomes = getSessionOutcomes(
      withEvents([
        [1, '/r/a.ts', 'edited'],
        [1, '/r/b.ts', 'edited'],
        [1, '/r/c.ts', 'edited'],
        [2, '/r/a.ts', 'kept'],
        [2, '/r/b.ts', 'undone'],
        [2, '/r/c.ts', 'user-modified'],
      ]),
      'fx-auto-1',
    );
    expect(outcomes.editsKept).toEqual({
      value: 1,
      provenance: { kind: 'exact', source: 'chatSessions.editedFileEvents' },
    });
    expect(outcomes.editsUndone.value).toBe(1);
    expect(outcomes.editsUserModified.value).toBe(1);
    expect(outcomes.editKeepRate.value).toBeCloseTo(1 / 3);
    expect(outcomes.editKeepRate.provenance.kind).toBe('derived');
  });

  it('reports later survival from the latest check of each edit, or unavailable without checks', () => {
    const database = withEvents([]);
    expect(getSessionOutcomes(database, 'fx-auto-1').laterSurvival.provenance.kind).toBe('unavailable');
    const observations = new ObservationStore(database);
    const base = { sessionId: 'fx-auto-1', turnIdx: 1, total: 4 };
    observations.saveSurvivalCheck({ ...base, path: '/r/a.ts', checkKind: '1h', checkedAt: 1, present: 4 });
    observations.saveSurvivalCheck({ ...base, path: '/r/a.ts', checkKind: '1d', checkedAt: 2, present: 2 });
    observations.saveSurvivalCheck({ ...base, path: '/r/b.ts', checkKind: '1h', checkedAt: 1, present: 2 });
    const { laterSurvival } = getSessionOutcomes(database, 'fx-auto-1');
    expect(laterSurvival.value).toBe(0.5);
    expect(laterSurvival.provenance).toEqual({
      kind: 'derived',
      source: 'fingerprints of inserted lines still present at the latest check',
    });
  });
});
