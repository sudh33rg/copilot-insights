import { describe, expect, it } from 'vitest';
import { Database } from '../storage/database';
import { GithubUsageStore } from './usageStore';

describe('GithubUsageStore', () => {
  it('upserts per day and account, lists a range in order, and reports the last sync', () => {
    const store = new GithubUsageStore(new Database(':memory:'));
    expect(store.lastSyncedAt()).toBeNull();
    store.upsert('2026-09-02', 'octo', 2.5, 100);
    store.upsert('2026-09-01', 'octo', 1, 100);
    store.upsert('2026-09-02', 'octo', 3, 200);
    expect(store.list('2026-09-01', '2026-09-30')).toEqual([
      { day: '2026-09-01', credits: 1 },
      { day: '2026-09-02', credits: 3 },
    ]);
    expect(store.list('2026-09-02', '2026-09-02')).toHaveLength(1);
    expect(store.lastSyncedAt()).toBe(200);
    expect(store.account()).toBe('octo');
  });
});
