import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isProcessAlive, WriterLock } from './writerLock';

const newDir = () => mkdtempSync(join(tmpdir(), 'ci-lock-'));

describe('WriterLock', () => {
  it('lets exactly one owner hold the lock and hands it over on release', () => {
    const dir = newDir();
    const a = new WriterLock(dir);
    const b = new WriterLock(dir);
    expect(a.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
    expect(a.tryAcquire()).toBe(true);
    a.release();
    expect(b.tryAcquire()).toBe(true);
    expect(a.tryAcquire()).toBe(false);
  });

  it('takes over a lock whose heartbeat is stale', () => {
    const dir = newDir();
    let now = 0;
    const a = new WriterLock(dir, { now: () => now, staleMs: 1000 });
    const b = new WriterLock(dir, { now: () => now, staleMs: 1000 });
    expect(a.tryAcquire()).toBe(true);
    now = 2000;
    expect(b.tryAcquire()).toBe(true);
    expect(a.tryAcquire()).toBe(false);
  });

  it('takes over a lock whose owning process is gone', () => {
    const dir = newDir();
    expect(new WriterLock(dir, { pid: 999_999 }).tryAcquire()).toBe(true);
    expect(new WriterLock(dir, { isAlive: () => false }).tryAcquire()).toBe(true);
  });

  it('ignores a corrupt lock file', () => {
    const dir = newDir();
    writeFileSync(join(dir, 'scanner.lock'), 'garbage');
    expect(new WriterLock(dir).tryAcquire()).toBe(true);
  });

  it('detects live processes', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(-1)).toBe(false);
  });
});
