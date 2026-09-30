import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from './database';
import { MIGRATIONS } from './migrations';

const userVersion = (database: Database): number =>
  (database.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('Database', () => {
  it('migrates once and records the schema version', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ci-db-')), 'insights.db');
    const first = new Database(file);
    expect(userVersion(first)).toBe(MIGRATIONS.length);
    first.close();
    const reopened = new Database(file);
    expect(userVersion(reopened)).toBe(MIGRATIONS.length);
    reopened.close();
  });

  it('enables foreign keys', () => {
    const database = new Database(':memory:');
    expect((database.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(
      1,
    );
  });

  it('rolls back a failed transaction and supports nesting', () => {
    const database = new Database(':memory:');
    expect(() => {
      database.transaction(() => {
        database.db.prepare("INSERT INTO meta (key, value) VALUES ('a', '1')").run();
        database.transaction(() =>
          database.db.prepare("INSERT INTO meta (key, value) VALUES ('b', '2')").run(),
        );
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(database.db.prepare('SELECT count(*) AS n FROM meta').get()).toEqual({ n: 0 });
  });
});
