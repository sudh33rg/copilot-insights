import type { ModelPrice } from '../efficiency/priceCounterfactual';
import type { Database } from '../storage/database';

/** Catalog list prices; models without a full price (BYOK, local) are not included. */
export function readModelPrices(database: Pick<Database, 'db'>): ModelPrice[] {
  const rows = database.db
    .prepare(
      `SELECT id, name, input_price, output_price, cache_read_price, price_batch_size FROM models
        WHERE input_price IS NOT NULL AND output_price IS NOT NULL AND price_batch_size IS NOT NULL`,
    )
    .all() as unknown as {
    id: string;
    name: string | null;
    input_price: number;
    output_price: number;
    cache_read_price: number | null;
    price_batch_size: number;
  }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    cacheReadPrice: row.cache_read_price,
    batchSize: row.price_batch_size,
  }));
}
