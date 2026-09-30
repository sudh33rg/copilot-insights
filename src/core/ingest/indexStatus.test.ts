import { describe, expect, it } from 'vitest';
import { Database } from '../storage/database';
import { IngestStateStore } from '../storage/ingestStateStore';
import { SessionStore } from '../storage/sessionStore';
import { indexStatus } from './indexStatus';
import { META } from './ingestService';

describe('indexStatus', () => {
  it('reports counts, last sync and role', () => {
    const database = new Database(':memory:');
    const state = new IngestStateStore(database);
    const sessions = new SessionStore(database);
    expect(indexStatus({ lastResult: null, lastError: null }, sessions, state, 'summaries')).toEqual({
      sessions: 0,
      turns: 0,
      lastSyncAt: null,
      role: 'idle',
      lastError: null,
      captureLevel: 'summaries',
    });
    state.setMeta(META.lastSyncAt, '1790000000000');
    expect(
      indexStatus({ lastResult: { role: 'follower' }, lastError: 'boom' }, sessions, state, 'metrics'),
    ).toMatchObject({
      lastSyncAt: 1790000000000,
      role: 'follower',
      lastError: 'boom',
      captureLevel: 'metrics',
    });
  });
});
