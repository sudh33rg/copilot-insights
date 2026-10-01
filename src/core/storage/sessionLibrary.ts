import {
  annotationSchema,
  savedViewSchema,
  type SessionAnnotation,
  type SavedSessionView,
} from '../../shared/dto';
import { redactDeep } from '../privacy/redact';
import type { Database } from './database';

/** Annotations have no FK: ingestion replaces session rows but must preserve local notes. */
export class SessionLibrary {
  constructor(private readonly database: Pick<Database, 'db'>) {}
  get(id: string): SessionAnnotation {
    const row = this.database.db
      .prepare('SELECT bookmarked, note, tags FROM session_annotations WHERE session_id = :id')
      .get({ id }) as { bookmarked: number; note: string; tags: string } | undefined;
    return row === undefined
      ? { bookmarked: false, note: '', tags: [] }
      : annotationSchema.parse(
          redactDeep({
            bookmarked: row.bookmarked === 1,
            note: row.note,
            tags: JSON.parse(row.tags) as unknown,
          }),
        );
  }
  save(id: string, value: SessionAnnotation): SessionAnnotation {
    const exists = this.database.db.prepare('SELECT id FROM sessions WHERE id = :id').get({ id });
    if (exists === undefined) throw new Error('Session is no longer indexed');
    const annotation = annotationSchema.parse(redactDeep(value));
    this.database.db
      .prepare(
        `INSERT INTO session_annotations (session_id, bookmarked, note, tags) VALUES (:id, :bookmarked, :note, :tags)
      ON CONFLICT(session_id) DO UPDATE SET bookmarked = excluded.bookmarked, note = excluded.note, tags = excluded.tags`,
      )
      .run({
        id,
        bookmarked: annotation.bookmarked ? 1 : 0,
        note: annotation.note,
        tags: JSON.stringify(annotation.tags),
      });
    return annotation;
  }
  views(): SavedSessionView[] {
    const rows = this.database.db
      .prepare('SELECT id, label, filters FROM saved_session_views ORDER BY label')
      .all() as unknown as { id: string; label: string; filters: string }[];
    return rows.map((row) =>
      savedViewSchema.parse(redactDeep({ ...row, filters: JSON.parse(row.filters) as unknown })),
    );
  }
  saveView(value: SavedSessionView): void {
    const view = savedViewSchema.parse(redactDeep(value));
    this.database.db
      .prepare(
        'INSERT INTO saved_session_views (id, label, filters) VALUES (:id, :label, :filters) ON CONFLICT(id) DO UPDATE SET label = excluded.label, filters = excluded.filters',
      )
      .run({ ...view, filters: JSON.stringify(view.filters) });
  }
  deleteView(id: string): void {
    this.database.db.prepare('DELETE FROM saved_session_views WHERE id = :id').run({ id });
  }
}
