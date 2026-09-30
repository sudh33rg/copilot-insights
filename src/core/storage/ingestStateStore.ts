import type { TombstoneKind } from '../ingest/types';
import type { Database } from './database';

export class IngestStateStore {
  constructor(private readonly database: Database) {}

  getFingerprints(): Record<string, string> {
    const rows = this.database.db.prepare('SELECT file, fingerprint FROM scan_state').all() as unknown as {
      file: string;
      fingerprint: string;
    }[];
    return Object.fromEntries(rows.map((row) => [row.file, row.fingerprint]));
  }

  setFingerprint(file: string, fingerprint: string, sessionId: string | null, scannedAt: number): void {
    this.database.db
      .prepare(
        `INSERT INTO scan_state (file, fingerprint, session_id, scanned_at) VALUES (:file, :fingerprint, :sessionId, :scannedAt)
         ON CONFLICT(file) DO UPDATE SET fingerprint = excluded.fingerprint, session_id = excluded.session_id, scanned_at = excluded.scanned_at`,
      )
      .run({ file, fingerprint, sessionId, scannedAt });
  }

  /** A 'deleted' tombstone always wins over 'content-cleared'. */
  addTombstones(ids: readonly string[], kind: TombstoneKind, createdAt: number): void {
    const statement = this.database.db.prepare(
      `INSERT INTO tombstones (session_id, kind, created_at) VALUES (:id, :kind, :createdAt)
       ON CONFLICT(session_id) DO UPDATE SET
         kind = CASE WHEN tombstones.kind = 'deleted' THEN 'deleted' ELSE excluded.kind END,
         created_at = excluded.created_at`,
    );
    this.database.transaction(() => {
      for (const id of ids) statement.run({ id, kind, createdAt });
    });
  }

  getTombstones(): Record<string, TombstoneKind> {
    const rows = this.database.db.prepare('SELECT session_id, kind FROM tombstones').all() as unknown as {
      session_id: string;
      kind: TombstoneKind;
    }[];
    return Object.fromEntries(rows.map((row) => [row.session_id, row.kind]));
  }

  getMeta(key: string): string | null {
    const row = this.database.db.prepare('SELECT value FROM meta WHERE key = :key').get({ key }) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  /** Stores `value` only if `key` has none yet and returns whichever value is now stored. */
  setMetaIfAbsent(key: string, value: string): string {
    this.database.db
      .prepare('INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO NOTHING')
      .run({ key, value });
    return this.getMeta(key) ?? value;
  }

  deleteMeta(key: string): void {
    this.database.db.prepare('DELETE FROM meta WHERE key = :key').run({ key });
  }

  setMeta(key: string, value: string): void {
    this.database.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run({ key, value });
  }
}
