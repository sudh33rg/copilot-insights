import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

/** Values node:sqlite accepts as parameters. */
export type SqlValue = null | number | bigint | string | Uint8Array;

export class Database {
  readonly db: DatabaseSync;
  private depth = 0;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    // WAL lets other windows read while the leader writes; busy_timeout rides out brief lock contention.
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;',
    );
    this.migrate();
  }

  /** Runs `fn` atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }

  private migrate(): void {
    const current = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (const [index, sql] of MIGRATIONS.entries()) {
      if (index < current) continue;
      this.transaction(() => {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${index + 1}`);
      });
    }
  }
}
