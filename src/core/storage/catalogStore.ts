import type { CatalogModel } from '../debuglog/parseModels';
import type { Database } from './database';

// Columns that follow "newest catalog wins".
const FIELDS = [
  ['name', 'name'],
  ['vendor', 'vendor'],
  ['family', 'family'],
  ['picker_category', 'pickerCategory'],
  ['price_category', 'priceCategory'],
  ['max_context_tokens', 'maxContextTokens'],
  ['max_output_tokens', 'maxOutputTokens'],
  ['input_price', 'inputPrice'],
  ['output_price', 'outputPrice'],
  ['cache_read_price', 'cacheReadPrice'],
  ['price_batch_size', 'priceBatchSize'],
] as const;

export class CatalogStore {
  constructor(private readonly database: Database) {}

  /** `seenAt` is the catalog file's mtime, so read order does not matter: the newest catalog wins. */
  upsertAll(models: readonly CatalogModel[], seenAt: number): void {
    const columns = FIELDS.map(([column]) => column);
    const update = FIELDS.map(
      ([column]) =>
        `${column} = CASE WHEN excluded.last_seen >= models.last_seen THEN excluded.${column} ELSE models.${column} END`,
    ).join(', ');
    const statement = this.database.db.prepare(
      `INSERT INTO models (id, ${columns.join(', ')}, first_seen, last_seen)
       VALUES (:id, ${FIELDS.map(([, key]) => `:${key}`).join(', ')}, :seenAt, :seenAt)
       ON CONFLICT(id) DO UPDATE SET ${update},
         first_seen = min(models.first_seen, excluded.first_seen), last_seen = max(models.last_seen, excluded.last_seen)`,
    );
    this.database.transaction(() => {
      for (const model of models) statement.run({ ...model, seenAt });
    });
  }

  /** Lower-cased model id → the catalog's own tier fields. */
  tiers(): Map<string, { pickerCategory: string | null; priceCategory: string | null }> {
    const rows = this.database.db
      .prepare('SELECT id, picker_category, price_category FROM models')
      .all() as unknown as { id: string; picker_category: string | null; price_category: string | null }[];
    return new Map(
      rows.map((row) => [
        row.id.toLowerCase(),
        { pickerCategory: row.picker_category, priceCategory: row.price_category },
      ]),
    );
  }

  stats(): { models: number; lastSeenAt: number | null } {
    const row = this.database.db
      .prepare('SELECT count(*) AS models, max(last_seen) AS last FROM models')
      .get() as unknown as { models: number; last: number | null };
    return { models: row.models, lastSeenAt: row.last };
  }
}
