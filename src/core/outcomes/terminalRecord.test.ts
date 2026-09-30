import { describe, expect, it } from 'vitest';
import { Database } from '../storage/database';
import { ObservationStore } from '../storage/observationStore';
import { commandHash } from '../privacy/fingerprint';
import { recordTerminalRun } from './terminalRecord';

const SECRET = 'SECRET-do-not-store-me';
const finished = { startedAt: 1000, endedAt: 2000, exitCode: 1 };

function setup() {
  const database = new Database(':memory:');
  return { database, store: new ObservationStore(database) };
}

describe('recordTerminalRun', () => {
  it('stores kind, exit code, timing and a salted hash of the command', () => {
    const { store } = setup();
    expect(recordTerminalRun(store, 'salt', 'summaries', { command: 'pnpm test', ...finished })).toBe(true);
    expect(store.terminalRunsBetween(0, 5000)).toEqual([
      {
        startedAt: 1000,
        endedAt: 2000,
        exitCode: 1,
        kind: 'test',
        commandHash: commandHash('salt', 'pnpm test'),
      },
    ]);
  });

  it('keeps a missing exit code (no shell integration) as null', () => {
    const { store } = setup();
    recordTerminalRun(store, 'salt', 'full', { command: 'ls', ...finished, exitCode: null });
    expect(store.terminalRunsBetween(0, 5000)[0]?.exitCode).toBeNull();
  });

  it('stores no command-derived hash at capture level metrics', () => {
    const { store } = setup();
    recordTerminalRun(store, 'salt', 'metrics', { command: 'pnpm test', ...finished });
    expect(store.terminalRunsBetween(0, 5000)).toEqual([
      { startedAt: 1000, endedAt: 2000, exitCode: 1, kind: 'other', commandHash: '' },
    ]);
  });

  it('ignores an empty command', () => {
    const { store } = setup();
    expect(recordTerminalRun(store, 'salt', 'full', { command: '   ', ...finished })).toBe(false);
    expect(store.terminalRunsBetween(0, 5000)).toEqual([]);
  });

  it('never stores the command text or its secrets', () => {
    const { store, database } = setup();
    recordTerminalRun(store, 'salt', 'full', {
      command: `GITHUB_TOKEN=ghp_${'a'.repeat(36)} ${SECRET} pnpm test`,
      ...finished,
    });
    const dump = JSON.stringify(database.db.prepare('SELECT * FROM terminal_runs').all());
    expect(dump).not.toContain('SECRET');
    expect(dump).not.toContain('ghp_');
  });
});
