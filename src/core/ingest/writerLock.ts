import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from '../json';

interface LockRecord {
  owner: string;
  pid: number;
  heartbeatAt: number;
}

export interface WriterLockOptions {
  /** A lock whose heartbeat is older than this is considered abandoned. Default 30 minutes. */
  staleMs?: number;
  pid?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

/**
 * Every VS Code window runs its own extension host. Only the window holding this lock scans and writes;
 * the others read the shared database. Calling tryAcquire() again while holding the lock refreshes the heartbeat.
 */
export class WriterLock {
  readonly file: string;
  private readonly owner = randomUUID();
  private readonly staleMs: number;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly isAlive: (pid: number) => boolean;

  constructor(dir: string, options: WriterLockOptions = {}) {
    this.file = join(dir, 'scanner.lock');
    this.staleMs = options.staleMs ?? 30 * 60_000;
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.isAlive = options.isAlive ?? isProcessAlive;
  }

  tryAcquire(): boolean {
    const current = this.read();
    if (current !== null && current.owner !== this.owner) {
      const abandoned = this.now() - current.heartbeatAt > this.staleMs || !this.isAlive(current.pid);
      if (!abandoned) return false;
    }
    this.write();
    return this.read()?.owner === this.owner;
  }

  release(): void {
    if (this.read()?.owner !== this.owner) return;
    try {
      unlinkSync(this.file);
    } catch {
      // Already removed.
    }
  }

  private read(): LockRecord | null {
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      return isRecord(value) &&
        typeof value.owner === 'string' &&
        typeof value.pid === 'number' &&
        typeof value.heartbeatAt === 'number'
        ? { owner: value.owner, pid: value.pid, heartbeatAt: value.heartbeatAt }
        : null;
    } catch {
      return null;
    }
  }

  private write(): void {
    const record: LockRecord = { owner: this.owner, pid: this.pid, heartbeatAt: this.now() };
    const temporary = `${this.file}.${this.owner}.tmp`;
    writeFileSync(temporary, JSON.stringify(record));
    renameSync(temporary, this.file);
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
