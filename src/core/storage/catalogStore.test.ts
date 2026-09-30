import { describe, expect, it } from 'vitest';
import type { CatalogModel } from '../debuglog/parseModels';
import { CatalogStore } from './catalogStore';
import { Database } from './database';

const model = (overrides: Partial<CatalogModel> = {}): CatalogModel => ({
  id: 'gpt-5.6-luna',
  name: 'GPT-5.6 Luna',
  vendor: 'OpenAI',
  family: 'gpt-5.6',
  pickerCategory: 'powerful',
  priceCategory: 'high',
  maxContextTokens: 400000,
  maxOutputTokens: 128000,
  inputPrice: 5,
  outputPrice: 30,
  cacheReadPrice: 0.5,
  priceBatchSize: 1000000,
  ...overrides,
});

describe('CatalogStore', () => {
  it('stores models and exposes tiers by lower-cased id', () => {
    const store = new CatalogStore(new Database(':memory:'));
    store.upsertAll([model(), model({ id: 'Weird-ID', pickerCategory: null })], 100);
    expect(store.tiers().get('gpt-5.6-luna')).toEqual({ pickerCategory: 'powerful', priceCategory: 'high' });
    expect(store.tiers().get('weird-id')).toEqual({ pickerCategory: null, priceCategory: 'high' });
    expect(store.stats()).toEqual({ models: 2, lastSeenAt: 100 });
  });

  it('lets the newest catalog win regardless of the order files are read in', () => {
    const store = new CatalogStore(new Database(':memory:'));
    store.upsertAll([model({ inputPrice: 7, pickerCategory: 'new' })], 200);
    store.upsertAll([model({ inputPrice: 5, pickerCategory: 'old' })], 100);
    expect(store.tiers().get('gpt-5.6-luna')?.pickerCategory).toBe('new');
    expect(store.stats().lastSeenAt).toBe(200);
  });

  it('reports an empty catalog', () => {
    expect(new CatalogStore(new Database(':memory:')).stats()).toEqual({ models: 0, lastSeenAt: null });
  });
});
