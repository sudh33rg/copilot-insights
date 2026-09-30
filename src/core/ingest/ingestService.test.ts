import { describe, expect, it } from 'vitest';
import { createFixtureUserDir } from '../../../test/fixtures/fixtures';
import type { CaptureLevel } from '../privacy/captureLevel';
import { CatalogStore } from '../storage/catalogStore';
import { Database } from '../storage/database';
import { IngestStateStore } from '../storage/ingestStateStore';
import { SessionStore } from '../storage/sessionStore';
import { IngestService, META } from './ingestService';
import { resolveStorageRoots } from './roots';
import { runScan } from './runScan';
import type { ScanInput } from './scanner';

function setup(options: { leader?: boolean; retentionDays?: number; now?: number } = {}) {
  const database = new Database(':memory:');
  const sessions = new SessionStore(database);
  const state = new IngestStateStore(database);
  const { userDir } = createFixtureUserDir();
  let changes = 0;
  const scanInputs: ScanInput[] = [];
  let captureLevel: CaptureLevel = 'full';
  const service = new IngestService({
    database,
    sessions,
    state,
    lock: { tryAcquire: () => options.leader ?? true },
    resolveRoots: () => resolveStorageRoots({ userDirs: [userDir] }),
    runScan: (input) => {
      scanInputs.push(input);
      return runScan(input);
    },
    captureLevel: () => captureLevel,
    retentionDays: () => options.retentionDays ?? 0,
    onChanged: () => {
      changes++;
    },
    log: { info: () => undefined, warn: () => undefined },
    now: () => options.now ?? 1_790_500_000_000,
  });
  return {
    database,
    service,
    sessions,
    state,
    scanInputs,
    changes: () => changes,
    setCaptureLevel: (level: CaptureLevel) => {
      captureLevel = level;
    },
  };
}

describe('IngestService', () => {
  it('indexes sessions on the first sync and notifies once', async () => {
    const { service, sessions, state, changes } = setup();
    expect(await service.sync()).toMatchObject({ role: 'leader', parsed: 2, empty: 1, purged: 0 });
    expect(sessions.counts()).toEqual({ sessions: 2, turns: 4 });
    expect(state.getMeta(META.lastSyncAt)).toBe('1790500000000');
    expect(changes()).toBe(1);
  });

  it('creates the privacy salt once and reuses it across syncs', async () => {
    const { service, state } = setup();
    expect(state.getMeta(META.salt)).toBeNull();
    await service.sync();
    const salt = state.getMeta(META.salt);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    await service.sync({ force: true });
    expect(state.getMeta(META.salt)).toBe(salt);
  });

  it('passes the stored salt to every scan', async () => {
    const { service, state, scanInputs } = setup();
    await service.sync();
    await service.sync({ force: true });
    const salt = state.getMeta(META.salt);
    expect(salt).not.toBeNull();
    expect(scanInputs.map((input) => input.salt)).toEqual([salt, salt]);
  });

  it('does nothing when files are unchanged', async () => {
    const { service, changes } = setup();
    await service.sync();
    expect(await service.sync()).toMatchObject({ role: 'leader', parsed: 0, unchanged: 3 });
    expect(changes()).toBe(1);
  });

  it('shares one in-flight sync between concurrent callers', async () => {
    const { service } = setup();
    const [first, second] = await Promise.all([service.sync(), service.sync()]);
    expect(first).toBe(second);
  });

  it('re-parses everything when forced or when the ingest version changes', async () => {
    const { service, state } = setup();
    await service.sync();
    expect(await service.sync({ force: true })).toMatchObject({ parsed: 2 });
    state.setMeta(META.ingestVersion, '0');
    expect(await service.sync()).toMatchObject({ parsed: 2 });
  });

  it('follows another window: no writes, refresh only when the shared index changes', async () => {
    const { service, state, sessions, changes } = setup({ leader: false });
    state.setMeta(META.lastChangeAt, '1');
    expect(await service.sync()).toEqual({ role: 'follower' });
    expect(changes()).toBe(1);
    await service.sync();
    expect(changes()).toBe(1);
    state.setMeta(META.lastChangeAt, '2');
    await service.sync();
    expect(changes()).toBe(2);
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });

  it('applies retention after writing', async () => {
    const { service, sessions } = setup({ retentionDays: 1, now: Date.parse('2027-01-01T12:00:00Z') });
    expect(await service.sync()).toMatchObject({ parsed: 2, purged: 2 });
    expect(sessions.counts()).toEqual({ sessions: 0, turns: 0 });
  });

  it('never re-imports a deleted session', async () => {
    const { service, sessions, state } = setup();
    await service.sync();
    state.addTombstones(['fx-auto-1'], 'deleted', 1);
    sessions.deleteSessions(['fx-auto-1']);
    expect(await service.sync({ force: true })).toMatchObject({ deleted: 1, parsed: 1 });
    expect(sessions.getSession('fx-auto-1')).toBeNull();
  });

  it('scrubs stored content when the capture level is lowered', async () => {
    const { service, sessions, setCaptureLevel } = setup();
    await service.sync();
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.userText).not.toBeNull();
    setCaptureLevel('metrics');
    await service.changeCaptureLevel('metrics');
    expect(sessions.getSession('fx-auto-1')?.turns[0]?.userText).toBeNull();
    expect(sessions.getSession('fx-auto-1')?.captureLevel).toBe('metrics');
  });

  it('stores telemetry from debug logs and keeps no conversation content', async () => {
    const { service, database } = setup();
    await service.sync();
    const calls = database.db.prepare('SELECT * FROM llm_calls').all();
    expect(calls).toHaveLength(4);
    expect(JSON.stringify(calls)).not.toContain('SECRET');
  });

  it('purges debug-log calls together with their session at the retention cutoff', async () => {
    const { service, database, sessions } = setup({ retentionDays: 1, now: 1_800_000_000_000 });
    await service.sync();
    expect(sessions.counts().sessions).toBe(0);
    expect((database.db.prepare('SELECT count(*) AS n FROM llm_calls').get() as { n: number }).n).toBe(0);
    expect((database.db.prepare('SELECT count(*) AS n FROM debug_sessions').get() as { n: number }).n).toBe(
      0,
    );
  });

  it('captures the model catalog from models.json', async () => {
    const { service, database } = setup();
    await service.sync();
    expect(new CatalogStore(database).stats().models).toBe(3);
  });
});
