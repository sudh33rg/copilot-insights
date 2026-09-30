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
