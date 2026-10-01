import { describe, expect, it } from 'vitest';
import { loadFixtureSession, seededStore } from '../../../test/fixtures/sessions';
import { ObservationStore } from '../storage/observationStore';
import { SessionFactsStore } from './sessionFactsStore';

describe('SessionFactsStore', () => {
  it('rebuilds after content is cleared even if the latest observation timestamp is unchanged', () => {
    const { database, sessions } = seededStore();
    new ObservationStore(database).touchSession('fx-byok-1', 999999);
    const store = new SessionFactsStore(database);
    expect(store.all().find((fact) => fact.id === 'fx-auto-1')?.opening).not.toBeNull();
    sessions.clearContent(['fx-auto-1']);
    expect(store.all().find((fact) => fact.id === 'fx-auto-1')?.opening).toBeNull();
  });

  it('collects facts for every session, task types included', () => {
    const { database } = seededStore();
    const facts = new SessionFactsStore(database).all();
    expect(facts.map((fact) => fact.id).sort()).toEqual(['fx-auto-1', 'fx-byok-1']);
    expect(facts.find((fact) => fact.id === 'fx-auto-1')?.taskType).toBe('bugfix');
    expect(facts.find((fact) => fact.id === 'fx-byok-1')?.host).toBe('byok');
  });

  it('serves the cached array while the data has not changed', () => {
    const { database } = seededStore();
    const store = new SessionFactsStore(database);
    expect(store.all()).toBe(store.all());
  });

  it('rebuilds after a session is re-ingested', () => {
    const { database, sessions } = seededStore();
    const store = new SessionFactsStore(database);
    const before = store.all();
    sessions.replaceSession(loadFixtureSession('auto-agent-session.jsonl', 'alpha'), 'full', 999);
    expect(store.all()).not.toBe(before);
  });

  it('rebuilds after a live observation of a session, and after a session is deleted', () => {
    const { database, sessions } = seededStore();
    const store = new SessionFactsStore(database);
    const first = store.all();
    new ObservationStore(database).touchSession('fx-auto-1', 5_000);
    const second = store.all();
    expect(second).not.toBe(first);
    sessions.deleteSessions(['fx-byok-1']);
    expect(store.all().map((fact) => fact.id)).toEqual(['fx-auto-1']);
  });

  it('is empty for an empty index', () => {
    const { database } = seededStore();
    database.db.exec('DELETE FROM sessions');
    expect(new SessionFactsStore(database).all()).toEqual([]);
  });
});
